# Galeata

Un IDE local pour développer avec vos agents : fichiers, code, terminal, Git, plan vivant et reprise de sessions dans le même espace.

**Version 0.1.0 en développement. Linux uniquement pour cette première version.** La compilation, les tests et le paquet Debian sont validés dans la CI. Les essais interactifs et les connexions aux comptes restent à effectuer ; voir [l’état des vérifications](docs/validation.md).

## Installer Galeata

Une seule commande, sans sudo ni dépendance à installer (Linux x86_64) :

```sh
curl -fsSL https://raw.githubusercontent.com/OlivierLB/Galeata/main/install.sh | sh
```

Galeata apparaît dans le menu des applications et la commande `galeata` est ajoutée dans `~/.local/bin`. Relancer la même commande met Galeata à jour ; `sh install.sh --uninstall` la retire en conservant vos projets, plans et préférences.

Il vous faut **Claude Code ou Codex** : un seul des deux suffit. Galeata les détecte et vous guide au premier lancement s’il n’en trouve aucun.

<details>
<summary>Ce que fait l’installateur</summary>

- Il télécharge l’AppImage de la dernière [Release](https://github.com/OlivierLB/Galeata/releases) (toutes les bibliothèques sont incluses) et vérifie son empreinte SHA-256.
- Il l’extrait dans `~/.local/share/galeata`, sans FUSE, ce qui donne aussi un démarrage plus rapide qu’une AppImage montée. Il garde la version précédente pour pouvoir revenir en arrière.
- Il conserve aussi les versions utilisées par une fenêtre ou un processus auxiliaire encore ouvert, afin de préserver leurs bibliothèques. Elles seront nettoyées lors d’une installation ultérieure, après leur fermeture. Relancez Galeata pour utiliser la nouvelle version.
- Il ne remplace jamais un fichier qu’il n’a pas créé, et ne touche pas aux données de l’application (`~/.local/share/dev.olivierlb.galeata`).
- Variables : `GALEATA_VERSION=v0.2.0` pour installer une version précise, `GALEATA_BIN_DIR` pour un autre dossier de commande.

Construite sur Ubuntu 22.04 : fonctionne sur Pop!_OS 22.04 et les distributions plus récentes. Chaque Release contient aussi un paquet `.deb` (`sudo apt install ./galeata-linux-amd64.deb`).
</details>

Pour les développeurs, `python3 scripts/install-linux.py` installe la dernière compilation de la CI (nécessite GitHub CLI connecté).

## Développer et compiler

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

## Fonctions de cette version

- Dossiers, arborescence progressive, onglets, édition Monaco et recherche ripgrep paginée.
- Pages dédiées Fichiers, Recherche, Git et Agents : accueil des fichiers, résultats groupés avec aperçu et vue d’ensemble Git avec comparateur.
- Création de fichiers et dossiers, renommage et suppression de fichiers ; détection des modifications externes et refus d’écrasement silencieux.
- Terminal PTY avec le shell local ; plusieurs onglets persistants tant que l’application reste ouverte.
- Diff local et indexé, staging, désindexation, commit, branches, worktrees, fetch, pull en avance rapide et push.
- [Gestion Git simplifiée](docs/git.md) depuis la branche en bas à gauche : branches locales/distantes, changement, fusion, résolution/annulation de fusion, stash et premier push.
- Plan SQLite avec historique transactionnel, révision, étapes, blocages et propositions de changement de périmètre.
- Lancement et reprise de Codex / Claude Code ; découverte locale de leurs sessions associées au dossier.
- Choix du modèle par conversation IA, parmi les modèles renvoyés par la CLI du fournisseur ; le choix s’applique au prochain message, après la fin du tour en cours.
- Composeur Agents : `/` ouvre les commandes, `@` cherche un fichier du projet et `$` cherche un skill installé. Les références sont insérées dans le brouillon pour relecture avant envoi. Le skill est appelé par une instruction explicite avec son chemin `SKILL.md`.
- Mode Plan pour Claude et Codex (mode de collaboration natif Codex, appliqué au prochain tour). `Maj+Tab` parcourt les modes ; `Ctrl+Alt+P` alterne Plan et Auto. `/compact` ou l’indicateur « Contexte » utilise la compaction native de la conversation au repos.
- Dans le composeur : `Ctrl+Alt+F` fichiers, `Ctrl+Alt+S` skills, `Ctrl+Alt+C` compaction et `Ctrl+Alt+/` commandes. Flèches pour parcourir les suggestions, Entrée pour choisir et Échap pour fermer ; `Maj+Entrée` ajoute une ligne.
- `Tab` place le brouillon dans la file de la conversation, pour Codex comme pour Claude. Les messages partent un par un après la fin complète du tour précédent, y compris dans un autre onglet ; si l’agent est déjà au repos, le premier part immédiatement. Une autorisation ou une question en attente bloque l’envoi. Un échec ou une interruption met la file en pause ; vous pouvez la reprendre ou retirer un message. `Entrée` conserve l’envoi immédiat. La file reste en mémoire tant que la conversation est ouverte.
- [Mascotte tortue](docs/mascot.md) animée en bas de la barre de navigation : réflexion, écriture, outils, attente et célébrations, avec pause et respect de la réduction des animations.
- Bouton « Texte uniquement » pour masquer puis réafficher commandes, outils et raisonnements ; le choix est mémorisé et les demandes d’autorisation restent accessibles.
- Activité et sous-agents déclarés via MCP ; métadonnées historiques lorsqu’elles sont disponibles ; passations et signalement des fichiers revendiqués par plusieurs agents.
- Restauration des fichiers ouverts, palette `Ctrl P`, sauvegarde `Ctrl S`, panneau terminal avec Ctrl et la touche accent grave.

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

Les budgets de performance du plan sont des objectifs, pas des résultats mesurés. Les mesures sur un dépôt de 50 000 fichiers et les essais interactifs d’intégration restent à effectuer.

## Identité

Logo original fourni par OlivierLB, conservé dans `public/galeata-logo.svg`. Les icônes Linux dérivent de son symbole. Palette : bleu nuit `#19254B` et lavande `#BFA9F6`.

## Licence et contributions

Galeata est distribué sous [PolyForm Shield 1.0.0](LICENSE). Son code source est disponible ; cette licence n’est pas une licence open source au sens de l’OSI.

Vous pouvez utiliser Galeata, notamment dans votre activité professionnelle, le modifier et contribuer au projet. La licence interdit de fournir un produit concurrent dans les conditions et avec les exceptions de son texte officiel, y compris un produit concurrent gratuit. Elle n’interdit pas tous les forks et n’impose pas de reverser les modifications.

Les forks destinés aux contributions sont les bienvenus : voir [CONTRIBUTING.md](CONTRIBUTING.md). Le texte de la licence fait foi ; ce résumé ne le modifie pas. Les dépendances et ressources tierces conservent leurs licences respectives.
