import test from 'node:test';
import assert from 'node:assert/strict';
import { createRelay, normalizeReport, reportSignature } from '../services/crash-relay/server.mjs';

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

const detailed = () => ({ schema: 2, reportId: '12345678-1234-4234-8234-123456789abc', version: '1.2.3', build: 'abcdef123456', platform: 'linux', arch: 'x86_64', kernel: '6.8.0', display: 'wayland', startedAtMs: 1000, observedAtMs: 2000, uptimeSeconds: 1, memoryKib: 12345, reason: 'rust_panic', panic: { kind: 'unwrap', source: 'src/workspace.rs', line: 42, column: 3, frames: ['galeata_lib::workspace::read'] }, events: [{ atMs: 1500, operation: 'workspace.read', elapsedMs: 25, ok: false, code: 'UNCLASSIFIED' }] });

test('rich reports retain diagnostic metadata while stripping unknown fields at every level', () => {
  const report = detailed();
  report.secret = 'private'; report.panic.message = 'private'; report.events[0].arguments = 'private';
  const normalized = normalizeReport(report);
  assert.equal(normalized.panic.source, 'src/workspace.rs');
  assert.equal(normalized.events[0].operation, 'workspace.read');
  assert.ok(!JSON.stringify(normalized).includes('private'));
  const other = detailed(); other.panic.line++;
  assert.notEqual(reportSignature(normalized), reportSignature(other));
  other.panic.line--; other.reportId = '22345678-1234-4234-8234-123456789abc';
  assert.equal(reportSignature(normalized), reportSignature(other));
});

test('private paths, arbitrary events, stack payloads and oversized arrays are refused', () => {
  for (const mutate of [
    data => { data.panic.source = '/home/user/private.rs'; },
    data => { data.panic.source = 'src/../private.rs'; },
    data => { data.panic.frames = ['password=private']; },
    data => { data.events[0].operation = 'secret command'; },
    data => { data.events[0].code = 'token=private'; },
    data => { data.events = Array(33).fill(data.events[0]); },
  ]) { const report = detailed(); mutate(report); assert.equal(normalizeReport(report), null); }
});

test('GitHub issue receives useful details and concurrent failures do not acknowledge lost reports', async () => {
  let complete;
  const requests = [];
  const server = createRelay({ token: 'test-only', repository: 'owner/repo', fetcher: async (_url, options) => {
    requests.push(JSON.parse(options.body));
    return new Promise(resolve => { complete = resolve; });
  } });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const post = () => fetch(`http://127.0.0.1:${server.address().port}/crashes`, { method: 'POST', body: JSON.stringify(detailed()) });
  try {
    const first = post();
    while (!complete) await new Promise(resolve => setTimeout(resolve, 5));
    assert.equal((await post()).status, 429);
    assert.equal((await post()).status, 429);
    complete({ ok: false });
    assert.equal((await first).status, 502);
    complete = null;
    const retry = post();
    while (!complete) await new Promise(resolve => setTimeout(resolve, 5));
    complete({ ok: true });
    assert.equal((await retry).status, 204);
    assert.match(requests[1].body, /src\/workspace.rs:42:3/);
    assert.match(requests[1].body, /workspace.read/);
    assert.match(requests[1].body, /abcdef123456/);
  } finally { await new Promise(resolve => server.close(resolve)); }
});
