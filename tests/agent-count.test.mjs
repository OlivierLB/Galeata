import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore } from '../src/agents/store.ts';
import { countAgents } from '../src/agents/count.ts';

const activity = (id, parentId, createdAt = 1) => ({ id: String(createdAt), kind: 'activity', createdAt,
  data: { sessionId: id, parentId, status: 'running' } });

test('counts only active roots, excluding exited and idle conversations', () => {
  const store = new AgentStore();
  store.create('a', 'codex'); store.create('b', 'claude');
  store.apply('a', [{ type: 'exited', code: 0, stderr: null }]);
  assert.deepEqual(countAgents(store.getAll(), [activity('unrelated', 'other')]), { tabs: 1, subagents: 0, total: 1 });
  store.apply('b', [{ type: 'state', state: 'idle' }]);
  assert.equal(countAgents(store.getAll(), []).total, 0);
});
test('deduplicates tool reports, mission updates, nested children and children opened as tabs', () => {
  const store = new AgentStore(); store.create('parent', 'codex');
  store.apply('parent', [
    { type: 'session', sessionId: 'session-parent', model: null },
    ...['spawn', 'wait'].flatMap(itemId => [
      { type: 'toolStarted', itemId, tool: 'agent', title: itemId, path: null },
      { type: 'toolCompleted', itemId, ok: true, output: JSON.stringify({ agents: { child: { status: 'completed' } }, destinations: ['child'] }) },
    ]),
  ]);
  const events = [activity('child', 'session-parent'), activity('child', 'session-parent', 2), activity('grandchild', 'child')];
  assert.deepEqual(countAgents(store.getAll(), events), { tabs: 1, subagents: 2, total: 3 });
  store.create('child-tab', 'codex');
  store.apply('child-tab', [{ type: 'session', sessionId: 'child', model: null }]);
  assert.deepEqual(countAgents(store.getAll(), events), { tabs: 2, subagents: 1, total: 3 });
  store.remove('parent'); store.remove('child-tab');
  assert.equal(countAgents(store.getAll(), events).total, 0);
});
test('supports mixed providers without counting control calls or double-counting Claude declarations', () => {
  const store = new AgentStore(); store.create('codex', 'codex'); store.create('claude', 'claude');
  for (const [parent, itemId, title, output] of [
    ['codex', 'one', 'spawnAgent', JSON.stringify({ agents: { known: {} } })],
    ['codex', 'control', 'wait', '{}'],
    ['claude', 'two', 'Analyser les tests', 'Résultat de la tâche'],
  ]) store.apply(parent, [
    { type: 'toolStarted', itemId, title, tool: 'agent', path: null },
    { type: 'toolCompleted', itemId, ok: true, output },
  ]);
  assert.equal(countAgents(store.getAll(), []).total, 3);
  assert.equal(countAgents(store.getAll(), [activity('claude-child', 'claude')]).total, 4);
});
