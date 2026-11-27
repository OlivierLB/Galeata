[Français](../fr/README.md) · [English](README.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="galeata"></a>

# Galeata

A local IDE to develop with your agents: files, code, terminal, Git, live plan and resume sessions in the same space.

**Version 0.1.0 under development. Linux only for this first release.** The compilation, testing and Debian package are validated in the CI. Interactive testing and account connections are still required; see [verification status](validation.md).

<a id="documentation"></a>

## Documentation

- [Install Galeata](installation.md)
- [Develop and compile](development.md)
- [Editor](editor.md)
- [Git](git.md)
- [Tool Configuration AI](tool-configuration.md)
- [Tests and checks](checks.md)
- [Contract MCP](mcp.md)
- [Verification status](validation.md)
- [Mascot](mascot.md)
- [Relays of crashes](crash-relay.md)
- [Black screen and display recovery](webview-recovery.md)
- [Maintenance of dependencies](dependabot.md)
- [Contribute](contributing.md)
- [Security](security.md)
- [Translation of documentation](translation.md)

<a id="fonctions-de-cette-version"></a>

## Features in this version

- Folders, progressive tree, tabs, Monaco edition and paginated ripgrep search.
- Dedicated pages Files, Search, Git and Agents: file hosting, results bundled with overview and Git overview with comparison.
- Creating files and folders, renaming and deleting files; detection of external changes and refusal to crash silently.
- Terminal PTY with the local shell; several persistent tabs as long as the application remains open.
- Local and indexed Diff, staging, unindexed, commit, branches, worktrees, fetch, pull in fast-forward and push.
- [Simplified Git Management](git.md) since branch bottom left: branches local/distant, change, merger, resolution/cancellation of merger, stash and first push.
- Plan SQLite with transactional history, revision, steps, blockages and proposals to change perimeter.
- Launch and resumption of Codex / Claude Code ; local discovery of their sessions associated with the file.
- Choice of model by conversation AI, among the models referred by the CLI the supplier; the choice applies to the next message, after the end of the current round.
- Composer Agents: `/` Open the controls, `@` search for a project file and `$` Looking for an installed skill. References are inserted into the draft for rereading before sending. The skill is called by an explicit instruction with its path `SKILL.md`.
- Plan Mode for Claude and Codex (native mode of collaboration) Codex, applied in the next round). `Maj+Tab` Goes through modes; `Ctrl+Alt+P` alternate Plan and Auto. `/compact` or indicator « Contexte » uses the native compaction of the conversation at rest.
- In the composer: `Ctrl+Alt+F` files, `Ctrl+Alt+S` skills, `Ctrl+Alt+C` compaction and `Ctrl+Alt+/` orders. Arrows to browse suggestions, Enter to choose and Escape to close ; `Maj+Entrée` add a line.
- `Tab` place the draft in the line of conversation, Codex Like Claude. Messages start one by one after the complete end of the previous round, including in another tab; if the agent is already at rest, the first part immediately. A pending authorization or question blocks the shipment. Failure or interruption pauses the line; you can take it back or remove a message. `Entrée` keep the immediate shipment. The line remains in memory as long as the conversation is open.
- [Turtle mascot](mascot.md) animated at the bottom of the navigation bar: reflection, writing, tools, waiting and celebrations, with pause and respect for the reduction of animations.
- Button « Texte uniquement » to hide and re-display commands, tools and reasoning; the choice is stored and applications for authorisation remain accessible.
- Activity and subagents reported via MCP ; historical metadata when available; handoffs and reporting of files claimed by several agents.
- Restore open files, palette `Ctrl P`, backup `Ctrl S`, terminal panel with Ctrl and serious accent key.

An announced completion does not mean that his tests have passed. Checks reported by an agent retain provenance `agent_reported`. An agent status is a dated declaration, not a deduction from the text of the terminal.

<a id="architecture"></a>

## Architecture

```text
React / TypeScript ── commandes Tauri ──┐
                                      ├── services Rust ── fichiers / Git / SQLite / PTY
Codex / Claude ── MCP stdio ── socket ──┘
```

The office process is the source of truth. `galeata-mcp` is a transport bridge to this process; it does not create a second database and does not manage another file index. See [the contract MCP](mcp.md).

System commands receive structured arguments, without concatenation in a shell. Searches and commands have a limited duration and output size. Remote Git operations use your existing Git authentication mechanisms. Connections to API use a token separate, stored in the system keyring.

IDE data resides in the Linux application directory of Tauri, normally `$XDG_DATA_HOME/dev.olivierlb.galeata` or `~/.local/share/dev.olivierlb.galeata`. No session content is sent to a service Galeata. Launch a Supplier AI maintain the network and confidentiality rules of this provider.

<a id="limites-actuelles"></a>

## Current limits

- Initial integration with CLI Codex and Claude Code ; local session formats can evolve. The exact compatibility versions still need to be validated as native.
- Limited discovery: 5,000 session files collected, 3,000 analyzed and 100 returned sessions. The first and last windows of 64 Kio are examined; Some summaries may not be available.
- UTF-8 files up to 2 Mio. Different binary files and encodings are reported.
- No LSP complete, debugger, VS Code extensions, agent hosting or cloud synchronization in this version.
- Agents may fail to report their activity. The MCP does not guarantee exhaustive observation; terminal exits remain accessible.
- No process restoration after application shutdown. Sessions can be replicated via the tools that support them.
- Remote lists are limited to 50 PR/MR, 100 files and 100 results CI ; remote pagination and writing journals remain to be added.
- Git conflicts are dealt with in the editor or terminal; no automatic merge is triggered.
- A Secret Service safe is required for tokens dAPI. No emergency clearing.

The performance budgets of the plan are objectives, not measured results. Measures on repository 50,000 files and interactive integration tests are still to be performed.

<a id="identité"></a>

## Identity

Original logo provided by OlivierLB, preserved in `public/galeata-logo.svg`. Linux icons derive from its symbol. Palette : night blue `#19254B` and lavender `#BFA9F6`.

<a id="licence-et-contributions"></a>

## Licence and contributions

Galeata is distributed under [PolyForm Shield 1.0.0](../../LICENSE). Its source code is available; this license is not an open source license within the meaning of the OSI.

You can use Galeata, especially in your professional activity, modify it and contribute to the project. The licence prohibits the supply of a competing product under the conditions and with the exceptions of its official text, including a free competing product. It does not prohibit all forks and does not require that changes be returned.

Forks for contributions are welcome: see [CONTRIBUTING.md](contributing.md). The license shall be authentic; this summary does not change it. Dependencies and third-party resources retain their respective licences.
