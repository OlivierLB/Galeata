# Installation hyper simple pour les utilisateurs

## Contexte

Olivier (2026-11-24) : « Faut que l'installation soit hyper simple pour les utilisateurs ! » et « Claude et Codex sont optionnels. Il faut un des deux mais pas forcément les deux. »

Avant : cloner le dépôt + Python + GitHub CLI connecté (`gh auth login`, même dépôt public) + bibliothèques système à installer soi-même (l'installateur s'arrêtait sur `ldd … not found`) + aucune Release publique.

## Décisions d'Olivier

- Une ligne, sans sudo : `curl -fsSL https://raw.githubusercontent.com/OlivierLB/Galeata/main/install.sh | sh`.
- Release : workflow préparé, **publication plus tard** (tag poussé seulement avec son accord).
- Claude Code / Codex : accueil guidé dans l'application, **seulement si aucune des deux n'est installée** ; une seule suffit.

## Fait (2026-11-24)

- `install.sh` (POSIX, testé sous dash) : télécharge `galeata-linux-x86_64.AppImage` + `SHA256SUMS` (+ `VERSION`) de la dernière Release, vérifie le SHA-256, extrait l'AppImage (pas de FUSE, démarrage plus rapide qu'un montage), bascule atomique `current`, garde 2 versions, lanceur `~/.local/bin/galeata` (PATH des CLI mémorisé pour les lancements depuis le menu), entrée de menu, `--uninstall` (données conservées), refus d'écraser un fichier étranger, tout dans `main()` contre l'exécution d'un script tronqué.
- `tests/test_install_sh.py` : 9 tests ; essai réel dans un conteneur Ubuntu 22.04 vierge (fausse AppImage).
- `.github/workflows/release.yml` : sur tag `v*` (publication) ou à la main (essai à blanc) ; build Ubuntu 22.04, contrôle de cohérence des versions, AppImage + deb, `SHA256SUMS`, **test de fumée dans Ubuntu 22.04 et 24.04 vierges** (`scripts/smoke-release.sh` : install.sh, passerelle MCP, bibliothèques, démarrage 15 s sous Xvfb).
- CI : tests `test_install_*.py`. README : installation en une ligne en tête ; procédure de publication.

## Reste à faire

1. Premier essai à blanc du workflow Release (nécessite commit + push autorisés), puis corriger ce que le test de fumée révélera (passerelle MCP dans l'AppImage, bibliothèques non embarquées, D-Bus…).
2. Accueil au premier lancement (avec l'interface de chat) : détecter `claude` / `codex` ; si aucun, commande officielle à copier + connexion de la CLI + nouvelle détection. N'afficher que les fournisseurs disponibles.
3. Publier `v0.1.0` (ou `v0.2.0`) quand Olivier le décide.
4. Plus tard : mise à jour depuis l'application (`tauri-plugin-updater`).
