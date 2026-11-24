import test from 'node:test';
import assert from 'node:assert/strict';
import { languageFor, progress, relativeTime } from '../src/domain.ts';

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
