import test from 'node:test';
import assert from 'node:assert/strict';
import { clampSize, languageFor, progress, relativeTime } from '../src/domain.ts';

test('un plan sans étape ne prétend pas être terminé', () => {
  assert.equal(progress({ revision: 0, objective: '', steps: [] }), 0);
  assert.equal(
    progress({
      steps: [
        { status: 'done' },
        { status: 'blocked' },
        { status: 'in_progress' },
        { status: 'pending' },
      ],
    }),
    25,
  );
});
test('les fichiers inconnus restent éditables en texte brut', () => {
  assert.equal(languageFor('src/app.TSX'), 'typescript');
  assert.equal(languageFor('src/main.rs'), 'rust');
  assert.equal(languageFor('some/custom.extension'), 'plaintext');
});
test('un horodatage futur ne produit pas un âge négatif', () => {
  assert.equal(relativeTime(Date.now() + 100000), 'à l’instant');
});
test('une taille de panneau reste dans ses bornes et ignore une valeur corrompue', () => {
  const bounds = { min: 180, max: 640 };
  assert.equal(clampSize(300.4, bounds, 245), 300);
  assert.equal(clampSize(10, bounds, 245), 180);
  assert.equal(clampSize(5000, bounds, 245), 640);
  assert.equal(clampSize(Number('abc'), bounds, 245), 245);
  assert.equal(clampSize(null, bounds, 245), 245);
});

test('language detection covers project filenames, uppercase extensions and executable scripts', () => {
  assert.equal(languageFor('Dockerfile.dev'), 'dockerfile');
  assert.equal(languageFor('Makefile'), 'makefile');
  assert.equal(languageFor('config/settings.toml'), 'toml');
  assert.equal(languageFor('component.vue'), 'vue');
  assert.equal(languageFor('program', '#!/usr/bin/env python3\nprint(1)'), 'python');
  assert.equal(languageFor('App.CS'), 'csharp');
  assert.equal(languageFor('query.sql'), 'sql');
});

test('all fifty language fixtures resolve to the intended editing language', async () => {
  const { readFile } = await import('node:fs/promises');
  const samples = JSON.parse(await readFile(new URL('./fixtures/language-samples.json', import.meta.url), 'utf8'));
  assert.equal(samples.length, 50);
  for (const sample of samples) assert.equal(languageFor(sample.path, sample.code), sample.language, sample.path);
});
