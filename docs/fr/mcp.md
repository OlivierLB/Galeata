[Français](mcp.md) · [English](../en/mcp.md)

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

| Outil                    | Arguments essentiels                                               | Résultat                                             |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `workspace.search_files` | `query`, `offset?`                                                 | `items`, `nextOffset`                                |
| `workspace.search_text`  | `query`, `offset?`                                                 | Fichier, ligne, texte et prochaine page              |
| `workspace.get_context`  | Aucun                                                              | Projet, Git, plan, AGENTS.md / CLAUDE.md à la racine |
| `git.get_status`         | Aucun                                                              | Branche et changements locaux                        |
| `git.get_diff`           | `path`, `staged?`                                                  | Versions originale/modifiée et patch                 |
| `plan.get`               | Aucun                                                              | Objectif, étapes et révision                         |
| `plan.update_step`       | `revision`, `id`, `status`, `note?`                                | Nouveau plan                                         |
| `plan.set`               | `revision`, `objective`, `steps`, `document?`                      | Nouveau plan (étapes inchangées gardent leur état)   |
| `plan.propose_change`    | `revision`, `reason`, `objective`, `steps`                         | Proposition à examiner dans l’activité               |
| `activity.report`        | `message`, `sessionId`, `status`, `parentId?`, `files?`, `stepId?` | Événement daté                                       |
| `verification.record`    | `message`, `command`, `exitCode`, `stepId?`, `sessionId?`          | Rapport déclaré                                      |
| `session.save_handoff`   | `message`, `sessionId`, `nextAction`, `stepId?`                    | Passation persistée                                  |
| `ui.open_file`           | `path`, `line?`                                                    | Demande d’affichage                                  |
| `ui.show_diff`           | `path`, `staged?`                                                  | Demande d’affichage                                  |

Les états d’étape sont `pending`, `in_progress`, `blocked`, `done`. Les états d’activité sont `running`, `blocked`, `done`. Aucun outil MCP n’exécute une commande système, ne modifie un fichier, ne pousse Git ou ne lit un jeton.

## Cohérence

Lire `plan.get` avant de modifier une étape. Passer la révision lue à `plan.update_step`. Un écart produit une erreur `REVISION_CONFLICT` ; relire et réconcilier avant de retenter. Ne pas réessayer avec une révision devinée.

Les agents lancés depuis Galeata reçoivent une consigne (`--append-system-prompt` pour Claude Code, `developerInstructions` pour Codex) : tenir le plan à jour sans qu’on le leur demande, avec `plan.set` à chaque nouvelle tâche ou changement d’objectif (et le plan détaillé en markdown dans `document`), puis `plan.update_step` au début et à la fin de chaque étape. Ces outils sont autorisés d’office (`--allowedTools mcp__galeata` ; Codex : `mcp_servers.galeata.default_tools_approval_mode="approve"`). Un plan repris de l’historique d’une conversation porte `tracked: false` et `proposedAt` : son avancement n’a pas été suivi, et l’agent repris doit indiquer l’état réel des étapes à son prochain message. Le premier changement d’état réel retire ce marqueur. `plan.propose_change` reste disponible pour soumettre un changement à validation. Son acceptation utilise sa révision de base : si le plan a évolué entre-temps, une proposition actualisée est nécessaire. La mise à jour du plan et son événement d’historique sont écrits dans la même transaction SQLite.

`verification.record` produit toujours un rapport `agent_reported`. Il ne peut pas certifier une exécution observée par Galeata. Le statut `done` est une déclaration de l’auteur, indépendante des vérifications.

## Limites de transport

Négociation des versions `2024-11-05`, `2025-03-26`, `2025-06-18`. Outils uniquement : pas de ressources, prompts, streaming HTTP ou abonnements MCP en première version. La compatibilité avec les versions exactes des clients reste à tester.

Messages d’entrée limités à 1 Mio, réponses de passerelle à 4 Mio, événements à 128 Kio, recherches à 200 résultats par page. Le serveur accepte au plus 16 connexions simultanées. Les notifications sans identifiant ne reçoivent pas de réponse. Les erreurs d’exécution d’outil utilisent `isError: true`.

### Plans par conversation

Les agents lancés dans Galeata reçoivent une passerelle MCP liée à leur conversation (`--conversation`). Les appels de plan sont résolus côté serveur vers ce contexte, indépendamment de l’onglet affiché. Le plan est conservé à la reprise grâce à l’identifiant de session du fournisseur. Les anciennes passerelles sans contexte gardent le plan historique du projet, sans le recopier dans les nouvelles conversations.

La checklist évolue après chaque message : ajout des nouvelles tâches sans doublons, conservation des tâches terminées, réouverture des corrections et avancement déclaré pendant le travail. Une case cochée reste une déclaration de réalisation.

### Suivi des sous-agents

Les déclarations reçues via une passerelle liée à une conversation portent un `conversationScope` ajouté par Galeata. `activity.list` côté interface peut être filtré par `conversationId` ; cette identité est résolue côté serveur vers le contexte persistant de la conversation. Les anciennes déclarations sans contexte ne sont pas attribuées arbitrairement à une conversation.

Les événements normalisés `toolInput` conservent les arguments des délégations pour afficher la consigne initiale complète. Le pied du champ de message ouvre une fenêtre avec un onglet par sous-agent actif, ses tâches déclarées et ses comptes rendus. Les terminés restent accessibles avec « Inclure les terminés ». Une donnée absente reste signalée comme non transmise.

`activity.report` accepte aussi `name`, `initialPrompt` et `tasks` (tableau de textes). Le pilote conserve l’identité du sous-agent et indique son `parentId` ; la liste `tasks` décrit son travail en cours et peut être vidée à la fin.
