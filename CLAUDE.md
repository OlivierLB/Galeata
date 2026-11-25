# Galeata — guide pour les agents

IDE local **Linux uniquement** (Tauri 2 + Rust, React 19 + TypeScript + Vite) pour travailler avec Codex / Claude Code. Voir `README.md`, `docs/mcp.md` (contrat MCP) et `docs/validation.md` (ce qui est prouvé ou non).

## Architecture

- `src-tauri/src/lib.rs` : `State::dispatch(method, args, agent)` est l'**unique point d'entrée**, utilisé par l'UI (commande Tauri `request`, `agent=false`) et par MCP (`agent=true`). Toute mutation (fichiers, git, terminal, remote, préférences) est gardée par `if !agent`. Un nouvel outil MCP doit être déclaré dans `mcp.rs::tools()` (schéma strict, `additionalProperties: false`) **et** documenté dans `docs/mcp.md`.
- Modules : `workspace.rs` (confinement des chemins, écriture avec `stamp` anti-écrasement, recherche rg, `run_outcome` borné en temps/taille), `git.rs`, `store.rs` (SQLite : plans révisionnés, événements, préférences ; mise à jour du plan et son événement dans la même transaction), `terminal.rs` (PTY, injection de la config MCP), `sessions.rs`, `remote.rs` (jetons dans Secret Service uniquement), `bin/galeata-mcp.rs` (passerelle stdio → socket Unix).
- `src-tauri/crates/agent-protocol` : bibliothèque pure (sans Tauri) qui pilote Claude Code (`-p` stream-json) et Codex (`app-server`), les normalise en `AgentEvent` et gère le processus. Testable sans GTK : `cargo test -p galeata-agent-protocol`. Fixtures : `tests/fixtures/agents/`, regénérées par `scripts/capture-agent-protocol.mjs`.
- **Performance d'abord** : c'est le critère de tous les choix techniques (filtrer et regrouper au plus près de la source, bornes de taille, pas de re-rendu global).
- Front : `src/App.tsx` (gros composant principal), `src/api.ts` (`request()` vers Tauri, ou **mode aperçu navigateur** avec données factices si hors Tauri), `src/components/`.

## Règles

- Code, commentaires, commits : anglais (Conventional Commits : `feat:`, `fix:`, `test:`…). Textes de l'UI, messages d'erreur utilisateur, docs : français.
- Commandes système : arguments structurés, jamais de concaténation dans un shell ; durée et taille de sortie bornées.
- Provenance : une vérification rapportée par un agent reste `agent_reported` ; seul `verification.run` produit `galeata_observed`. Ne pas confondre `done` et « vérifié ».
- Pas de secret en clair, pas de stockage de jeton hors du coffre système.
- Ne pas découper/refactorer `App.tsx` sans que la tâche l'exige.

## Vérification

Rust est installé en local via rustup dans `~/.cargo/bin` (ajouter au PATH si besoin : `export PATH=$HOME/.cargo/bin:$PATH`).

```sh
npm ci
npm test                 # tests JS (Node 24)
npm run build            # tsc + vite
npm run test:ui          # Playwright (après npx playwright install chromium)
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --workspace
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --workspace --all-targets
python3 -m unittest discover -s tests -p 'test_install_*.py' -v
npm run desktop          # lancement natif (nécessite les libs GTK/WebKit du README)
```

La CI (`.github/workflows/ci.yml`) exécute la même batterie sur Ubuntu 22.04/24.04.

**Après chaque modification** : `sh scripts/install-local.sh`. Le script compile dans Docker (Ubuntu 22.04, sans dépendance sur le poste) et installe avec `install.sh`, pour que l'utilisateur puisse tester tout de suite. Indiquer ensuite s'il faut relancer Galeata. Sans GTK sur le poste, la partie Rust se vérifie avec `sh scripts/build-linux-docker.sh check`.
