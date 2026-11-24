# État de validation — Galeata 0.1.0

La [CI Linux de la version consolidée](https://github.com/OlivierLB/Galeata/actions/runs/45374979066) a réussi. Les résultats ci-dessous distinguent les contrôles automatiques des essais interactifs restant à effectuer.

## Vérifications réussies

Sur Ubuntu 24.04, avec Node 24 et Rust stable :

- Vérification TypeScript et compilation Vite avec les dépendances officielles et Monaco.
- **7 tests JavaScript** : domaine, limites de l’aperçu, navigation vers un buffer, conflits de révision et isolation des mutations du plan.
- **3 parcours Playwright Chromium** : exploration/recherche, fournisseurs indisponibles en aperçu, modification et persistance du plan, palette clavier et panneau repliable.
- **10 tests Rust** : persistance et atomicité plan/événement, conflit de révision, validation du plan, confinement des chemins et liens symboliques, conflit avec une modification externe.
- Ces tests couvrent aussi le transport MCP, les arguments inconnus, le dépôt Git temporaire avec chemin Unicode et espace, le staging, les diffs, la désindexation et la suppression d’un dossier.
- Un test vérifie qu’un sous-processus conservant une sortie ouverte ne bloque pas indéfiniment une commande.
- Clippy, compilation Linux optimisée et génération du paquet Debian.
- Extraction du paquet : présence et permissions exécutables de Galeata et de sa passerelle MCP ; exécution réelle de la passerelle et réponse JSON-RPC indiquant l’absence de l’IDE.

Les lockfiles npm et Cargo proviennent de cette exécution. Le code Rust a été formaté avec rustfmt avant les tests, puis réintégré dans le dépôt. La CI utilise désormais les dépendances verrouillées et contrôle le format Rust.

## Vérifications locales complémentaires

- Rendu Firefox headless à 1 500 × 950, inspecté visuellement.
- Éditeur simplifié explicitement affiché lorsque Monaco n’est pas disponible.
- Tests Node et compilation de l’interface avec les outils disponibles localement.
- Historique et arbres Git locaux synchronisés avec les commits publiés, en contrôlant leurs SHA.

Le réseau du shell local ne permettait ni le clonage Git ni l’accès au registre npm ; Rust, Cargo, GTK et WebKitGTK n’y étaient pas installés. Le connecteur GitHub a permis de publier le code et de vérifier sa compilation sur les runners Linux. L’application de bureau n’a donc pas été lancée interactivement sur ce poste.

## Essais restant à effectuer

- Parcours interactif natif : ouverture d’un dossier, édition, terminal, sauvegarde, fermeture avec buffers modifiés et restauration des onglets.
- Lancement et reprise réels de Codex et Claude Code ; mise à jour du plan via leur connexion MCP, plusieurs agents et passations.
- Coffre Secret Service et connexions à des comptes GitHub/GitLab, y compris jetons expirés, accès refusés et indisponibilité réseau.
- Charge sur de gros dépôts, mémoire et budgets de démarrage/recherche. Les valeurs du plan restent des objectifs, pas des mesures obtenues.
- Installation sur d’autres distributions Linux ; aucun support macOS ou Windows annoncé pour cette version.

## Reproduire les contrôles

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:ui
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --all-targets
npm run package -- --bundles deb
node scripts/check-package.mjs
```

Les prérequis Linux sont détaillés dans le README. Le paquet est disponible dans les artefacts du workflow, sans constituer une publication de version stable.
