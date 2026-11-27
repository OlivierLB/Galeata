[Français](../fr/mcp.md) · [English](mcp.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="mcp-interne"></a>

# MCP Internal

<a id="connexion"></a>

## Connection

The binary `galeata-mcp` speaks JSON-RPC MCP on stdin/stdout, with one JSON message per line. It sends calls to the Unix socket of the process Galeata. Diagnostics go on stderr.

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

The actual configuration is visible in the preferences. Agents launched since Galeata receive their argument configuration: `-c mcp_servers.galeata…` for Codex, `--mcp-config` for Claude Code. Global user configurations are not rewritten. A session launched before a restart must be restarted from the IDE to receive the new socket.

The socket is in a fashion directory `0700` and has the mode `0600`. A gateway is linked to the project identifier. She refuses calls if the active file has changed. IDE prohibits project change as long as terminals remain in progress.

<a id="contrat-initial"></a>

## Initial contract

| Tool                    | Essential arguments                                               | Result                                             |
| ------------------------ | ------------------------------------------------------------------ | ---------------------------------------------------- |
| `workspace.search_files` | `query`, `offset?`                                                 | `items`, `nextOffset`                                |
| `workspace.search_text`  | `query`, `offset?`                                                 | File, line, text and next page              |
| `workspace.get_context`  | None                                                              | Project, Git, plan, AGENTS.md / CLAUDE.md at the root |
| `git.get_status`         | None                                                              | Branch and local changes                        |
| `git.get_diff`           | `path`, `staged?`                                                  | Original/modified versions and patch                 |
| `plan.get`               | None                                                              | Objective, steps and revision                         |
| `plan.update_step`       | `revision`, `id`, `status`, `note?`                                | New plan                                         |
| `plan.set`               | `revision`, `objective`, `steps`, `document?`                      | New plan (unchanged steps keep their state)   |
| `plan.propose_change`    | `revision`, `reason`, `objective`, `steps`                         | Proposal to be considered in the activity               |
| `activity.report`        | `message`, `sessionId`, `status`, `parentId?`, `files?`, `stepId?` | Dated Event                                       |
| `verification.record`    | `message`, `command`, `exitCode`, `stepId?`, `sessionId?`          | Report declared                                      |
| `session.save_handoff`   | `message`, `sessionId`, `nextAction`, `stepId?`                    | Continued transition                                  |
| `ui.open_file`           | `path`, `line?`                                                    | Display request                                  |
| `ui.show_diff`           | `path`, `staged?`                                                  | Display request                                  |

The stage states are `pending`, `in_progress`, `blocked`, `done`. State of activity `running`, `blocked`, `done`. No tools MCP n token.

<a id="cohérence"></a>

## Coherence

Read `plan.get` before changing a step. Pass the read revision to `plan.update_step`. A deviation produces an error `REVISION_CONFLICT` ; Read and reconcile before trying again. Do not try again with a guessed revision.

Agents launched since Galeata receive instructions (`--append-system-prompt` for Claude Code, `developerInstructions` for Codex) : keep the plan up to date without being asked, with `plan.set` each new task or change of objective (and detailed markdown plan in `document`), then `plan.update_step` at the beginning and end of each stage. These tools are automatically authorised (`--allowedTools mcp__galeata` ; Codex : `mcp_servers.galeata.default_tools_approval_mode="approve"`). A plan taken from the history of a conversation `tracked: false` and `proposedAt` : his progress has not been followed, and the taken agent must indicate the actual status of the steps at his next message. The first real state change removes this marker. `plan.propose_change` remains available to submit a change for validation. Its acceptance uses its basic revision: if the plan has evolved in the meantime, an updated proposal is needed. The plan update and its historical event are written in the same transaction SQLite.

`verification.record` always produces a report `agent_reported`. It cannot certify a performance observed by Galeata. Status `done` is a statement by the author, independent of the checks.

<a id="limites-de-transport"></a>

## Transport limits

Negotiation of versions `2024-11-05`, `2025-03-26`, `2025-06-18`. Tools only: no resources, quick, HTTP streaming or subscriptions MCP in first version. Compatibility with the exact client versions remains to be tested.

Entry messages limited to 1 Mio, gateway responses to 4 Mio, events to 128 Kio, searches to 200 results per page. The server accepts up to 16 simultaneous connections. Notifications without ID are not answered. Tool execution errors use `isError: true`.

<a id="plans-par-conversation"></a>

### Plans by conversation

Agents launched in Galeata receive a bridge MCP related to their conversation (`--conversation`). Plan calls are resolved on the server side to this context, regardless of the tab displayed. The plan is retained on resumption with the vendor's session identifier. The old gateways without context keep the historical plan of the project, without copying it in the new conversations.

The checklist evolves after each message: adding new tasks without duplicates, preserving completed tasks, reopening corrections and progressing declared during work. A check box remains a declaration of achievement.

<a id="suivi-des-sous-agents"></a>

### Follow-up subagents

The statements received via a conversation gateway carry a `conversationScope` added by Galeata. `activity.list` interface side can be filtered by `conversationId` ; this identity is resolved on the server side towards the persistent context of the conversation. Former statements without context are not arbitrarily attributed to a conversation.

Standardised events `toolInput` retain the arguments of the delegations to display the original complete instructions. The foot of the message field opens a window with an active sub-agent tab, its declared tasks and reporting. Finishes remain accessible with « Inclure les terminés ». A missing data remains reported as untransmitted.

`activity.report` also accepts `name`, `initialPrompt` and `tasks` (Table of texts). The pilot retains the sub-agent's identity and indicates its `parentId` ; the list `tasks` describes his work in progress and can be emptied at the end.
