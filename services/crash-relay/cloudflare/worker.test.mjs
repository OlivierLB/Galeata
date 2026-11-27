import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Miniflare, convertV4MiniflareOptions } from 'miniflare';

function runtime(directory, outbound, limit = 1000) {
  const options = convertV4MiniflareOptions({
    name: 'galeata-crash-tests', modules: true, scriptPath: new URL('.wrangler/build/worker.js', import.meta.url).pathname,
    compatibilityDate: '2026-11-27', compatibilityFlags: ['nodejs_compat'], cf: false,
    resourcePersistencePath: directory,
    bindings: { GITHUB_TOKEN: 'dummy-test-only', GITHUB_REPOSITORY: 'owner/repo' },
    durableObjects: { CRASH_REPORTS: { className: 'CrashReports', useSQLite: true, unsafeUniqueKey: 'crash-tests' } },
    ratelimits: { CLIENT_LIMITER: { namespace_id: '20901', simple: { limit, period: 60 } } },
    outboundService: outbound,
  });
  options.telemetry = { enabled: false };
  return new Miniflare(options);
}
const report = version => ({ version, platform: 'linux', reason: 'abnormal_exit' });
const send = (mf, value) => mf.dispatchFetch('https://relay.test/crashes', { method: 'POST', body: JSON.stringify(value) });

test('real Worker runtime validates, retries GitHub errors and persists deduplication and daily caps', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeata-worker-'));
  let calls = 0;
  let githubOk = false;
  const outbound = async request => {
    assert.equal(request.url, 'https://api.github.com/repos/owner/repo/issues');
    const body = await request.json();
    assert.ok(!JSON.stringify(body).includes('private-user-data'));
    calls++;
    return new Response(null, { status: githubOk ? 201 : 503 });
  };
  let mf = runtime(directory, outbound);
  try {
    assert.equal((await mf.dispatchFetch('https://relay.test/health')).status, 204);
    assert.equal((await send(mf, { secret: 'private-user-data' })).status, 400);
    assert.equal((await send(mf, { ...report('1.0.0'), extra: 'x'.repeat(33 * 1024) })).status, 413);
    assert.equal((await send(mf, report('1.0.0'))).status, 502);
    githubOk = true;
    assert.equal((await send(mf, { ...report('1.0.0'), secret: 'private-user-data' })).status, 204);
    assert.equal((await send(mf, report('1.0.0'))).status, 204);
    assert.equal(calls, 2);
    await mf.dispose();
    mf = runtime(directory, outbound);
    assert.equal((await send(mf, report('1.0.0'))).status, 204);
    assert.equal(calls, 2, 'restart must not create a duplicate ticket');
    for (let index = 1; index <= 23; index++) assert.equal((await send(mf, report(`1.0.${index}`))).status, 204);
    assert.equal(calls, 25);
    assert.equal((await send(mf, report('2.0.0'))).status, 429);
    assert.equal(calls, 25, 'global cap must stop outbound requests');
    assert.equal((await send(mf, report('1.0.0'))).status, 204, 'duplicates can be acknowledged even after the cap');
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('rate limiting protects the public endpoint before GitHub and body validation', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeata-worker-rate-'));
  const mf = runtime(directory, () => { throw new Error('No external request expected'); }, 5);
  try {
    for (let index = 0; index < 5; index++) assert.equal((await send(mf, {})).status, 400);
    assert.equal((await send(mf, {})).status, 429);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('concurrent duplicate reports wait for GitHub acknowledgement', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeata-worker-concurrent-'));
  let release;
  let notify;
  const started = new Promise(resolve => { notify = resolve; });
  let calls = 0;
  const mf = runtime(directory, () => {
    calls++; notify();
    return new Promise(resolve => { release = () => resolve(new Response(null, { status: 201 })); });
  });
  try {
    const first = send(mf, report('3.0.0'));
    await started;
    assert.equal((await send(mf, report('3.0.0'))).status, 429);
    assert.equal((await send(mf, report('3.0.0'))).status, 429);
    release();
    assert.equal((await first).status, 204);
    assert.equal((await send(mf, report('3.0.0'))).status, 204);
    assert.equal(calls, 1);
  } finally { release?.(); await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});
