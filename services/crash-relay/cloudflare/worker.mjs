import { DurableObject } from 'cloudflare:workers';
import { MAX_BODY, normalizeReport, reportSignature, issueBody } from '../core.mjs';

const reply = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const configured = env => Boolean(env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') && env.CRASH_REPORTS && env.CLIENT_LIMITER);

async function readReport(request) {
  if (Number(request.headers.get('content-length')) > MAX_BODY) return { status: 413 };
  const reader = request.body?.getReader();
  if (!reader) return { status: 400 };
  const chunks = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BODY) { await reader.cancel(); return { status: 413 }; }
    chunks.push(value);
  }
  const bytes = new Uint8Array(size);
  let position = 0;
  for (const chunk of chunks) { bytes.set(chunk, position); position += chunk.byteLength; }
  try {
    const report = normalizeReport(JSON.parse(new TextDecoder().decode(bytes)));
    return report ? { report } : { status: 400 };
  } catch { return { status: 400 }; }
}

export default {
  async fetch(request, env) {
    try {
      const path = new URL(request.url).pathname;
      if (path === '/health' && request.method === 'GET') return reply(configured(env) ? 204 : 503);
      if (path !== '/crashes' || request.method !== 'POST') return reply(404);
      if (!configured(env)) return reply(503);
      // This key is used only by Cloudflare's limiter, never included in reports.
      const limited = await env.CLIENT_LIMITER.limit({ key: request.headers.get('CF-Connecting-IP') ?? 'unknown' });
      if (!limited.success) return reply(429);
      const parsed = await readReport(request);
      if (parsed.status) return reply(parsed.status);
      const coordinator = env.CRASH_REPORTS.get(env.CRASH_REPORTS.idFromName('github-issues'));
      return await coordinator.fetch(new Request('https://internal/crashes', { method: 'POST', body: JSON.stringify(parsed.report) }));
    } catch { return reply(503); }
  },
};

/** One SQLite-backed coordinator: signatures and limits survive isolate restarts. */
export class CrashReports extends DurableObject {
  constructor(ctx, env) {
    super(ctx, env);
    this.sql = ctx.storage.sql;
    this.sql.exec('CREATE TABLE IF NOT EXISTS signatures (signature TEXT PRIMARY KEY, status TEXT NOT NULL, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS daily (day INTEGER PRIMARY KEY, attempts INTEGER NOT NULL)');
  }

  async fetch(request) {
    const parsed = await readReport(request);
    if (parsed.status) return reply(parsed.status);
    const data = parsed.report;
    const signature = reportSignature(data);
    const now = Date.now();
    const day = Math.floor(now / 86_400_000);
    const status = this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM signatures WHERE expires <= ?', now);
      this.sql.exec('DELETE FROM daily WHERE day < ?', day);
      const previous = [...this.sql.exec('SELECT status FROM signatures WHERE signature = ?', signature)][0];
      if (previous) return previous.status === 'sent' ? 204 : 429;
      const counter = [...this.sql.exec('SELECT attempts FROM daily WHERE day = ?', day)][0];
      // Bound anonymous abuse and GitHub tickets independently of the free quotas.
      if ((counter?.attempts ?? 0) >= 25) return 429;
      this.sql.exec('INSERT INTO daily(day, attempts) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1', day);
      this.sql.exec('INSERT INTO signatures(signature, status, expires) VALUES (?, ?, ?)', signature, 'pending', now + 120_000);
      return 0;
    });
    if (status) return reply(status);
    try {
      const response = await fetch(`https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/issues`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Galeata-crash-relay' },
        body: JSON.stringify({ title: `${data.reason === 'rust_panic' ? 'Panique Rust' : 'Fermeture anormale'} — Galeata ${data.version} [${signature}]`, body: issueBody(data, signature) }),
      });
      const ok = response.ok;
      await response.body?.cancel();
      if (!ok) throw new Error('GitHub request failed');
      this.sql.exec('UPDATE signatures SET status = ?, expires = ? WHERE signature = ?', 'sent', Date.now() + 3_600_000, signature);
      return reply(204);
    } catch {
      this.sql.exec('DELETE FROM signatures WHERE signature = ?', signature);
      return reply(502);
    }
  }
}
