import { createServer } from 'node:http';

// Run behind an HTTPS proxy with request rate limiting. Credentials stay here.
export function createRelay({ token, repository, fetcher = fetch }) {
  const recent = new Map();
  return createServer(async (req, res) => {
    const finish = status => { res.writeHead(status); res.end(); };
    if (req.method !== 'POST' || req.url !== '/crashes') return finish(404);
    if (!token || !/^[\w.-]+\/[\w.-]+$/.test(repository ?? '')) return finish(503);
    let body = '';
    try {
      for await (const chunk of req) {
        body += chunk;
        if (body.length > 1024) return finish(413);
      }
      const data = JSON.parse(body);
      if (data.platform !== 'linux' || data.reason !== 'abnormal_exit' || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(data.version)) return finish(400);
      const key = data.version;
      const now = Date.now();
      for (const [key, time] of recent) if (now - time > 3_600_000) recent.delete(key);
      if (recent.has(key)) return finish(204);
      if (recent.size >= 100) return finish(429);
      recent.set(key, now);
      const response = await fetcher(`https://api.github.com/repos/${repository}/issues`, {
        method: 'POST', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json', 'Content-Type': 'application/json', 'User-Agent': 'Galeata-crash-relay' },
        body: JSON.stringify({ title: `Fermeture anormale — Galeata ${data.version} (Linux)`, body: 'Rapport automatique détecté au lancement suivant.\n\nAucun code, chemin, message de conversation ou identifiant utilisateur transmis. Une fermeture forcée ou un arrêt système peut également produire ce signalement.' }),
      });
      if (!response.ok) { recent.delete(key); return finish(502); }
      finish(204);
    } catch { recent.clear(); finish(502); }
  });
}

if (process.argv[1] === new URL(import.meta.url).pathname) {
  createRelay({ token: process.env.GITHUB_TOKEN, repository: process.env.GITHUB_REPOSITORY })
    .listen(Number(process.env.PORT ?? 8787), '127.0.0.1');
}
