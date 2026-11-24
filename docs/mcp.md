# MCP interne

## Connexion

Le binaire `galeata-mcp` parle JSON-RPC MCP sur stdin/stdout, avec un message JSON par ligne. Il transmet les appels au socket Unix du processus Galeata. Les diagnostics vont sur stderr.

```json
{
  "mcpServers": {
    "galeata": {
      "command": "/chemin/vers/galeata-mcp",
      "args": ["--socket", "/chemin/vers/mcp-PID.sock", "--workspace", "IDENTIFIANT_DU_PROJET"]
    }
  }
}
```

La configuration réelle est visible dans les préférences. Les agents lancés depuis Galeata reçoivent leur configuration en arguments : `-c mcp_servers.galeata…` pour Codex, `--mcp-config` pour Claude Code. Les configurations globales des utilisateurs ne sont pas réécrites. Une session lancée avant un redémarrage doit être relancée depuis l’IDE pour recevoir le nouveau socket.

Le socket est dans un répertoire de mode `0700` et possède le mode `0600`. Une passerelle est liée à l’identifiant du projet. Elle refuse les appels si le dossier actif a changé. L’IDE interdit le changement de projet tant que des terminaux restent en cours.

## Contrat initial

| Outil | Arguments essentiels | Résultat |
|---|---|---|
| `workspace.search_files` | `query`, `offset?` | `items`, `nextOffset` |
| `workspace.search_text` | `query`, `offset?` | Fichier, ligne, texte et prochaine page |
| `workspace.get_context` | Aucun | Projet, Git, plan, AGENTS.md / CLAUDE.md à la racine |
| `git.get_status` | Aucun | Branche et changements locaux |
| `git.get_diff` | `path`, `staged?` | Versions originale/modifiée et patch |
| `plan.get` | Aucun | Objectif, étapes et révision |
| `plan.update_step` | `revision`, `id`, `status`, `note?` | Nouveau plan |
| `plan.propose_change` | `revision`, `reason`, `objective`, `steps` | Proposition à examiner dans l’activité |
| `activity.report` | `message`, `sessionId`, `status`, `parentId?`, `files?`, `stepId?` | Événement daté |
| `verification.record` | `message`, `command`, `exitCode`, `stepId?`, `sessionId?` | Rapport déclaré |
| `session.save_handoff` | `message`, `sessionId`, `nextAction`, `stepId?` | Passation persistée |
| `ui.open_file` | `path`, `line?` | Demande d’affichage |
| `ui.show_diff` | `path`, `staged?` | Demande d’affichage |

Les états d’étape sont `pending`, `in_progress`, `blocked`, `done`. Les états d’activité sont `running`, `blocked`, `done`. Aucun outil MCP n’exécute une commande système, ne modifie un fichier, ne pousse Git ou ne lit un jeton.

## Cohérence

Lire `plan.get` avant de modifier une étape. Passer la révision lue à `plan.update_step`. Un écart produit une erreur `REVISION_CONFLICT` ; relire et réconcilier avant de retenter. Ne pas réessayer avec une révision devinée.

Les changements d’objectif et la réécriture des étapes passent par une proposition. Son acceptation utilise sa révision de base : si le plan a évolué entre-temps, une proposition actualisée est nécessaire. La mise à jour du plan et son événement d’historique sont écrits dans la même transaction SQLite.

`verification.record` produit toujours un rapport `agent_reported`. Il ne peut pas certifier une exécution observée par Galeata. Le statut `done` est une déclaration de l’auteur, indépendante des vérifications.

## Limites de transport

Négociation des versions `2024-11-05`, `2025-03-26`, `2025-06-18`. Outils uniquement : pas de ressources, prompts, streaming HTTP ou abonnements MCP en première version. La compatibilité avec les versions exactes des clients reste à tester.

Messages d’entrée limités à 1 Mio, réponses de passerelle à 4 Mio, événements à 128 Kio, recherches à 200 résultats par page. Le serveur accepte au plus 16 connexions simultanées. Les notifications sans identifiant ne reçoivent pas de réponse. Les erreurs d’exécution d’outil utilisent `isError: true`.
