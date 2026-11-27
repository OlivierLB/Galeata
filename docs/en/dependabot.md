[Français](../fr/dependabot.md) · [English](dependabot.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="dependabot--traitement-des-retours"></a>

# Dependabot: processing returns

<a id="mises-à-jour-pr-dependabot"></a>

## Updates (PR Dependabot)

`.github/dependabot.yml` Opens weekly PRs for npm, cargo and GitHub Actions.
Workflow `.github/workflows/dependabot-auto-merge.yml` activates automatic merge
of the GitHub on these PRs, only for:

- patch updates (`semver-patch`) ;
- minor updates to a stable version (`>= 1.0`).

The merger takes place only after the mandatory controls have been passed. `main`
(`frontend`, `native`). There is still a need to read by hand: major updates and
minor updates of a version `0.x` (incompatible in the sense of semver).

Prerequisites side repository : option « Allow auto-merge » activated.

To limit the number of PRs, patch updates are grouped into one
only weekly PR per directory (npm root, crash-relay, cargo). The bets
minor and major days remain PR per addiction: a minor `0.x` may
break compatibility and should not be merged into a batch.

<a id="mises-à-jour-ignorées"></a>

### Unknown updates

| Package | Unknown updates | Reason | Raised |
| --- | --- | --- | --- |
| `monaco-editor` | minor (`0.x`) | 0.58 movesAPI TypeScript (`typescriptDefaults`, `getTypeScriptWorker`...) used by `EditorSurface.tsx` and `languageClient.ts` ; PR #29 broke the build. | Remove Rule `ignore` of the `.github/dependabot.yml` with migration Monaco. |

<a id="alertes-de-sécurité-acceptées"></a>

## Security alerts accepted

Each rejected alert is listed here with its justification.

| Announcements | Package | Decision | Justification |
| --- | --- | --- | --- |
| GHSA-wrw7-89jp-8q8g (RUSTSEC-2024-0429) | `glib` 0.18.5 (Rust) | Rejected: Vulnerable code not used | Transitive Dependence of Tauri 2 → `gtk` 0.18; no update possible before the changeover from Tauri to GTK 4. `VariantStrIter` is called neither by Galeata Or his addictions. |

A self-triage rule (Settings → Security code → Dependbot rules) closes
automatically this notice if it reappears. Do not target the entire package `glib` :
A future opinion that is truly achievable would be masked.
