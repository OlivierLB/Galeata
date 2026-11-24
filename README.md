# Galeata

Un IDE local pour développer avec vos agents : fichiers, code, terminal, Git, plan vivant et reprise de sessions dans le même espace.

**Version 0.1.0 en développement. Linux uniquement pour cette première version.** Le code natif et les intégrations distantes demandent encore une validation sur une machine équipée de Rust et WebKitGTK ; voir [l’état des vérifications](docs/validation.md).

## Démarrer

Prérequis : Node.js 24+, Rust stable avec Cargo, Git, ripgrep et les dépendances Linux de Tauri 2. Sous Ubuntu/Debian :

```sh
sudo apt-get update
sudo apt-get install build-essential pkg-config libwebkit2gtk-4.1-dev libgtk-3-dev libssl-dev libdbus-1-dev libayatana-appindicator3-dev librsvg2-dev ripgrep
```

Installer Rust depuis son installateur officiel si nécessaire, puis :

```sh
git clone https://github.com/OlivierLB/Galeata.git
cd Galeata
npm install
npm run doctor
npm run desktop
```

`npm run desktop` compile l’interface et la passerelle MCP, puis lance Tauri avec Vite. Aucun compte Galeata n’est nécessaire. Codex et Claude Code sont facultatifs : installez-les et authentifiez-les séparément pour les utiliser ici.

```sh
npm run dev       # Aperçu navigateur, données d’exemple explicitement identifiées
npm run build     # Vérification TypeScript et compilation de l’interface
npm test          # Tests du domaine et de l’aperçu (Node 24)
npm run test:ui   # Parcours Playwright, après npx playwright install chromium
cargo test --manifest-path src-tauri/Cargo.toml
npm run package  # Compilation et paquets Linux .deb / AppImage
```

La version navigateur ne peut ni accéder aux fichiers locaux, ni exécuter de terminal, ni connecter un service. Elle présente l’interface avec un projet d’exemple. Son plan de démonstration est conservé dans le stockage du navigateur, indépendamment de SQLite.

## Fonctions de cette version

- Dossiers, arborescence progressive, onglets, édition Monaco et recherche ripgrep paginée.
- Création de fichiers et dossiers, renommage et suppression de fichiers ; détection des modifications externes et refus d’écrasement silencieux.
- Terminal PTY avec le shell local ; plusieurs onglets persistants tant que l’application reste ouverte.
- Diff local et indexé, staging, désindexation, commit, branches, worktrees, fetch, pull en avance rapide et push.
- Plan SQLite avec historique transactionnel, révision, étapes, blocages et propositions de changement de périmètre.
- Lancement et reprise de Codex / Claude Code ; découverte locale de leurs sessions associées au dossier.
- Activité et sous-agents déclarés via MCP ; métadonnées historiques lorsqu’elles sont disponibles ; passations et signalement des fichiers revendiqués par plusieurs agents.
- Connexions GitHub / GitLab, demandes ouvertes, fichiers modifiés et résultats CI. Jetons conservés dans le coffre Linux Secret Service.
- Restauration des fichiers ouverts, palette `Ctrl P`, sauvegarde `Ctrl S`, panneau terminal `Ctrl ` + accent grave.

Une étape annoncée terminée ne signifie pas que ses tests ont réussi. Les vérifications rapportées par un agent conservent la provenance `agent_reported`. Un statut d’agent est une déclaration datée, pas une déduction à partir du texte du terminal.

## Architecture

```text
React / TypeScript ── commandes Tauri ──┐
                                      ├── services Rust ── fichiers / Git / SQLite / PTY
Codex / Claude ── MCP stdio ── socket ──┘
```

Le processus de bureau est la source de vérité. `galeata-mcp` est une passerelle de transport vers ce processus ; il ne crée pas de seconde base de données et ne gère pas un autre index de fichiers. Voir [le contrat MCP](docs/mcp.md).

Les commandes système reçoivent des arguments structurés, sans concaténation dans un shell. Les recherches et commandes ont une durée et une taille de sortie bornées. Les opérations Git distantes utilisent vos mécanismes d’authentification Git existants. Les connexions aux API utilisent un jeton distinct, stocké dans le coffre système.

Les données de l’IDE résident dans le répertoire applicatif Linux de Tauri, normalement `$XDG_DATA_HOME/dev.olivierlb.galeata` ou `~/.local/share/dev.olivierlb.galeata`. Aucun contenu de session n’est envoyé à un service Galeata. Lancer un fournisseur IA conserve les règles réseau et de confidentialité de ce fournisseur.

## Limites actuelles

- Intégration initiale avec les CLI Codex et Claude Code ; les formats locaux de sessions peuvent évoluer. Les versions exactes de compatibilité doivent encore être validées en natif.
- Découverte bornée : 5 000 fichiers de session collectés, 3 000 analysés et 100 sessions retournées. Les premières et dernières fenêtres de 64 Kio sont examinées ; certains résumés peuvent ne pas être disponibles.
- Fichiers UTF-8 jusqu’à 2 Mio. Les fichiers binaires et encodages différents sont signalés.
- Pas de LSP complet, débogueur, extensions VS Code, hébergement d’agents ou synchronisation cloud dans cette version.
- Les agents peuvent omettre de rapporter leur activité. Le MCP ne garantit pas une observation exhaustive ; les sorties de terminal restent accessibles.
- Pas de restauration de processus après arrêt de l’application. Les sessions restent reprenables via les outils qui les prennent en charge.
- Les listes distantes sont bornées à 50 PR/MR, 100 fichiers et 100 résultats CI ; la pagination distante et les revues en écriture restent à ajouter.
- Les conflits Git se traitent dans l’éditeur ou le terminal ; aucune fusion automatique n’est déclenchée.
- Un coffre Secret Service fonctionnel est requis pour les jetons d’API. Aucun stockage en clair de secours.

Les budgets de performance du plan sont des objectifs, pas des résultats mesurés. La compilation native, les mesures sur un dépôt de 50 000 fichiers et les essais d’intégration font partie des prochaines validations.

## Identité

Logo original fourni par OlivierLB, conservé dans `public/galeata-logo.svg`. Les icônes Linux dérivent de son symbole. Palette : bleu nuit `#19254B` et lavande `#BFA9F6`.

Aucune licence de redistribution n’a encore été choisie.
