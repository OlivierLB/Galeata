import test from 'node:test';
import assert from 'node:assert/strict';
import { draftSnapshot, restoreDraft, savedSnapshot } from '../src/editorPersistence.ts';
const file = { path: 'src/a.ts', content: 'new', savedContent: 'old', stamp: 'one', language: 'typescript' };
test('drafts retain only unsaved text and its disk version', () => {
  assert.deepEqual(draftSnapshot([file, { ...file, content: 'old' }]), [{ path: file.path, content: 'new', stamp: 'one' }]);
});
test('restoring a draft on modified disk preserves both versions and blocks automatic saving', () => {
  const restored = restoreDraft({ ...file, content: 'disk', savedContent: 'disk', stamp: 'two' }, draftSnapshot([file]));
  assert.equal(restored.content, 'new');
  assert.equal(restored.savedContent, 'disk');
  assert.equal(restored.external, true);
});
test('a completed save does not mark newer typing as saved', () => {
  const result = savedSnapshot({ ...file, content: 'newer' }, 'new', 'two');
  assert.equal(result.content, 'newer');
  assert.equal(result.savedContent, 'new');
  assert.equal(result.stamp, 'two');
});
