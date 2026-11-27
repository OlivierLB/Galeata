import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { checkDocs, inspectMarkdown } from '../scripts/check-docs.mjs';

test('inspects actual links, duplicate headings, explicit anchors and code', () => {
  const { anchors, links, code } = inspectMarkdown('# Même titre\n# Même titre\n<a id="stable"></a>\n[x](a.md#stable)\n`[not a link](missing.md)`\n');
  assert.deepEqual([...anchors], ['même-titre', 'même-titre-1', 'stable']);
  assert.deepEqual(links, ['a.md#stable']);
  assert.equal(code.length, 1);
});

test('checks anchors and permits stale English only during source validation', (t) => {
  const root = mkdtempSync(join(tmpdir(), 'galeata-docs-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'docs/fr'), { recursive: true });
  mkdirSync(join(root, 'docs/en'));
  for (const name of ['README', 'CONTRIBUTING', 'SECURITY', 'CLAUDE']) writeFileSync(join(root, `${name}.md`), '# Root\n');
  writeFileSync(join(root, 'docs/fr/a.md'), '# Bonjour\n[English](../en/a.md#bonjour)\n');
  assert.doesNotThrow(() => checkDocs(root));
  assert.throws(() => checkDocs(root, true), /page lists differ/);
  writeFileSync(join(root, 'docs/en/a.md'), '# Hello\n<a id="bonjour"></a>\n');
  assert.doesNotThrow(() => checkDocs(root, true));
  writeFileSync(join(root, 'docs/fr/a.md'), '# Bonjour\n[x](a.md#absent)\n');
  assert.throws(() => checkDocs(root), /missing anchor/);
  writeFileSync(join(root, 'docs/fr/a.md'), '# Bonjour\n`npm test`\n');
  assert.throws(() => checkDocs(root, true), /code.*differ/);
});
