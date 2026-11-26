import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.window = {};
const storage = new Map();
globalThis.localStorage = {
  getItem: (key) => storage.get(key) ?? null,
  setItem: (key, value) => storage.set(key, value),
};
const { openWorkspace, request, desktop, setActiveWorkspace } = await import('../src/api.ts');

test('l’aperçu n’a pas de capacités locales et exige un espace ouvert', async () => {
  assert.equal(desktop, false);
  await assert.rejects(request('plan.get'), /Ouvrez un dossier/);
  await openWorkspace();
  await assert.rejects(request('terminal.start', { kind: 'shell' }), /application de bureau/);
  await assert.rejects(
    request('workspace.write', { path: '/etc/passwd', content: 'bad' }),
    /application de bureau/,
  );
  await assert.rejects(
    request('remote.connect', { token: 'not-a-real-token' }),
    /application de bureau/,
  );
});
test('l’arborescence et la recherche conduisent à un vrai buffer d’exemple', async () => {
  await openWorkspace();
  const root = await request('workspace.list', { path: '' });
  assert(root.items.some((entry) => entry.path === 'src' && entry.directory));
  const results = await request('workspace.search_files', { query: 'App.tsx' });
  assert.equal(results.items[0].path, 'src/App.tsx');
  const file = await request('workspace.read', { path: results.items[0].path });
  assert.match(file.content, /export default function App/);
});
test('deux éditeurs du plan ne peuvent pas écraser une révision récente', async () => {
  await openWorkspace();
  const first = await request('plan.get');
  const second = await request('plan.get');
  const saved = await request('plan.save', {
    revision: first.revision,
    plan: { ...first, objective: 'Objectif modifié' },
  });
  assert.equal(saved.revision, first.revision + 1);
  await assert.rejects(
    request('plan.save', { revision: second.revision, plan: second }),
    /REVISION_CONFLICT/,
  );
  assert.equal((await request('plan.get')).objective, 'Objectif modifié');
  assert.equal(JSON.parse(storage.get('galeata:preview-plan')).objective, 'Objectif modifié');
  assert.equal((await request('activity.list'))[0].kind, 'plan');
});
test('les résultats du plan ne permettent pas de muter le stockage sans sauvegarde', async () => {
  const plan = await request('plan.get');
  plan.objective = 'Mutation non enregistrée';
  assert.notEqual((await request('plan.get')).objective, plan.objective);
  setActiveWorkspace(null);
});

test('chaque conversation conserve son propre plan', async () => {
  await openWorkspace();
  const first = await request('plan.get', { conversationId: 'a' });
  await request('plan.save', { conversationId: 'a', revision: first.revision, plan: { ...first, objective: 'Plan A' } });
  assert.equal((await request('plan.get', { conversationId: 'b' })).objective, '');
  assert.equal((await request('plan.get', { conversationId: 'a' })).objective, 'Plan A');
});
