import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeLayout, placeConversation, reconcileLayout, togglePair, visiblePair } from '../src/agents/layout.ts';

const ids = ['a', 'b', 'c', 'd'];
test('each pair keeps its positions while an unrelated conversation is full width', () => {
  let layout = placeConversation({ active: 'a', pairs: [] }, 'b', 'right', ids);
  assert.deepEqual(visiblePair(layout), ['a', 'b']);
  layout = { ...layout, active: 'c' };
  assert.equal(visiblePair(layout), undefined);
  for (const active of ['a', 'b']) assert.deepEqual(visiblePair({ ...layout, active }), ['a', 'b']);
  layout = placeConversation(layout, 'd', 'right', ids);
  assert.deepEqual(layout.pairs, [['a', 'b'], ['c', 'd']]);
  assert.deepEqual(visiblePair({ ...layout, active: 'a' }), ['a', 'b']);
  assert.deepEqual(visiblePair({ ...layout, active: 'c' }), ['c', 'd']);
});
test('home and new conversations preserve existing pairs; closing a partner leaves a single pane', () => {
  const original = { active: 'a', pairs: [['a', 'b']] };
  const added = reconcileLayout(original, ['a', 'b'], ['a', 'b', 'c']);
  assert.equal(added.active, 'c');
  assert.deepEqual(added.pairs, original.pairs);
  assert.deepEqual(normalizeLayout({ ...original, active: '' }, ids).pairs, original.pairs);
  const closed = reconcileLayout(original, ['a', 'b', 'c'], ['b', 'c']);
  assert.deepEqual(closed, { active: 'b', pairs: [] });
});
test('explicit unsplit only removes the current pair; moving a tab removes obsolete pairings', () => {
  const original = { active: 'a', pairs: [['a', 'b'], ['c', 'd']] };
  assert.deepEqual(togglePair(original, ids).pairs, [['c', 'd']]);
  assert.deepEqual(placeConversation(original, 'c', 'right', ids).pairs, [['a', 'c']]);
});
test('old saved layouts migrate and invalid or duplicate pairings are ignored', () => {
  assert.deepEqual(normalizeLayout({ active: 'a', right: 'b', split: true }, ids).pairs, [['a', 'b']]);
  assert.deepEqual(normalizeLayout({ active: 'c', pairs: [['a', 'b'], ['b', 'c'], ['d', 'missing'], ['c', 'c']] }, ids), { active: 'c', pairs: [['a', 'b']] });
});
