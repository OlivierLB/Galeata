import test from 'node:test';
import assert from 'node:assert/strict';
import { changeMarkers } from '../src/editorChanges.ts';

test('maps mixed edits to current lines and keeps removed code in details only', () => {
  const markers = changeMarkers('diff --git a/a b/a\n@@ -1,4 +1,4 @@\n keep\n-old\n+new\n keep\n-last\n+extra\n+addition\n');
  assert.deepEqual(markers.map(({ line, end, kind }) => ({ line, end, kind })), [
    { line: 2, end: 2, kind: 'modified' }, { line: 4, end: 5, kind: 'modified' },
  ]);
  assert.equal(markers[0].detail, '-old\n+new');
});
test('anchors deletion at the start and recognizes pure additions', () => {
  assert.equal(changeMarkers('@@ -1 +0,0 @@\n-gone\n')[0].line, 1);
  assert.equal(changeMarkers('@@ -0,0 +1,2 @@\n+one\n+two\n')[0].kind, 'added');
  assert.deepEqual(changeMarkers(''), []);
});
