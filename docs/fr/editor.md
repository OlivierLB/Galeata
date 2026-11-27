[Français](editor.md) · [English](../en/editor.md)

# Écrire et naviguer dans le code

La section Fichiers complète Monaco avec sauvegarde automatique, navigation sémantique, refactorisations contrôlées et réglages par projet. Git, lancement, tests de projet et débogage sont indépendants de ce périmètre.

## Préserver le travail

La sauvegarde automatique est activée après une seconde sans saisie ; elle se désactive par projet. Ctrl+S enregistre immédiatement. Les écritures sont sérialisées par fichier et protégées par le stamp du disque. Une réponse ancienne ne marque jamais les frappes récentes comme enregistrées. Un échec conserve le texte et n’entraîne pas une boucle de réessais du même contenu.

Dans l’aperçu navigateur, aucun enregistrement sur disque n’est tenté : l’interface indique « Brouillon local conservé » et désactive le bouton Enregistrer.

Les brouillons sont conservés localement après 300 ms sans saisie, à la sortie de page et avant ouverture d’un autre projet. Une réouverture les récupère. Si le disque a changé, la sauvegarde automatique est suspendue : Comparer permet de relire les versions, Conserver mes changements adopte explicitement la nouvelle version du disque comme base, Recharger abandonne les changements locaux après confirmation. Les brouillons dont le fichier a disparu sont conservés pour une récupération après recréation du fichier.

Le stockage local doit être disponible : une interruption brutale peut perdre les dernières frappes avant le prochain enregistrement du brouillon. L’aperçu navigateur conserve les brouillons mais ne peut pas écrire sur le poste.

Les fichiers ouverts conservent leur modèle, leur annulation, leur sélection et leur défilement entre onglets. Les vues côte à côte partagent le modèle. L’application restaure les onglets, épinglages, deuxième vue et associations de langage ; les modèles et documents des serveurs sont libérés à la fermeture des fichiers.

## Comprendre et modifier

Ctrl+clic et F12 ouvrent une définition. En JavaScript/TypeScript, le Ctrl+clic sur le chemin d’un import ouvre le fichier à la déclaration du premier symbole importé (ou de l’import par défaut). La résolution relative charge le module à la demande et utilise le moteur TypeScript embarqué si le serveur externe est absent ; les alias locaux, extensions omises et fichiers index sont pris en compte. Les imports sans symbole ouvrent le début du fichier. Le clic droit permet son aperçu et la recherche de références. Les résultats disposent de modèles chargés à la demande pour afficher leur contenu. Alt+Gauche/Alt+Droite parcourent les positions visitées. Ctrl+Shift+O recherche les symboles du fichier et Ctrl+T ceux du projet, dans la palette temporaire existante. Ces commandes sont aussi accessibles par le clic droit et la palette Ctrl+P ; aucune barre supplémentaire n’occupe l’éditeur.

Le serveur peut fournir complétion, imports, documentation, signatures, diagnostics, implémentations et formatage. F2 et le clic droit ouvrent le renommage ; Ctrl+. affiche les corrections disponibles près du code. Alt+Shift+O ou le clic droit organise les imports. Les actions contenant des changements textuels passent par un aperçu Avant/Après avec choix des fichiers. Le disque et les buffers sont revérifiés avant application. Les versions périmées, les chevauchements et les chemins hors projet sont rejetés. Les changements sont appliqués aux buffers avec annulation puis suivent le réglage de sauvegarde automatique.

Les opérations de création, déplacement ou suppression de fichiers proposées par un serveur et les commandes arbitraires de serveur ne sont pas exécutées par les corrections. Les définitions hors du projet ne sont pas ouvertes par ce raccordement.

## Recherche et confort

La recherche existante reste accessible par Ctrl+Shift+F. Filtres et remplacement ajoute des motifs de fichiers à inclure ou exclure, séparés par des points-virgules, par exemple **/*.{ts,tsx} ; src/**. Le remplacement est littéral et sensible à la casse, comme la recherche ; il charge toutes les pages et inclut les buffers modifiés. Aucun remplacement n’est appliqué avant l’aperçu. Une opération est limitée à 100 fichiers et 8 Mio d’aperçu ; une recherche trop large demande des filtres plus précis.

Préférences → Éditeur regroupe les sections Enregistrement, Lecture et saisie, Raccourcis et Outils de langage. Le menu Fichier contient l’épinglage, la vue côte à côte, le renommage et la suppression. La barre inférieure indique l’état propre au fichier actif et propose le sélecteur de langage commun à l’application. Les champs texte sont validés à la sortie du champ ou avec Entrée ; les valeurs invalides et les échecs de stockage sont signalés. Les raccourcis utilisent Ctrl, Alt, Shift et le nom de touche (F2, F12, Space ou une lettre). Les réglages appartiennent au projet.

Le formatage à la sauvegarde est désactivé par défaut. Une fois activé, il termine avant l’écriture et abandonne un résultat devenu périmé pendant la saisie. Le formateur explicitement configuré est prioritaire, suivi du serveur, puis des outils natifs Monaco pour JavaScript/TypeScript, JSON, CSS/SCSS/Less et HTML. Les outils utilisent leur configuration de projet.

Les fichiers .editorconfig sont lus du dossier du fichier jusqu’à la racine du projet, avec héritage, root=true, unset et motifs de chemins. indent_style, indent_size et tab_width règlent le modèle ; end_of_line, trim_trailing_whitespace et insert_final_newline normalisent le texte enregistré. Le contenu reste UTF-8, conformément à l’accès fichier existant.

## Serveurs et formateurs

Le menu Configurer les serveurs et formateurs conserve une configuration JSON dans les préférences locales du projet. Aucun outil n’est installé automatiquement par l’application. Les commandes sont lancées avec des arguments structurés et un environnement hôte nettoyé des variables AppImage.

Exemple :

```json
{
  "python": {
    "command": "pyright-langserver",
    "args": ["--stdio"],
    "rootMarkers": ["pyproject.toml", "pyrightconfig.json"],
    "settings": { "python": { "analysis": { "typeCheckingMode": "basic" } } },
    "formatter": { "command": "black", "args": ["--stdin-filename", "{path}", "-"] }
  }
}
```

Chaque entrée accepte command, args, rootMarkers, settings, initializationOptions et formatter. Les formateurs reçoivent le texte sur stdin et renvoient uniquement le texte formaté sur stdout ; {path} et {relativePath} remplacent les chemins sans interprétation par un shell. Les erreurs laissent le buffer récupérable.

La racine du serveur est le dossier le plus proche contenant un marqueur, borné au projet. Les marqueurs par défaut couvrent Cargo.toml, go.mod, pyproject.toml, pyrightconfig.json, tsconfig.json, jsconfig.json et package.json selon le langage. Les sous-projets peuvent avoir leurs propres instances. JavaScript et TypeScript partagent une instance lorsque leurs configurations sont identiques.

Les préréglages détectent rust-analyzer, pyright-langserver, typescript-language-server, gopls, clangd, vscode-html-language-server, vscode-css-language-server, vscode-json-language-server, yaml-language-server, bash-language-server, vue-language-server, svelteserver, lua-language-server, zls, solargraph et intelephense. Tout langage reconnu peut utiliser un serveur explicitement configuré. La disponibilité est affichée dans Préférences → Éditeur → Outils de langage ; Relancer l’outil force sa recréation à la prochaine requête.

Le moteur TypeScript embarqué ne connaît que les modèles ouverts : ses diagnostics de syntaxe restent actifs, mais les diagnostics sémantiques sont fournis par le serveur lié au projet. Cela évite les faux « module introuvable » dus à l’absence de tsconfig, types ambiants et node_modules dans le moteur isolé. Si aucun serveur n’est disponible, les erreurs sémantiques du projet ne sont pas évaluées ; cet état est indiqué dans Préférences → Éditeur → Outils de langage. Les fonctions effectivement annoncées par le serveur déterminent les capacités actives. Huit instances maximum, 128 documents par instance, documents de 2 Mio et messages de 8 Mio. Les échanges ont un délai de huit secondes, les formateurs de quinze secondes. Les processus sont arrêtés au changement de projet ou à la fermeture de l’application. Les nouvelles routes language.* sont réservées à l’interface, hors MCP.

## Couverture et vérification

Les cinquante langages initiaux ont un exemple de détection et un test de coloration dans tests/fixtures/language-samples.json. Monaco fournit les grammaires intégrées ; les grammaires complémentaires assurent une coloration lexicale de base. Vue et Svelte reconnaissent les blocs script JavaScript/TypeScript, style CSS/SCSS/Less et les expressions de template ; JSX/TSX et HTML utilisent leurs grammaires intégrées. Cette couverture syntaxique ne promet pas les mêmes capacités sémantiques dans tous les écosystèmes.

Les tests incluent conflits, annulation des changements d’aperçu, remplacement filtré, brouillons orphelins, préférences, fichiers mixtes et virtualisation d’un fichier de cent mille lignes. Les services réels TypeScript, Python et JSON valident navigation, références, complétion, signatures, symboles, renommage, correction d’import, diagnostics et formatage. Les autres serveurs restent conditionnés à leur présence et aux capacités de leur version.

Pour rejouer les tests des serveurs réels dans un dossier ignoré du dépôt :

```sh
rtk npm install --prefix src-tauri/target/lsp-validation --no-audit --no-fund --package-lock=false typescript-language-server@4.3.3 typescript@5.9.3 vscode-langservers-extracted@4.10.0 pyright@1.1.407
rtk sh scripts/build-linux-docker.sh check-languages
```

Ces dépendances servent uniquement aux tests ; elles ne sont pas installées globalement ni embarquées dans l’application.

## Matrice des cinquante langages initiaux

La colonne serveur indique le préréglage proposé, sans garantir sa présence. « Configurable » utilise le même contrat LSP et requiert une configuration explicite adaptée au serveur choisi. Le formatage natif est disponible pour JavaScript/TypeScript ; les autres utilisent leur serveur ou le formateur configuré.

| Langage | Exemple testé | Coloration | Serveur initial |
|---|---|---|---|
| javascript | `sample.js` | Monaco | typescript-language-server |
| typescript | `sample.ts` | Monaco | typescript-language-server |
| python | `sample.py` | Monaco | pyright-langserver |
| java | `Sample.java` | Monaco | Configurable |
| c | `sample.c` | Monaco | clangd |
| cpp | `sample.cpp` | Monaco | clangd |
| csharp | `Sample.cs` | Monaco | Configurable |
| go | `sample.go` | Monaco | gopls |
| rust | `sample.rs` | Monaco | rust-analyzer |
| php | `sample.php` | Monaco | intelephense |
| ruby | `sample.rb` | Monaco | solargraph |
| swift | `sample.swift` | Monaco | Configurable |
| kotlin | `sample.kt` | Monaco | Configurable |
| dart | `sample.dart` | Monaco | Configurable |
| scala | `sample.scala` | Monaco | Configurable |
| r | `sample.r` | Monaco | Configurable |
| julia | `sample.jl` | Monaco | Configurable |
| matlab | `sample.m` | Lexicale complémentaire | Configurable |
| lua | `sample.lua` | Monaco | lua-language-server |
| perl | `sample.pl` | Monaco | Configurable |
| shell | `sample.sh` | Monaco | bash-language-server |
| powershell | `sample.ps1` | Monaco | Configurable |
| sql | `sample.sql` | Monaco | Configurable |
| objective-c | `sample.mm` | Monaco | clangd |
| groovy | `sample.groovy` | Lexicale complémentaire | Configurable |
| vb | `sample.vb` | Monaco | Configurable |
| fsharp | `sample.fs` | Monaco | Configurable |
| clojure | `sample.clj` | Monaco | Configurable |
| elixir | `sample.ex` | Monaco | Configurable |
| erlang | `sample.erl` | Lexicale complémentaire | Configurable |
| haskell | `sample.hs` | Lexicale complémentaire | Configurable |
| ocaml | `sample.ml` | Lexicale complémentaire | Configurable |
| lisp | `sample.lisp` | Lexicale complémentaire | Configurable |
| scheme | `sample.scm` | Monaco | Configurable |
| racket | `sample.rkt` | Lexicale complémentaire | Configurable |
| clojurescript | `sample.cljs` | Lexicale complémentaire | Configurable |
| coffeescript | `sample.coffee` | Monaco | Configurable |
| crystal | `sample.cr` | Lexicale complémentaire | Configurable |
| nim | `sample.nim` | Lexicale complémentaire | Configurable |
| zig | `sample.zig` | Lexicale complémentaire | zls |
| d | `sample.d` | Lexicale complémentaire | Configurable |
| fortran | `sample.f90` | Lexicale complémentaire | Configurable |
| cobol | `sample.cob` | Lexicale complémentaire | Configurable |
| ada | `sample.adb` | Lexicale complémentaire | Configurable |
| pascal | `sample.pas` | Monaco | Configurable |
| asm | `sample.asm` | Lexicale complémentaire | Configurable |
| solidity | `sample.sol` | Lexicale complémentaire | Configurable |
| vhdl | `sample.vhd` | Lexicale complémentaire | Configurable |
| verilog | `sample.v` | Monaco | Configurable |
| tcl | `sample.tcl` | Monaco | Configurable |
