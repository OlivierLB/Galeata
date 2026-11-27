[Français](development.md) · [English](../en/development.md)

# Développer et compiler

Prérequis : Node.js 24+, Rust stable avec Cargo, Git, ripgrep et les dépendances Linux de Tauri 2. Sous Ubuntu/Debian :

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev ripgrep
```

Installer Rust depuis son installateur officiel si nécessaire, puis :

```sh
git clone https://github.com/OlivierLB/Galeata.git
cd Galeata
npm ci
npm run doctor
npm run desktop
```

`npm run desktop` compile l’interface et la passerelle MCP, puis lance Tauri avec Vite. Aucun compte Galeata n’est nécessaire. Codex et Claude Code sont facultatifs : installez-les et authentifiez-les séparément pour les utiliser ici.

```sh
npm run dev       # Aperçu navigateur, données d’exemple explicitement identifiées
npm run build     # Vérification TypeScript et compilation de l’interface
npm test          # Tests du domaine et de l’aperçu (Node 24)
npm run test:ui   # Parcours Playwright, après npx playwright install chromium
cargo test --locked --manifest-path src-tauri/Cargo.toml
npm run package  # Compilation et paquets Linux .deb / AppImage
```

Publier une version : aligner `version` dans `package.json`, `src-tauri/tauri.conf.json` et `src-tauri/Cargo.toml`, puis pousser un tag `vX.Y.Z`. Le workflow `release.yml` construit l’AppImage et le `.deb` sur Ubuntu 22.04, teste `install.sh` et le démarrage de l’application dans des conteneurs Ubuntu 22.04 et 24.04 vierges, puis publie la Release. Lancé à la main (`gh workflow run release.yml`), il fait tout sauf publier.

Les fixtures de protocole des agents (`tests/fixtures/agents/*.jsonl`) se régénèrent avec les CLI installées et authentifiées. Le script consomme un peu de quota, conserve les fixtures existantes sauf `--force` et retire chemins personnels, e-mails, outils et configuration privée :

```sh
node scripts/capture-agent-protocol.mjs --provider claude|codex|all [--scenario basic|plan|question|auto|todo] [--force] [--codex-bin CHEMIN]
```

`scripts/probe/` vérifie comment les CLI voient les outils MCP de Galeata, avec un serveur factice qui journalise les appels, sans toucher à l’application. Par exemple, pour savoir si Codex appelle les outils sans demander d’autorisation et suit la consigne de tenue du plan :

```sh
python3 -I scripts/probe/codex_mcp_probe.py DOSSIER JOURNAL -c 'mcp_servers.galeata.default_tools_approval_mode="approve"' [--task TEXTE] [--instructions TEXTE]
```

La version navigateur ne peut ni accéder aux fichiers locaux, ni exécuter de terminal, ni connecter un service. Elle présente l’interface avec un projet d’exemple. Son plan de démonstration est conservé dans le stockage du navigateur, indépendamment de SQLite.
