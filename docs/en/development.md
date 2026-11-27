[Français](../fr/development.md) · [English](development.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="développer-et-compiler"></a>

# Develop and compile

Prerequisites: Node.js 24+, Rust stable with Cargo, Git, ripgrep and the Linux dependencies of Tauri 2. Under Ubuntu/Debian:

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev ripgrep
```

Install Rust from its official installer if necessary, then:

```sh
git clone https://github.com/OlivierLB/Galeata.git
cd Galeata
npm ci
npm run doctor
npm run desktop
```

`npm run desktop` compiles interface and gateway MCPThen launch Tauri with Quick. No account Galeata is necessary. Codex and Claude Code are optional: install them and authenticate them separately to use here.

```sh
npm run dev       # Aperçu navigateur, données d’exemple explicitement identifiées
npm run build     # Vérification TypeScript et compilation de l’interface
npm test          # Tests du domaine et de l’aperçu (Node 24)
npm run test:ui   # Parcours Playwright, après npx playwright install chromium
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run package  # Compilation et paquets Linux .deb / AppImage
```

Publish version: align `version` in `package.json`, `src-tauri/tauri.conf.json` and `src-tauri/Cargo.toml`, then push a tag `vX.Y.Z`. Workflow `release.yml` built the AppImage and the `.deb` on Ubuntu 22.04, teste `install.sh` and the start of application in containers Ubuntu 22.04 and 24.04 blanks, then publish the Release. Hand-launched (`gh workflow run release.yml`), he does everything but publish.

Protocol fixings of agents (`tests/fixtures/agents/*.jsonl`) are regenerated with the CLI installed and authenticated. The script consumes a bit of quota, retains existing fixtures except `--force` and removes personal paths, emails, tools and private configuration:

```sh
node scripts/capture-agent-protocol.mjs --provider claude|codex|all [--scenario basic|plan|question|auto|todo] [--force] [--codex-bin CHEMIN]
```

`scripts/probe/` check how the CLI see the tools MCP of the Galeata, with a fake server that logs calls, without touching the application. For example, whether Codex calls the tools without requesting permission and follows the instructions for keeping the plan:

```sh
python3 -I scripts/probe/codex_mcp_probe.py DOSSIER JOURNAL -c 'mcp_servers.galeata.default_tools_approval_mode="approve"' [--task TEXTE] [--instructions TEXTE]
```

The browser version cannot access local files, run a terminal, or connect a service. It presents the interface with an example project. Its demonstration plan is kept in the browser storage, regardless of SQLite.
