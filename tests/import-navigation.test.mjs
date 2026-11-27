import test from 'node:test';
import assert from 'node:assert/strict';
import { importReferences, relativeImportCandidates } from '../src/importNavigation.ts';
test('named import paths retain the local binding position, including multiline aliases', () => {
  const text = "import { languageExtensions } from './domain.ts';\nimport type {\n Thing as LocalThing, Other\n} from '../types';";
  const imports = importReferences(text);
  assert.equal(imports.length, 2);
  assert.equal(text.slice(imports[0].start, imports[0].end), './domain.ts');
  assert.equal(text.slice(imports[0].bindingOffset, imports[0].bindingOffset + 18), 'languageExtensions');
  assert.equal(text.slice(imports[1].bindingOffset, imports[1].bindingOffset + 10), 'LocalThing');
});
test('comments, templates and strings do not become import links', () => {
  assert.deepEqual(importReferences('// import { bad } from "./bad";\n/* import { bad } from "./bad"; */\nconst text = `import { bad } from "./bad";`;'), []);
});
test('default, namespace, side-effect and dynamic imports have predictable targets', () => {
  const source = 'import Main from "./main"; import * as ns from "./ns"; import "./style.css"; const lazy = import("./lazy");';
  const references = importReferences(source);
  assert.equal(references.length, 4);
  assert.equal(source.slice(references[0].bindingOffset, references[0].bindingOffset + 4), 'Main');
  assert.equal(references[1].bindingOffset, undefined);
});
test('relative resolution stays in the project and supports extensions, index files and Vite queries', () => {
  assert.equal(relativeImportCandidates('src/a.ts', './domain.ts')[0], 'src/domain.ts');
  assert.ok(relativeImportCandidates('src/a.ts', './folder').includes('src/folder/index.ts'));
  assert.ok(relativeImportCandidates('src/a.ts', './domain.js').includes('src/domain.ts'));
  assert.equal(relativeImportCandidates('src/a.ts', './worker?worker')[0], 'src/worker');
  assert.deepEqual(relativeImportCandidates('src/a.ts', '../../outside'), []);
  assert.deepEqual(relativeImportCandidates('src/a.ts', 'package'), []);
});
