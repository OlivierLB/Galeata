import test from 'node:test';
import assert from 'node:assert/strict';
import { cleanStepTitle, planSections } from '../src/planDocument.ts';

const step = (id, title, status = 'pending') => ({
  id,
  title,
  status,
  note: '',
  author: 'agent:claude',
  updatedAt: 1,
});
// Shape of a real plan (Helpdesk, 2026-11-24), shortened.
const document = `# Helpdesk Service client : filtre « Demande précise »

## Contexte

Page \`/issues/customer-service\`. Deux besoins.

### Hypothèses retenues
- **H1** — erp-server inclus

## Étapes

### 1. erp-server — opérateur \`_taxonomy_terms_exists_in\`
- Ajouter l'opérateur.

### 2. erp-client — filtre Demande précise
- Champ après Typologie(s).

## Vérification
- PHPUnit ciblé.
`;

test('les titres d’étapes se reconnaissent malgré numérotation et code', () => {
  assert.equal(
    cleanStepTitle('1. erp-server — opérateur `_taxonomy_terms_exists_in`'),
    'erp-server — opérateur _taxonomy_terms_exists_in',
  );
  assert.equal(cleanStepTitle('Étape 2 — Vérifier'), 'vérifier');
});

test('le plan complet garde son texte et place chaque étape à sa section', () => {
  const steps = [
    step('s1', 'erp-server — opérateur _taxonomy_terms_exists_in', 'done'),
    step('s2', 'erp-client — filtre Demande précise', 'in_progress'),
  ];
  const sections = planSections(
    document,
    steps,
    'Helpdesk Service client : filtre « Demande précise »',
    (html) => html,
  );
  assert.deepEqual(
    sections.map((s) => (s.kind === 'step' ? `étape:${s.step.id}` : 'texte')),
    ['texte', 'étape:s1', 'étape:s2', 'texte'],
  );
  const [context, first, second, rest] = sections;
  assert.doesNotMatch(context.html, /<h1/, 'le titre répète l’objectif : retiré');
  assert.match(context.html, /Hypothèses retenues/);
  assert.match(first.html, /Ajouter l&#39;opérateur|Ajouter l'opérateur/);
  assert.match(second.html, /Typologie/);
  assert.match(rest.html, /Vérification/);
});
