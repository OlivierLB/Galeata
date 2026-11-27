[Français](../fr/tool-configuration.md) · [English](tool-configuration.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="configuration-des-outils-ia"></a>

# Tool Configuration AI

Page **`Outils IA`** allows to view and edit existing configuration files of Codex and Claude Code. It offers a filter by tool, type and scope, then a text editor of the source file. The inventory does not run any commands and does not monitor folders in the background.

<a id="sources-couvertes"></a>

## Sources covered

- Codex : `CODEX_HOME` or `~/.codex`, and `.codex` in the project; `config.toml`, `hooks.json`, instructions, skills, agents, hooks, commands and rules.
- Claude: `CLAUDE_CONFIG_DIR` or `~/.claude`, and `.claude` in the project; `settings.json`, `settings.local.json`, instructions, skills, agents, hooks, commands and rules; `.mcp.json` at the root of the project.
- Shared Skills: `.agents/skills` in the project and `~/.agents/skills`.
- Plugins: recognized sources in `plugins/cache`, presented in consultation only, as well as integrated skills and file links leading out of their source.

The hooks and MCP may be included in the general settings. The manager presents the sources present, without ensuring that a given session loads them. It does not calculate the actual configuration after merge, does not browse all the embedded instructions files of repository, does not manage corporate policies and does not install or uninstall plugins. Creating new files remains a distinct evolution.

<a id="enregistrement"></a>

## Saving

Content loading is done by clicking, with a limit of 512 Kio. JSON and TOML must be syntaxically valid before writing; the validation of the meaning of the options remains that of the tool. The edition does not reformat the other sections. A print detects external changes; writing replaces the file atomicly by keeping its permissions. Sources are found native side from their identifier, without accepting arbitrary path sent by the interface.

A draft remains present while browsing between pages. Changing source, tool or updating requires explicitly abandoning a draft. The recording does not automatically affect a session already started: opening a new session of the tool allows you to resume its configurations.

The inventory is limited to 600 files, 4,000 files visited and seven levels of descent. The page indicates the limit reached. Content is not sent in activity tracking. Native methods `tools.config.*` are reserved for the interface, without new tool MCP.

The preview mode uses examples: no local configuration is changed.

References to formats and ranges: [configuration Codex](https://developers.openai.com/codex/config-basic), [subagents Codex](https://developers.openai.com/codex/subagents), [settings Claude Code](https://code.claude.com/docs/en/settings). The availability of an option depends on the version installed.
