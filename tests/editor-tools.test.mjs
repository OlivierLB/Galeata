import test from 'node:test';
import assert from 'node:assert/strict';
import { applyTextEdits, projectPath, globMatches } from '../src/editorEdits.ts';
import { parseEditorConfig, loadEditorConfig, normalizeSavedText } from '../src/editorConfig.ts';
const edit = (line, start, end, newText) => ({ range: { start: { line, character: start }, end: { line, character: end } }, newText });
test('multifile edit primitives preserve UTF16, CRLF and reject overlaps', () => {
  assert.equal(applyTextEdits('🦀old\r\nnext', [edit(0, 2, 5, 'new'), edit(1, 0, 4, 'last')]), '🦀new\r\nlast');
  assert.throws(() => applyTextEdits('abcd', [edit(0, 0, 3, 'x'), edit(0, 2, 4, 'y')]));
  assert.throws(() => applyTextEdits('a', [edit(1, 0, 1, 'x')]));
  assert.equal(applyTextEdits('a\n', [edit(1, 0, 0, 'b')]), 'a\nb');
});
test('workspace edit URIs stay in the project, including encoded paths', () => {
  assert.equal(projectPath('file:///project/src/a%20b.ts', '/project'), 'src/a b.ts');
  assert.throws(() => projectPath('file:///project-other/a.ts', '/project'));
  assert.throws(() => projectPath('file:///project/%2e%2e/secret', '/project'));
  assert.throws(() => projectPath('https://example.com/project/a', '/project'));
});
test('globs cover nested folders, braces, numeric alternatives and character classes', () => {
  assert.ok(globMatches('src/a.ts', '**/*.{js,ts}'));
  assert.ok(globMatches('a.ts', '**/*.ts'));
  assert.ok(globMatches('src/test3.txt', 'src/test{1..4}.txt'));
  assert.ok(globMatches('src/foo.c', '*.[ch]'));
  assert.ok(!globMatches('src/a.tsx', '**/*.ts'));
});
test('EditorConfig inheritance handles root, unset, per-directory matching and normalization', async () => {
  const files = {
    '.editorconfig': 'root = true\n[*]\nindent_size = 2\nindent_style = space\nend_of_line = lf\ntrim_trailing_whitespace = true\ninsert_final_newline = true',
    'src/.editorconfig': '[*.{ts,tsx}]\nindent_size = 4\n[src/**]\nindent_style = tab',
  };
  const result = await loadEditorConfig('src/a.ts', async path => { if (!files[path]) throw Error('missing'); return files[path]; });
  assert.equal(result.indent_size, '4'); assert.equal(result.indent_style, 'space');
  assert.equal(normalizeSavedText('a  \r\nb\t', result), 'a\nb\n');
  assert.equal(parseEditorConfig('[*.py]\nindent_size = 8', 'a.ts').values.indent_size, undefined);
  const unset = await loadEditorConfig('src/a.ts', async path => path === 'src/.editorconfig' ? '[*]\nindent_size=unset' : files[path]);
  assert.equal(unset.indent_size, undefined);
});
