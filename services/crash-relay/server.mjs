import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { MAX_BODY, normalizeReport, reportSignature, issueBody, issueTitle } from './core.mjs';
export { normalizeReport, reportSignature } from './core.mjs';

// Run behind an HTTPS proxy with request rate limiting. Credentials stay here.
export function createRelay({ token: credential, repository, fetcher = fetch }) {
  const recent = new Map();
  const inflight = new Set();
  const server = createServer(async (req, res) => {
    const finish = status => { res.writeHead(status); res.end(); };
    if (req.method === 'GET' && req.url === '/health') return finish(credential && repository ? 204 : 503);
    if (req.method !== 'POST' || req.url !== '/crashes') return finish(404);
    if (!credential || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) return finish(503);
    let signature;
    let ownsRequest = false;
    try {
      let length = 0;
      const chunks = [];
      for await (const chunk of req) {
        length += chunk.length;
        if (length > MAX_BODY) return finish(413);
        chunks.push(chunk);
      }
      let input;
      try { input = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { return finish(400); }
      const data = normalizeReport(input);
      if (!data) return finish(400);
      signature = reportSignature(data);
      const now = Date.now();
      for (const [key, time] of recent) if (now - time > 3_600_000) recent.delete(key);
      if (recent.has(signature)) return finish(204);
      // A concurrent request must retry if the first GitHub request fails.
      if (inflight.has(signature) || recent.size + inflight.size >= 100) return finish(429);
      inflight.add(signature);
      ownsRequest = true;
      const response = await fetcher(`https://api.github.com/repos/${repository}/issues`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${credential}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Galeata-crash-relay' },
        body: JSON.stringify({ title: issueTitle(data, signature), body: issueBody(data, signature) }),
      });
      if (!response.ok) return finish(502);
      recent.set(signature, now);
      finish(204);
    } catch { finish(502); }
    finally { if (ownsRequest) inflight.delete(signature); }
  });
  server.requestTimeout = 15_000;
  server.headersTimeout = 10_000;
  return server;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const credentialFile = process.env.GITHUB_TOKEN_FILE;
  const credential = credentialFile ? readFileSync(credentialFile, 'utf8').trim() : process.env.GITHUB_TOKEN;
  createRelay({ token: credential, repository: process.env.GITHUB_REPOSITORY })
    .listen(Number(process.env.PORT ?? 8787), process.env.LISTEN_HOST ?? '127.0.0.1');
}
