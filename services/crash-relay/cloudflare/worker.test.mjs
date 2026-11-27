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
  options.unsafeInspectDurableObjects = true;
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
    return Response.json({ number: calls }, { status: githubOk ? 201 : 503 });
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
    return new Promise(resolve => { release = () => resolve(Response.json({ number: 42 }, { status: 201 })); });
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


test('readiness uses an authenticated read, caches results across restart and detects expiration', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeata-ready-'));
  let calls = 0;
  const outbound = request => {
    calls++;
    assert.equal(request.method, 'GET');
    assert.equal(request.headers.get('Authorization'), 'Bearer dummy-test-only');
    return Response.json([], { headers: { 'github-authentication-token-expiration': new Date(Date.now() + 86400000).toISOString() } });
  };
  let mf = runtime(directory, outbound);
  try {
    assert.equal((await mf.dispatchFetch('https://relay.test/ready')).status, 503);
    assert.equal((await mf.dispatchFetch('https://relay.test/ready')).status, 503);
    assert.equal(calls, 1);
    await mf.dispose();
    mf = runtime(directory, outbound);
    assert.equal((await mf.dispatchFetch('https://relay.test/ready')).status, 503);
    assert.equal(calls, 1);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});

test('readiness accepts a valid token and rejects revoked credentials without writing', async () => {
  for (const status of [200, 401]) {
    const directory = await mkdtemp(join(tmpdir(), 'galeata-ready-status-'));
    const mf = runtime(directory, request => {
      assert.equal(request.method, 'GET');
      return Response.json([], { status });
    });
    try {
      assert.equal((await mf.dispatchFetch('https://relay.test/ready')).status, status === 200 ? 204 : 503);
    } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
  }
});

test('persistent groups count unique report IDs and publish aggregates without overwriting issue notes', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'galeata-groups-'));
  let creates = 0;
  let patches = 0;
  let body = '';
  const outbound = async request => {
    if (request.method === 'POST') {
      creates++;
      body = (await request.json()).body + '\nMaintainer note';
      return Response.json({ number: 77 }, { status: 201 });
    }
    assert.equal(request.url, 'https://api.github.com/repos/owner/repo/issues/77');
    if (request.method === 'GET') return Response.json({ body });
    assert.equal(request.method, 'PATCH');
    patches++;
    body = (await request.json()).body;
    return Response.json({ number: 77 });
  };
  let mf = runtime(directory, outbound);
  const rich = { ...report('4.0.0'), schema: 2, reportId: '00000000-0000-0000-0000-000000000001', build: 'abcdef0', arch: 'x86_64', kernel: '6.8', display: 'wayland', startedAtMs: 1, observedAtMs: 2, uptimeSeconds: 1, memoryKib: null, events: [], panic: null };
  try {
    assert.equal((await send(mf, rich)).status, 204);
    assert.equal((await send(mf, rich)).status, 204);
    await mf.dispose();
    mf = runtime(directory, outbound);
    const second = { ...rich, reportId: '00000000-0000-0000-0000-000000000002' };
    assert.equal((await send(mf, second)).status, 204);
    const ns = await mf.getDurableObjectNamespace('CRASH_REPORTS');
    await ns.get(ns.idFromName('github-issues')).flushCounts();
    assert.equal(creates, 1);
    assert.equal(patches, 1);
    assert.match(body, /Rapports reçus : 2/);
    assert.match(body, /Maintainer note/);
    assert.equal((await send(mf, second)).status, 204);
    await ns.get(ns.idFromName('github-issues')).flushCounts();
    assert.equal(patches, 1, 'retries must not inflate counters');
    const storage = await mf.unsafeGetDurableObjectStorage('galeata-crash-tests', 'CrashReports', { name: 'github-issues' });
    await storage.exec("UPDATE daily SET attempts = 25");
    assert.equal((await send(mf, { ...rich, reportId: '00000000-0000-0000-0000-000000000003' })).status, 204);
    await ns.get(ns.idFromName('github-issues')).flushCounts();
    assert.equal(patches, 1, 'aggregate updates share the daily write cap');
    await storage.exec("DELETE FROM daily");
    await storage.exec("WITH RECURSIVE n(x) AS (SELECT 1 UNION ALL SELECT x+1 FROM n WHERE x<9999) INSERT INTO groups SELECT 'limit-' || x, x, 1, 1 FROM n");
    assert.equal((await send(mf, report('5.0.0'))).status, 429, 'new signatures must stop at the storage bound');
    assert.equal(creates, 1);
  } finally { await mf.dispose(); await rm(directory, { recursive: true, force: true }); }
});
