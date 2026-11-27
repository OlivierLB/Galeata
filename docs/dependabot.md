# Dependabot : traitement des retours

## Mises à jour (PR Dependabot)

`.github/dependabot.yml` ouvre chaque semaine des PR pour npm, cargo et GitHub Actions.
Le workflow `.github/workflows/dependabot-auto-merge.yml` active la fusion automatique
de GitHub sur ces PR, uniquement pour :

- les mises à jour de correctif (`semver-patch`) ;
- les mises à jour mineures d’une version stable (`>= 1.0`).

La fusion n’a lieu qu’après le succès des contrôles obligatoires de `main`
(`frontend`, `native`). Restent à relire à la main : les mises à jour majeures et
les mises à jour mineures d’une version `0.x` (incompatibles au sens semver).

Prérequis côté dépôt : option « Allow auto-merge » activée.

Pour limiter le nombre de PR, les mises à jour de correctif sont regroupées en une
seule PR hebdomadaire par répertoire (npm racine, crash-relay, cargo). Les mises à
jour mineures et majeures restent une PR par dépendance : une mineure `0.x` peut
casser la compatibilité et ne doit pas être fusionnée en lot.

### Mises à jour ignorées

| Paquet | Mises à jour ignorées | Raison | Levée |
| --- | --- | --- | --- |
| `monaco-editor` | mineures (`0.x`) | 0.58 déplace l’API TypeScript (`typescriptDefaults`, `getTypeScriptWorker`…) utilisée par `EditorSurface.tsx` et `languageClient.ts` ; la PR #29 cassait le build. | Retirer la règle `ignore` de `.github/dependabot.yml` avec la migration Monaco. |

## Alertes de sécurité acceptées

Chaque alerte rejetée est listée ici avec sa justification.

| Avis | Paquet | Décision | Justification |
| --- | --- | --- | --- |
| GHSA-wrw7-89jp-8q8g (RUSTSEC-2024-0429) | `glib` 0.18.5 (Rust) | Rejetée : code vulnérable non utilisé | Dépendance transitive de Tauri 2 → `gtk` 0.18 ; aucune mise à jour possible avant le passage de Tauri à GTK 4. `VariantStrIter` n’est appelé ni par Galeata ni par ses dépendances. |

Une règle d’auto-triage (Settings → Code security → Dependabot rules) ferme
automatiquement cet avis s’il réapparaît. Ne pas cibler tout le paquet `glib` :
un futur avis réellement atteignable serait masqué.
