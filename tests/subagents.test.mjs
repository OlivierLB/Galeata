import test from 'node:test';
import assert from 'node:assert/strict';
import { conversationSubagents } from '../src/agents/subagents.ts';
const conversation = (id, items = []) => ({ id, sessionId: `session-${id}`, provider: 'codex', items });
const tool = (id, input, output, running = false) => ({ id, kind: 'tool', tool: 'agent', input, output: JSON.stringify(output), running, ok: true });
const report = (id, parentId, message, status, createdAt = 1) => ({ id: `${id}-${createdAt}`, kind: 'activity', message, createdAt, data: { sessionId: id, parentId, status } });

test('isolates conversations, preserves the complete initial prompt and deduplicates wait calls', () => {
  const prompt = 'Consigne complète '.repeat(100);
  const a = conversation('a', [tool('spawn', { action: 'spawn_agent', prompt }, { destinations: ['child'], agents: { child: { status: 'running' } } }),
    tool('wait', { action: 'wait', destinations: ['child'] }, { agents: { child: { status: 'running', message: 'Analyse' } } })]);
  const events = [report('child', 'session-a', 'Corriger les tests', 'running'), report('other', 'session-b', 'Autre conversation', 'running')];
  const agents = conversationSubagents(a, events);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].prompt, prompt);
  assert.deepEqual(agents[0].tasks, ['Corriger les tests']);
  assert.equal(conversationSubagents(conversation('b'), events).some(agent => agent.id === 'child'), false);
});

test('completed wait results close the existing tab identity', () => {
  const a = conversation('a', [tool('spawn', { action: 'spawn_agent', prompt: 'Do it' }, { destinations: ['child'] }),
    tool('wait', { action: 'wait' }, { agents: { child: { status: 'completed', message: 'Fini' } } })]);
  const agents = conversationSubagents(a, []);
  assert.equal(agents.length, 1);
  assert.equal(agents[0].active, false);
  assert.equal(agents[0].prompt, 'Do it');
});

test('scoped root mission is excluded while nested reports are kept', () => {
  const events = [report('pilot', undefined, 'Mission principale', 'running'), report('child', 'pilot', 'Sous-tâche', 'running'), report('nested', 'child', 'Vérification', 'blocked')];
  const agents = conversationSubagents(conversation('a'), events, true);
  assert.deepEqual(agents.map(agent => agent.id), ['child', 'nested']);
});

test('Claude foreground completion differs from a background launch', () => {
  const item = tool('spawn', { prompt: 'Inspecter', description: 'Exploration' }, {});
  assert.equal(conversationSubagents({ ...conversation('a', [item]), provider: 'claude' }, [])[0].active, false);
  assert.equal(conversationSubagents({ ...conversation('a', [{ ...item, input: { ...item.input, run_in_background: true } }]), provider: 'claude' }, [])[0].active, true);
});

test('explicit current tasks replace previous tasks without losing the initial instruction', () => {
  const old = report('child', 'session-a', 'Ancien état', 'running', 1);
  old.data.initialPrompt = 'Consigne de départ'; old.data.tasks = ['Lire le code'];
  const recent = report('child', 'session-a', 'Nouvel état', 'running', 2);
  recent.data.tasks = ['Exécuter les tests'];
  const [agent] = conversationSubagents(conversation('a'), [recent, old]);
  assert.equal(agent.prompt, 'Consigne de départ');
  assert.deepEqual(agent.tasks, ['Exécuter les tests']);
});
