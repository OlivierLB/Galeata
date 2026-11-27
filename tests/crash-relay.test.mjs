import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay } from '../services/crash-relay/server.mjs';

test('anonymous relay validates metadata, strips extra fields, deduplicates and retries failures', async () => {
  const calls = [];
  let ok = false;
  const server = createRelay({ token: 'test-only', repository: 'owner/repo', fetcher: async (url, options) => {
    calls.push({ url, body: JSON.parse(options.body) }); return { ok };
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const post = body => fetch(`http://127.0.0.1:${server.address().port}/crashes`, { method: 'POST', body: JSON.stringify(body) });
    assert.equal((await post({ version: 'forged' })).status, 400);
    const body = { version: '1.2.3', platform: 'linux', reason: 'abnormal_exit', secret: 'never forward' };
    assert.equal((await post(body)).status, 502);
    ok = true;
    assert.equal((await post(body)).status, 204);
    assert.equal((await post(body)).status, 204);
    assert.equal(calls.length, 2);
    assert.ok(!JSON.stringify(calls).includes('never forward'));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
