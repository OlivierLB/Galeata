[Français](tool-configuration.md) · [English](../en/tool-configuration.md)

# Configuration des outils IA

La page **`Outils IA`** permet de consulter et modifier les fichiers de configuration existants de Codex et Claude Code. Elle propose un filtre par outil, type et portée, puis un éditeur de texte du fichier source. L’inventaire ne lance aucune commande et ne surveille pas les dossiers en arrière-plan.

## Sources couvertes

- Codex : `CODEX_HOME` ou `~/.codex`, et `.codex` dans le projet ; `config.toml`, `hooks.json`, instructions, skills, agents, hooks, commandes et règles.
- Claude : `CLAUDE_CONFIG_DIR` ou `~/.claude`, et `.claude` dans le projet ; `settings.json`, `settings.local.json`, instructions, skills, agents, hooks, commandes et règles ; `.mcp.json` à la racine du projet.
- Skills partagés : `.agents/skills` dans le projet et `~/.agents/skills`.
- Plugins : sources reconnues dans `plugins/cache`, présentées en consultation uniquement, de même que les skills intégrés et les liens de dossiers menant hors de leur source.

Les hooks et MCP peuvent figurer dans les réglages généraux. Le gestionnaire expose les sources présentes, sans garantir qu’une session donnée les charge. Il ne calcule pas la configuration effective après fusion, ne parcourt pas tous les fichiers d’instructions imbriqués du dépôt, ne gère pas les politiques d’entreprise et n’installe ni ne désinstalle de plugin. La création de nouveaux fichiers reste une évolution distincte.

## Enregistrement

Le chargement du contenu se fait au clic, avec une limite de 512 Kio. JSON et TOML doivent être syntaxiquement valides avant l’écriture ; la validation du sens des options reste celle de l’outil. L’édition ne reformate pas les autres sections. Une empreinte détecte les modifications externes ; l’écriture remplace atomiquement le fichier en conservant ses permissions. Les sources sont retrouvées côté natif à partir de leur identifiant, sans accepter de chemin arbitraire envoyé par l’interface.

Un brouillon reste présent pendant la navigation entre pages. Changer de source, d’outil ou actualiser demande d’abandonner explicitement un brouillon. L’enregistrement n’affecte pas automatiquement une session déjà lancée : ouvrir une nouvelle session de l’outil permet de reprendre ses configurations.

L’inventaire est borné à 600 fichiers, 4 000 dossiers visités et sept niveaux de descente. La page signale la limite atteinte. Les contenus ne sont pas envoyés dans le suivi d’activité. Les méthodes natives `tools.config.*` sont réservées à l’interface, sans nouvel outil MCP.

Le mode aperçu utilise des exemples : aucune configuration locale n’y est modifiée.

Références des formats et portées : [configuration Codex](https://developers.openai.com/codex/config-basic), [sous-agents Codex](https://developers.openai.com/codex/subagents), [réglages Claude Code](https://code.claude.com/docs/en/settings). La disponibilité d’une option dépend de la version installée.
