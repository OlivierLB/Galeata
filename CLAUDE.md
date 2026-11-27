# Galeata — guide pour les agents

IDE local **Linux uniquement** (Tauri 2 + Rust, React 19 + TypeScript + Vite) pour travailler avec Codex / Claude Code. Voir `README.md`, `docs/fr/mcp.md` (contrat MCP) et `docs/fr/validation.md` (ce qui est prouvé ou non).

## Architecture

- `src-tauri/src/lib.rs` : `State::dispatch(method, args, agent)` est l'**unique point d'entrée**, utilisé par l'UI (commande Tauri `request`, `agent=false`) et par MCP (`agent=true`). Toute mutation (fichiers, git, terminal, remote, préférences) est gardée par `if !agent`. Un nouvel outil MCP doit être déclaré dans `mcp.rs::tools()` (schéma strict, `additionalProperties: false`) **et** documenté dans `docs/fr/mcp.md`.
- Modules : `workspace.rs` (confinement des chemins, écriture avec `stamp` anti-écrasement, recherche rg, `run_outcome` borné en temps/taille), `git.rs`, `store.rs` (SQLite : plans révisionnés, événements, préférences ; mise à jour du plan et son événement dans la même transaction), `terminal.rs` (PTY, injection de la config MCP), `sessions.rs`, `remote.rs` (jetons dans Secret Service uniquement), `bin/galeata-mcp.rs` (passerelle stdio → socket Unix).
- `src-tauri/crates/agent-protocol` : bibliothèque pure (sans Tauri) qui pilote Claude Code (`-p` stream-json) et Codex (`app-server`), les normalise en `AgentEvent` et gère le processus. Testable sans GTK : `cargo test -p galeata-agent-protocol`. Fixtures : `tests/fixtures/agents/`, regénérées par `scripts/capture-agent-protocol.mjs`.
- **Performance d'abord** : c'est le critère de tous les choix techniques (filtrer et regrouper au plus près de la source, bornes de taille, pas de re-rendu global).
- Front : `src/App.tsx` (gros composant principal), `src/api.ts` (`request()` vers Tauri, ou **mode aperçu navigateur** avec données factices si hors Tauri), `src/components/`.

## Règles

- Code, commentaires, commits : anglais (Conventional Commits : `feat:`, `fix:`, `test:`…). Textes de l'UI et messages d'erreur utilisateur : français. Documentation : modifier uniquement `docs/fr/` ; `docs/en/` est généré automatiquement avec Argos Translate. Voir `docs/fr/translation.md`. Ne pas modifier les traductions anglaises directement ; corriger la source ou le glossaire.
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

## Variables de style

Les valeurs communes de typographie, espacement, arrondi, dimensions des contrôles et icônes se définissent dans `src/ui-tokens.css`. Les réutiliser dans toutes les vues ; éviter de réintroduire ces valeurs en dur. Les composants canvas (Monaco, terminal) lisent les valeurs avec `src/uiTokens.ts`, sans recopier de constantes. Les préférences utilisateur et la géométrie dynamique des panneaux restent prioritaires. Les tests `tests/ui-tokens.test.mjs` contrôlent les déclarations CSS et les références aux variables.

## Icônes

Toutes les icônes d’interface, présentes et futures, utilisent exclusivement les **Doodle Icons de Khushmeen** (https://khushmeen.com/icons, CC0), conservées dans `public/icons/`. Utiliser `src/components/Icon.tsx` et les noms de `src/doodleIcons.ts` ; compléter les alias sémantiques au besoin. Ne pas introduire de tracés SVG maison, d’emoji ou de caractères Unicode comme icônes, ni une autre bibliothèque. Les illustrations, le logo de marque et le contenu des utilisateurs ne sont pas des icônes d’interface. Les icônes internes de Monaco sont remplacées par les masques de `src/doodle-monaco.css`.

La mascotte animée est explicitement exclue de toute migration d’icônes : préserver son apparence, ses sprites, ses animations et son affichage de secours.
