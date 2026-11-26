import test from 'node:test';
import assert from 'node:assert/strict';
import { AgentStore } from '../src/agents/store.ts';

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

test('model catalogs and selections belong to their own conversation', () => {
  const store = new AgentStore();
  store.create('claude', 'claude');
  store.create('codex', 'codex');
  const models = [{ id: 'sonnet', label: 'Sonnet', description: '', resolvedModel: 'claude-sonnet' }];
  store.apply('claude', [
    { type: 'models', models },
    { type: 'model', model: 'sonnet' },
  ]);
  store.apply('claude', [{ type: 'state', state: 'working' }]);
  assert.deepEqual(store.get('claude').models, models);
  assert.equal(store.get('claude').model, 'sonnet');
  assert.deepEqual(store.get('codex').models, []);
  assert.equal(store.get('codex').model, undefined);
});

test('drafts stay with their conversation and are cleared on close or workspace change', async () => {
  const store = new AgentStore();
  store.create('a', 'claude');
  store.create('b', 'codex');
  await flush();
  let notifications = 0;
  store.subscribe(() => notifications++);
  store.setDraft('a', 'First draft');
  store.setDraft('b', 'Second draft');
  store.apply('a', [{ type: 'message', itemId: 'm', text: 'Reply' }]);
  assert.equal(store.getDraft('a'), 'First draft');
  assert.equal(store.getDraft('b'), 'Second draft');
  await flush();
  assert.equal(notifications, 1, 'typing does not notify conversation subscribers');
  store.setDraft('a', '');
  assert.equal(store.getDraft('a'), '');
  store.setDraft('a', 'Another draft');
  store.remove('a');
  store.setDraft('a', 'Late update from a closed chat');
  assert.equal(store.getDraft('a'), '');
  store.clear();
  assert.equal(store.getDraft('b'), '');
});

test('les fragments forment un message, remplacé par le texte final', () => {
  const store = new AgentStore();
  store.create('a', 'claude');
  store.apply('a', [
    { type: 'textDelta', itemId: 'm:0', text: 'Bon' },
    { type: 'textDelta', itemId: 'm:0', text: 'jour' },
  ]);
  let item = store.get('a').items[0];
  assert.equal(item.text, 'Bonjour');
  assert.equal(item.streaming, true);
  store.apply('a', [{ type: 'message', itemId: 'm:0', text: 'Bonjour !' }]);
  item = store.get('a').items[0];
  assert.equal(item.text, 'Bonjour !');
  assert.equal(item.streaming, false);
  assert.equal(store.get('a').items.length, 1);
});

test('un lot ne recrée que les éléments modifiés', () => {
  const store = new AgentStore();
  store.create('a', 'codex');
  store.addUser('a', 'question');
  store.apply('a', [
    { type: 'toolStarted', itemId: 't', tool: 'command', title: 'ls', path: null },
  ]);
  const before = store.get('a').items;
  store.apply('a', [{ type: 'toolOutput', itemId: 't', text: 'a.txt\n' }]);
  const after = store.get('a').items;
  assert.notEqual(after, before);
  assert.equal(after[0], before[0], 'le message utilisateur garde son identité');
  assert.notEqual(after[1], before[1]);
  store.apply('a', [{ type: 'toolCompleted', itemId: 't', ok: true, output: null }]);
  assert.equal(store.get('a').items[1].output, 'a.txt\n');
  assert.equal(store.get('a').items[1].running, false);
});

test('les événements reçus avant la création ne sont pas perdus', () => {
  const store = new AgentStore();
  store.apply('tôt', [{ type: 'state', state: 'idle' }]);
  store.create('tôt', 'claude');
  assert.equal(store.get('tôt').state, 'idle');
});

test('autorisations, fin de tour et arrêt de l’agent', () => {
  const store = new AgentStore();
  store.create('a', 'claude');
  store.apply('a', [
    { type: 'turnStarted' },
    { type: 'approval', requestId: 'r1', kind: 'fileChange', title: 'out.txt', detail: 'x' },
  ]);
  assert.equal(store.get('a').approvals.length, 1);
  assert.equal(store.get('a').busy, true);
  store.apply('a', [
    { type: 'approvalResolved', requestId: 'r1' },
    {
      type: 'turnCompleted',
      status: 'completed',
      error: null,
      costUsd: 0.05,
      inputTokens: 10,
      outputTokens: 2,
    },
  ]);
  assert.equal(store.get('a').approvals.length, 0);
  assert.equal(store.get('a').busy, false);
  assert.equal(store.get('a').costUsd, 0.05);
  store.apply('a', [{ type: 'exited', code: 1, stderr: 'boom' }]);
  const conversation = store.get('a');
  assert.equal(conversation.state, 'exited');
  assert.match(conversation.items.at(-1).text, /code 1[\s\S]*boom/);
});

test('les abonnés sont prévenus une seule fois pour plusieurs lots', async () => {
  const store = new AgentStore();
  let calls = 0;
  store.subscribe(() => calls++);
  store.create('a', 'claude');
  for (let i = 0; i < 50; i++)
    store.apply('a', [{ type: 'textDelta', itemId: 'm', text: String(i) }]);
  await flush();
  assert.equal(calls, 1);
});

test('l’historique d’une conversation reprise s’affiche dans l’ordre', () => {
  const store = new AgentStore();
  store.apply('r', [
    { type: 'userMessage', itemId: 'u1', text: 'Corrige le header' },
    { type: 'toolStarted', itemId: 't1', tool: 'fileRead', title: 'a.scss', path: 'a.scss' },
    { type: 'toolCompleted', itemId: 't1', ok: true, output: 'ok' },
    { type: 'message', itemId: 'a1', text: 'C’est corrigé.' },
  ]);
  store.create('r', 'claude');
  assert.deepEqual(
    store.get('r').items.map((item) => [item.kind, item.text || item.title]),
    [
      ['user', 'Corrige le header'],
      ['tool', 'a.scss'],
      ['assistant', 'C’est corrigé.'],
    ],
  );
});

test('un plan proposé devient une carte, puis garde sa décision', () => {
  const store = new AgentStore();
  store.create('a', 'claude');
  store.apply('a', [{ type: 'planProposal', requestId: 'p1', plan: '# Plan', path: 'plans/x.md' }]);
  let plan = store.get('a').items[0];
  assert.equal(plan.kind, 'plan');
  assert.equal(plan.status, 'pending');
  store.markAnswered('a', 'p1', 'approved');
  store.apply('a', [{ type: 'approvalResolved', requestId: 'p1' }]);
  plan = store.get('a').items[0];
  assert.equal(plan.status, 'approved', 'la confirmation de l’agent ne remplace pas la décision');
  store.apply('a', [
    {
      type: 'question',
      requestId: 'q1',
      questions: [
        {
          id: 'Couleur ?',
          header: 'Couleur',
          question: 'Couleur ?',
          options: [],
          multiSelect: false,
          allowOther: true,
        },
      ],
    },
    { type: 'approvalResolved', requestId: 'q1' },
  ]);
  assert.equal(store.get('a').items[1].status, 'closed');
});


test('final tool output obeys the same memory limit as streaming output', () => {
  const store = new AgentStore();
  store.create('a', 'codex');
  store.apply('a', [{ type: 'toolCompleted', itemId: 't', ok: true,
    output: 'x'.repeat(2 * 1024 * 1024) + 'TAIL' }]);
  const output = store.get('a').items[0].output;
  assert.equal(output.length, 256 * 1024);
  assert.ok(output.endsWith('TAIL'));
});

test('workspace reset drops early events and unknown agents cannot grow the buffer forever', () => {
  const store = new AgentStore();
  store.apply('a', [{ type: 'message', itemId: 'old', text: 'Old project' }]);
  store.clear();
  store.create('a', 'codex');
  assert.equal(store.get('a').items.length, 0);
  for (let i = 0; i < 100; i++)
    store.apply(`unknown-${i}`, [{ type: 'notice', message: 'late' }]);
  store.create('unknown-99', 'codex');
  assert.equal(store.get('unknown-99').items.length, 0);
});


test('tab ordering moves in either direction without changing conversations or drafts', () => {
  const store = new AgentStore();
  store.create('a', 'codex'); store.create('b', 'codex');
  store.setDraft('a', 'Keep my draft');
  const conversation = store.get('a');
  store.reorder('a', 'b');
  assert.deepEqual(store.getAll().map(c => c.id), ['b', 'a']);
  store.reorder('a', 'b');
  assert.deepEqual(store.getAll().map(c => c.id), ['a', 'b']);
  assert.equal(store.get('a'), conversation);
  assert.equal(store.getDraft('a'), 'Keep my draft');
});
