# Galeata — analyse du projet et préparation du travail (debug / features)

## Contexte

Olivier veut reprendre Galeata (IDE local Linux pour travailler avec Codex / Claude Code) pour corriger des bugs et ajouter des fonctionnalités. Cette session a analysé le dépôt en lecture seule. Le plan ci-dessous : (1) carte du projet, (2) points de risque repérés, (3) mise en place minimale pour travailler, (4) choix de la première cible.

## 1. Carte du projet (vérifié en lisant le code, commit `f29ba08`, arbre propre)

- **Stack** : Tauri 2 + Rust (backend), React 19 + TypeScript + Vite 6 (front), Monaco, xterm.js, SQLite (rusqlite bundled), PTY (portable-pty), keyring Secret Service, ureq (API GitHub/GitLab).
- **Taille** : environ 4 000 lignes utiles. Fichiers centraux :
  - `src-tauri/src/lib.rs` (406 lignes) : `State` + `State::dispatch(method, args, agent)`, **unique point d'entrée** pour l'UI (commande Tauri `request`) et pour MCP (`agent=true`). Les mutations sont gardées par `if !agent`. Watcher `notify` et `open_workspace`.
  - `workspace.rs` (confinement des chemins, lecture/écriture avec `stamp`, recherche rg, `run_outcome` borné), `git.rs`, `store.rs` (plans révisionnés + événements + préférences), `terminal.rs` (PTY, lancement codex/claude avec config MCP injectée), `mcp.rs` (serveur socket Unix + schémas d'outils), `sessions.rs` (découverte des sessions Codex/Claude), `remote.rs` (GitHub/GitLab), `bin/galeata-mcp.rs` (passerelle stdio → socket).
  - `src/App.tsx` (**1 962 lignes, monolithe** : panneaux, onglets, plan, terminaux, git, dialogues), `src/api.ts` (`request()` → Tauri, ou **mode aperçu navigateur** avec données factices), `src/components/*`, `src/styles.css` (2 036 lignes).
- **Contrats** : `docs/mcp.md` (outils MCP, révision du plan, `REVISION_CONFLICT`, provenance `agent_reported` vs `galeata_observed`), `docs/validation.md` (ce qui est prouvé / reste à essayer).
- **Tests** : 7 JS (`tests/*.test.mjs`), 3 Playwright (`tests/ui/`), 10 Rust (inline `#[cfg(test)]`), 5 Python (installateur). CI GitHub `.github/workflows/ci.yml` (Ubuntu 24.04 front, 22.04 natif + paquet .deb).
- **Installation locale** : déjà installé via `scripts/install-linux.py` dans `~/.local/share/galeata` + `~/.local/bin/galeata`.
- **Pas de CLAUDE.md / AGENTS.md / skills** dans le dépôt.

## 2. Contraintes de l'environnement local (vérifié)

- Node v24.11 OK, ripgrep OK, `gh` OK.
- **`cargo`/`rustc` absents**, `libgtk-3-dev` / `libwebkit2gtk-4.1-dev` non installés → aucune compilation ni test Rust possible localement aujourd'hui ; seule la CI valide le natif.
- **`node_modules/` vide** → `npm ci` nécessaire avant `npm test` / `npm run build`.

## 3. Risques / bugs probables repérés (suspectés, non reproduits)

1. **Watcher en throttle, pas en debounce** (`lib.rs`, `open_workspace`) : les événements dans les 200 ms suivant le premier sont *ignorés*, sans émission finale → l'arbre/Git peut rester périmé après une rafale (ex. `git checkout`, génération par un agent).
2. **Lancement `codex` / `claude` via PATH** (`terminal.rs::start`, `CommandBuilder::new(kind)`) : sur ce poste, `codex` et `claude` sont des **fonctions zsh** (`codex` → `codex-headroom`). Galeata ne les voit pas : il lancera le binaire brut (sans Headroom) ou échouera si absent du PATH du lanceur bureau.
3. **Schéma SQLite sans versionnement** (`store.rs::open`, `CREATE TABLE IF NOT EXISTS`) : toute évolution de schéma demandera une migration ad hoc.
4. **`App.tsx` monolithique** : toute feature UI touchera ce fichier ; risque de régression élevé, à découper seulement quand une feature l'exige (pas de refactor gratuit).
5. Essais natifs jamais faits (cf. `docs/validation.md`) : ouverture de dossier, terminal, reprise de sessions, MCP réel, Secret Service.

## 4. Mise en place proposée (avant tout debug/feature)

1. Copier ce plan dans `/home/lebloasolivier/perso/Galeata/.claude/plans/analyse-projet.md` (standard : plan dans le projet) et y tenir un journal.
2. `npm ci`, puis batterie front : `npm test`, `npm run build`, (`npx playwright install chromium && npm run test:ui`).
3. **Avec accord explicite** (installe des paquets, `sudo` pour apt) : toolchain Rust via rustup + dépendances apt du README → `cargo fmt --check`, `cargo test --locked`, `cargo clippy`, puis `npm run desktop` pour le premier essai natif.
4. Créer un `CLAUDE.md` court dans le dépôt : stack, commandes de vérification, règle `dispatch`/`agent`, conventions (code/commits en anglais, UI/docs en français), contraintes (Linux only, pas de secrets en clair).
5. Premier parcours natif manuel (liste de `docs/validation.md`) pour constituer la liste de bugs réels.

## Décisions d'Olivier (2026-11-24)

- Toolchain : **installer en local**. rustup en mode utilisateur (sans sudo) ; les paquets apt (sudo) sont lancés par Olivier via `! sudo apt-get install …` (liste exacte du README).
- CLAUDE.md : **oui**. Fichier court ; on le commite seulement après accord explicite.
- Première cible : **un bug ou une feature qu'Olivier décrira** (pas encore précisé). Les étapes 1 à 4 se font d'abord, puis on lui demande la description et on fait reproduire avant de corriger.

## Vérification

- Front : sortie réelle de `npm test`, `npm run build`, `npm run test:ui`.
- Natif : `cargo test --locked --manifest-path src-tauri/Cargo.toml`, `cargo clippy … --all-targets`, `cargo fmt … --check` ; à défaut de toolchain, push sur une branche et lecture du run CI via `gh run view`.
- Chaque bug corrigé : test de régression (Rust inline ou `tests/*.test.mjs`) + reproduction manuelle dans `npm run desktop`.

## Hors périmètre (noté, non fait)

- Découpage de `App.tsx`, migrations SQLite versionnées, support macOS/Windows, licence.

## Journal

- 2026-11-24 : plan approuvé ; démarrage de la mise en place (étapes 1 à 4).
- 2026-11-24 : npm ci ; npm test 7/7 ; build OK ; Playwright 3/3 ; rustup 1.100 installé (~/.cargo/bin) ; cargo fmt --check OK ; CLAUDE.md rédigé (non commité). En attente : apt des libs GTK/WebKit (sudo, par Olivier) puis cargo test/clippy et npm run desktop.
- 2026-11-24 : demande 1 (panneaux redimensionnables à la souris) faite : composant Splitter (souris, clavier, double-clic = réinitialiser), tailles mémorisées dans localStorage, l éditeur garde au moins 320 px de large et 120 px de haut. npm test 8/8, Playwright 4/4, build OK. Non commité. Pas encore essayé en natif (libs GTK absentes).
