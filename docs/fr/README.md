[Français](README.md) · [English](../en/README.md)

# Galeata

Un IDE local pour développer avec vos agents : fichiers, code, terminal, Git, plan vivant et reprise de sessions dans le même espace.

**Version 0.1.0 en développement. Linux uniquement pour cette première version.** La compilation, les tests et le paquet Debian sont validés dans la CI. Les essais interactifs et les connexions aux comptes restent à effectuer ; voir [l’état des vérifications](validation.md).

## Documentation

- [Installer Galeata](installation.md)
- [Développer et compiler](development.md)
- [Éditeur](editor.md)
- [Git](git.md)
- [Configuration des outils IA](tool-configuration.md)
- [Tests et contrôles](checks.md)
- [Contrat MCP](mcp.md)
- [État des vérifications](validation.md)
- [Mascotte](mascot.md)
- [Relais de plantages](crash-relay.md)
- [Écran noir et récupération de l’affichage](webview-recovery.md)
- [Maintenance des dépendances](dependabot.md)
- [Contribuer](contributing.md)
- [Sécurité](security.md)
- [Traduction de la documentation](translation.md)

## Fonctions de cette version

- Dossiers, arborescence progressive, onglets, édition Monaco et recherche ripgrep paginée.
- Pages dédiées Fichiers, Recherche, Git et Agents : accueil des fichiers, résultats groupés avec aperçu et vue d’ensemble Git avec comparateur.
- Création de fichiers et dossiers, renommage et suppression de fichiers ; détection des modifications externes et refus d’écrasement silencieux.
- Terminal PTY avec le shell local ; plusieurs onglets persistants tant que l’application reste ouverte.
- Diff local et indexé, staging, désindexation, commit, branches, worktrees, fetch, pull en avance rapide et push.
- [Gestion Git simplifiée](git.md) depuis la branche en bas à gauche : branches locales/distantes, changement, fusion, résolution/annulation de fusion, stash et premier push.
- Plan SQLite avec historique transactionnel, révision, étapes, blocages et propositions de changement de périmètre.
- Lancement et reprise de Codex / Claude Code ; découverte locale de leurs sessions associées au dossier.
- Choix du modèle par conversation IA, parmi les modèles renvoyés par la CLI du fournisseur ; le choix s’applique au prochain message, après la fin du tour en cours.
- Composeur Agents : `/` ouvre les commandes, `@` cherche un fichier du projet et `$` cherche un skill installé. Les références sont insérées dans le brouillon pour relecture avant envoi. Le skill est appelé par une instruction explicite avec son chemin `SKILL.md`.
- Mode Plan pour Claude et Codex (mode de collaboration natif Codex, appliqué au prochain tour). `Maj+Tab` parcourt les modes ; `Ctrl+Alt+P` alterne Plan et Auto. `/compact` ou l’indicateur « Contexte » utilise la compaction native de la conversation au repos.
- Dans le composeur : `Ctrl+Alt+F` fichiers, `Ctrl+Alt+S` skills, `Ctrl+Alt+C` compaction et `Ctrl+Alt+/` commandes. Flèches pour parcourir les suggestions, Entrée pour choisir et Échap pour fermer ; `Maj+Entrée` ajoute une ligne.
- `Tab` place le brouillon dans la file de la conversation, pour Codex comme pour Claude. Les messages partent un par un après la fin complète du tour précédent, y compris dans un autre onglet ; si l’agent est déjà au repos, le premier part immédiatement. Une autorisation ou une question en attente bloque l’envoi. Un échec ou une interruption met la file en pause ; vous pouvez la reprendre ou retirer un message. `Entrée` conserve l’envoi immédiat. La file reste en mémoire tant que la conversation est ouverte.
- [Mascotte tortue](mascot.md) animée en bas de la barre de navigation : réflexion, écriture, outils, attente et célébrations, avec pause et respect de la réduction des animations.
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

Le processus de bureau est la source de vérité. `galeata-mcp` est une passerelle de transport vers ce processus ; il ne crée pas de seconde base de données et ne gère pas un autre index de fichiers. Voir [le contrat MCP](mcp.md).

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

Galeata est distribué sous [PolyForm Shield 1.0.0](../../LICENSE). Son code source est disponible ; cette licence n’est pas une licence open source au sens de l’OSI.

Vous pouvez utiliser Galeata, notamment dans votre activité professionnelle, le modifier et contribuer au projet. La licence interdit de fournir un produit concurrent dans les conditions et avec les exceptions de son texte officiel, y compris un produit concurrent gratuit. Elle n’interdit pas tous les forks et n’impose pas de reverser les modifications.

Les forks destinés aux contributions sont les bienvenus : voir [CONTRIBUTING.md](contributing.md). Le texte de la licence fait foi ; ce résumé ne le modifie pas. Les dépendances et ressources tierces conservent leurs licences respectives.
