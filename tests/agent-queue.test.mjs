import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore } from '../src/agents/store.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));
const completed = (status = 'completed') => ({
  type: 'turnCompleted',
  status,
  error: null,
  costUsd: null,
  inputTokens: null,
  outputTokens: null,
});
const idle = { type: 'state', state: 'idle' };

for (const provider of ['codex', 'claude']) {
  test(`${provider}: queued messages wait for full completion, one turn per message`, async () => {
    const store = new AgentStore();
    const sent = [];
    store.setQueueSender(async (id, text) => {
      sent.push([id, text]);
    });
    store.create('a', provider);
    store.apply('a', [{ type: 'turnStarted' }, { type: 'state', state: 'working' }]);
    store.enqueue('a', 'First');
    store.enqueue('a', 'Second');
    // Neither a final assistant message nor a completed tool means the turn ended.
    store.apply('a', [
      { type: 'message', itemId: 'm', text: 'Done' },
      { type: 'toolCompleted', itemId: 't', ok: true, output: null },
    ]);
    await flush();
    assert.deepEqual(sent, []);
    store.apply('a', [completed()]);
    await flush();
    assert.deepEqual(sent, [], 'must also wait for the provider to be idle');
    store.apply('a', [idle]);
    await flush();
    assert.deepEqual(sent, [['a', 'First']]);
    assert.deepEqual(
      store.get('a').queuedMessages.map((m) => m.text),
      ['Second'],
    );
    store.apply('a', [idle]);
    await flush();
    assert.equal(sent.length, 1, 'IPC acceptance does not complete the reserved turn');
    store.apply('a', [{ type: 'turnStarted' }, { type: 'state', state: 'working' }]);
    store.apply('a', [completed(), idle]);
    await flush();
    assert.deepEqual(sent, [
      ['a', 'First'],
      ['a', 'Second'],
    ]);
  });
}

test('queues are independent and run without a mounted chat', async () => {
  const store = new AgentStore();
  const sent = [];
  store.setQueueSender(async (id, text) => {
    sent.push([id, text]);
  });
  store.create('a', 'codex');
  store.create('b', 'claude');
  store.enqueue('a', 'A');
  store.enqueue('b', 'B');
  store.apply('b', [idle]);
  await flush();
  assert.deepEqual(sent, [['b', 'B']]);
  store.apply('a', [idle]);
  await flush();
  assert.deepEqual(sent, [
    ['b', 'B'],
    ['a', 'A'],
  ]);
});

test('unanswered approvals and questions block the queue even if idle is reported', async () => {
  const store = new AgentStore();
  const sent = [];
  store.setQueueSender(async (_, text) => {
    sent.push(text);
  });
  store.create('a', 'claude');
  store.enqueue('a', 'Later');
  store.apply('a', [idle, { type: 'question', requestId: 'q', questions: [] }]);
  await flush();
  assert.deepEqual(sent, []);
  store.apply('a', [
    { type: 'approvalResolved', requestId: 'q' },
    {
      type: 'approval',
      requestId: 'p',
      kind: 'command',
      title: 'test',
      detail: null,
      description: null,
      always: null,
    },
  ]);
  await flush();
  assert.deepEqual(sent, []);
  store.apply('a', [{ type: 'approvalResolved', requestId: 'p' }]);
  await flush();
  assert.deepEqual(sent, ['Later']);
});

for (const status of ['failed', 'interrupted']) {
  test(`${status}: the queue pauses until explicitly resumed`, async () => {
    const store = new AgentStore();
    const sent = [];
    store.setQueueSender(async (_, text) => {
      sent.push(text);
    });
    store.create('a', 'claude');
    store.enqueue('a', 'Later');
    store.apply('a', [completed(status), idle]);
    await flush();
    assert.deepEqual(sent, []);
    assert.equal(store.get('a').queuePaused, true);
    store.pauseQueue('a', false);
    await flush();
    assert.deepEqual(sent, ['Later']);
  });
}

test('a rejected send is retained, paused and not retried automatically', async () => {
  const store = new AgentStore();
  let calls = 0;
  store.setQueueSender(async () => {
    calls++;
    throw new Error('offline');
  });
  store.create('a', 'codex');
  store.enqueue('a', 'Keep me');
  store.apply('a', [idle]);
  await flush();
  await flush();
  assert.equal(calls, 1);
  assert.equal(store.get('a').queuedMessages[0].text, 'Keep me');
  assert.equal(store.get('a').queuePaused, true);
  assert.equal(store.get('a').busy, false);
});

test('pause, removal, close and workspace change prevent unwanted sends', async () => {
  const store = new AgentStore();
  const sent = [];
  store.setQueueSender(async (_, text) => {
    sent.push(text);
  });
  store.create('a', 'codex');
  store.pauseQueue('a', true);
  store.apply('a', [idle]);
  store.enqueue('a', 'Removed');
  store.removeQueued('a', store.get('a').queuedMessages[0].id);
  store.pauseQueue('a', false);
  await flush();
  assert.deepEqual(sent, []);
  store.enqueue('a', 'Closed');
  store.remove('a');
  await flush();
  assert.deepEqual(sent, []);
  store.create('b', 'claude');
  store.apply('b', [idle]);
  store.enqueue('b', 'Cleared');
  store.clear();
  await flush();
  assert.deepEqual(sent, []);
});

test('manual sends reserve an idle conversation before native turnStarted arrives', async () => {
  const store = new AgentStore();
  const sent = [];
  store.setQueueSender(async (_, text) => {
    sent.push(text);
  });
  store.create('a', 'codex');
  store.apply('a', [idle]);
  store.sending('a');
  store.enqueue('a', 'Wait');
  await flush();
  assert.deepEqual(sent, []);
  store.apply('a', [{ type: 'turnStarted' }, completed(), idle]);
  await flush();
  assert.deepEqual(sent, ['Wait']);
});
