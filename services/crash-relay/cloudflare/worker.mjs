import { DurableObject } from 'cloudflare:workers';
import { MAX_BODY, normalizeReport, reportSignature, issueBody } from '../core.mjs';

const reply = status => new Response(null, { status, headers: { 'Cache-Control': 'no-store' } });
const configured = env => Boolean(env.GITHUB_TOKEN && /^[\w.-]+\/[\w.-]+$/.test(env.GITHUB_REPOSITORY ?? '') && env.CRASH_REPORTS && env.CLIENT_LIMITER);
const counterBlock = count => `<!-- galeata-count:start -->\nRapports reçus : ${count} (anciens rapports et réessais après 30 jours éventuellement recomptés).\n<!-- galeata-count:end -->`;

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
      if (path === '/ready' && request.method === 'GET') {
        if (!configured(env)) return reply(503);
        return await env.CRASH_REPORTS.get(env.CRASH_REPORTS.idFromName('github-issues')).fetch('https://internal/ready');
      }
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
    this.sql.exec('CREATE TABLE IF NOT EXISTS readiness (id INTEGER PRIMARY KEY, status INTEGER, expires INTEGER)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS groups (signature TEXT PRIMARY KEY, issue INTEGER NOT NULL, count INTEGER NOT NULL, published INTEGER NOT NULL)');
    this.sql.exec('CREATE TABLE IF NOT EXISTS receipts (id TEXT PRIMARY KEY, expires INTEGER NOT NULL)');
    this.sql.exec('CREATE INDEX IF NOT EXISTS receipts_expiry ON receipts(expires)');
  }

  async ready() {
    const cached = [...this.sql.exec('SELECT status, expires FROM readiness WHERE id = 1')][0];
    if (cached?.expires > Date.now()) return reply(cached.status);
    if (!this.checking) this.checking = (async () => {
      let status = 503;
      try {
        // An authenticated read detects revoked tokens without producing issues.
        // It cannot prove Issues write permission on a public repository.
        const response = await fetch(`https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/issues?per_page=1`, {
          headers: this.headers(), signal: AbortSignal.timeout(10_000),
        });
        const expiry = response.headers.get('github-authentication-token-expiration') || this.env.GITHUB_TOKEN_EXPIRES_AT;
        status = response.ok && (!expiry || Date.parse(expiry) > Date.now() + 14 * 86_400_000) ? 204 : 503;
        await response.body?.cancel();
      } catch { /* Only a generic status is exposed, never upstream details. */ }
      this.sql.exec('INSERT OR REPLACE INTO readiness VALUES (1, ?, ?)', status, Date.now() + 900_000);
      return status;
    })().finally(() => { this.checking = null; });
    return reply(await this.checking);
  }

  headers() {
    return { Authorization: `Bearer ${this.env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Galeata-crash-relay' };
  }

  reserveWrite() {
    const day = Math.floor(Date.now() / 86_400_000);
    this.sql.exec('DELETE FROM daily WHERE day < ?', day);
    const counter = [...this.sql.exec('SELECT attempts FROM daily WHERE day = ?', day)][0];
    if ((counter?.attempts ?? 0) >= 25) return false;
    this.sql.exec('INSERT INTO daily(day, attempts) VALUES (?, 1) ON CONFLICT(day) DO UPDATE SET attempts = attempts + 1', day);
    return true;
  }

  async alarm() {
    await this.flushCounts();
  }

  async flushCounts() {
    // At most 25 writes per UTC day, including failures and issue creation.
    const dirty = [...this.sql.exec('SELECT * FROM groups WHERE count > published LIMIT 25')];
    for (const group of dirty) {
      if (!this.reserveWrite()) break;
      try {
        const url = `https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/issues/${group.issue}`;
        const response = await fetch(url, { headers: this.headers(), signal: AbortSignal.timeout(10_000) });
        if (!response.ok) { await response.body?.cancel(); continue; }
        const issue = await response.json();
        if (typeof issue.body !== 'string' || issue.body.length > 60_000) continue;
        const block = /<!-- galeata-count:start -->[\s\S]*?<!-- galeata-count:end -->/;
        const body = block.test(issue.body) ? issue.body.replace(block, counterBlock(group.count)) : `${issue.body}\n\n${counterBlock(group.count)}`;
        const updated = await fetch(url, { method: 'PATCH', headers: this.headers(), signal: AbortSignal.timeout(10_000), body: JSON.stringify({ body }) });
        await updated.body?.cancel();
        if (updated.ok) this.sql.exec('UPDATE groups SET published = ? WHERE signature = ?', group.count, group.signature);
      } catch { /* Retry the bounded aggregate on the next alarm. */ }
    }
    if ([...this.sql.exec('SELECT 1 FROM groups WHERE count > published LIMIT 1')].length) await this.ctx.storage.setAlarm(Date.now() + 3_600_000);
  }

  async fetch(request) {
    if (new URL(request.url).pathname === '/ready') return this.ready();
    const parsed = await readReport(request);
    if (parsed.status) return reply(parsed.status);
    const data = parsed.report;
    const signature = reportSignature(data);
    const now = Date.now();
    const status = this.ctx.storage.transactionSync(() => {
      this.sql.exec('DELETE FROM signatures WHERE expires <= ?', now);
      this.sql.exec('DELETE FROM receipts WHERE expires <= ?', now);
      if (data.reportId && [...this.sql.exec('SELECT 1 FROM receipts WHERE id = ?', data.reportId)].length) return 204;
      const group = [...this.sql.exec('SELECT issue FROM groups WHERE signature = ?', signature)][0];
      if (group) {
        if (data.reportId) {
          if ([...this.sql.exec('SELECT COUNT(*) AS n FROM receipts')][0].n >= 100_000) return 429;
          this.sql.exec('INSERT INTO receipts VALUES (?, ?)', data.reportId, now + 30 * 86_400_000);
        }
        this.sql.exec('UPDATE groups SET count = count + 1 WHERE signature = ?', signature);
        return 204;
      }
      const previous = [...this.sql.exec('SELECT status FROM signatures WHERE signature = ?', signature)][0];
      if (previous) return previous.status === 'sent' ? 204 : 429;
      // Bound anonymous abuse and GitHub tickets independently of the free quotas.
      if ([...this.sql.exec('SELECT COUNT(*) AS n FROM groups')][0].n >= 10_000
        || (data.reportId && [...this.sql.exec('SELECT COUNT(*) AS n FROM receipts')][0].n >= 100_000)
        || !this.reserveWrite()) return 429;
      this.sql.exec('INSERT INTO signatures(signature, status, expires) VALUES (?, ?, ?)', signature, 'pending', now + 120_000);
      return 0;
    });
    if (status) {
      if (status === 204 && !await this.ctx.storage.getAlarm()) await this.ctx.storage.setAlarm(now + 3_600_000);
      return reply(status);
    }
    try {
      const response = await fetch(`https://api.github.com/repos/${this.env.GITHUB_REPOSITORY}/issues`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: this.headers(),
        body: JSON.stringify({ title: `${data.reason === 'rust_panic' ? 'Panique Rust' : 'Fermeture anormale'} — Galeata ${data.version} [${signature}]`, body: `${issueBody(data, signature)}\n\n${counterBlock(1)}` }),
      });
      if (!response.ok) { await response.body?.cancel(); throw new Error('GitHub request failed'); }
      const issue = await response.json();
      if (!Number.isSafeInteger(issue.number) || issue.number < 1) throw new Error('Invalid GitHub response');
      this.sql.exec('INSERT INTO groups VALUES (?, ?, 1, 1)', signature, issue.number);
      if (data.reportId) this.sql.exec('INSERT OR IGNORE INTO receipts VALUES (?, ?)', data.reportId, now + 30 * 86_400_000);
      this.sql.exec('UPDATE signatures SET status = ?, expires = ? WHERE signature = ?', 'sent', Date.now() + 3_600_000, signature);
      return reply(204);
    } catch {
      this.sql.exec('DELETE FROM signatures WHERE signature = ?', signature);
      return reply(502);
    }
  }
}
