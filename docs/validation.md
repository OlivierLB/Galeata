# État de validation — première implémentation

Ce document distingue les résultats obtenus des vérifications encore nécessaires. Il ne constitue pas une certification des intégrations natives.

## Exécuté dans l’environnement de développement

- Tests Node 24 : trois cas de domaine et quatre cas d’aperçu passent. Refus des capacités locales dans l’aperçu, navigation vers un buffer, conflit de révision et isolation des mutations sont couverts.
- Compilation de tous les composants avec esbuild local : réussie, en externalisant les dépendances absentes (Tauri, Monaco et xterm).
- Vérification TypeScript des sources avec les types React locaux et des déclarations temporaires pour les dépendances absentes : réussie. Elle ne remplace pas `npm run build` avec les dépendances officielles.
- Analyse syntaxique Tree-sitter des 11 fichiers Rust : aucune erreur. Elle ne remplace ni le compilateur ni Clippy.
- Rendu Firefox headless à 1 500 × 950 : inspecté visuellement. L’éditeur de secours s’affiche explicitement lorsque Monaco est absent.
- Le dépôt distant a été consulté via le connecteur GitHub. Le clonage Git et l’accès au registre npm échouent ici par résolution DNS.

## Non exécuté ici

- Installation complète npm et génération des lockfiles : registre inaccessible.
- `cargo test`, Clippy, compilation et packaging Tauri : Rust, Cargo, GTK et WebKitGTK absents.
- Parcours Playwright : le démarrage du serveur HTTP local est interdit dans cet environnement. Le rendu headless depuis un fichier a pu être contrôlé séparément.
- Connexion réelle aux CLI via PTY, reprise, coffre système, serveur MCP et services GitHub/GitLab depuis le binaire.
- Tests de charge et budgets de démarrage, mémoire et recherche.

## Tests fournis pour la machine équipée / CI

- Rust : persistance et atomicité plan/événement, conflit de révision, validation du plan, chemins absolus/parents/liens symboliques, conflit avec une modification externe.
- Rust : notifications MCP, erreurs d’outils, arguments inconnus, liste des capacités.
- Rust : dépôt Git temporaire, chemin Unicode avec espace, staging, commit, diff indexé/non indexé, désindexation, suppression d’un dossier et refus de chemin externe.
- Playwright : navigation/recherche, fournisseurs indisponibles en aperçu, modification et persistance du plan, palette clavier et panneau repliable.
- GitHub Actions : tests et build frontend, Playwright Chromium, tests Rust, Clippy et compilation Linux.

## Avant une première distribution

1. Installer les prérequis et exécuter `npm install`, puis committer les lockfiles obtenus après vérification.
2. Exécuter les tests et compiler le binaire natif ; résoudre les éventuelles incompatibilités avec les versions résolues des dépendances.
3. Ouvrir un projet jetable, tester les conflits de fichiers, fermer avec des buffers modifiés et restaurer les onglets.
4. Lancer puis reprendre Codex et Claude Code ; vérifier `initialize`, `tools/list`, une recherche, une mise à jour concurrente et une proposition via MCP.
5. Connecter des dépôts de test GitHub et GitLab avec jetons limités ; tester les réponses 401/403, le réseau indisponible, les diffs et la CI.
6. Mesurer les budgets du plan sur une machine et un dépôt de référence documentés avant de les annoncer comme atteints.
