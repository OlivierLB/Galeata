[Français](../fr/validation.md) · [English](validation.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="état-de-validation--galeata-010"></a>

# Validation status — Galeata 0.1.0

The [CI Linux of the consolidated version](https://github.com/OlivierLB/Galeata/actions/runs/45378956521) did it. The results below distinguish the automatic controls from the remaining interactive tests.

<a id="vérifications-réussies"></a>

## Successful checks

For native on Ubuntu 22.04 and interface on Ubuntu 24.04, with Node 24 and Rust stable:

- Verification TypeScript and Quick compilation with official dependencies and Monaco.
- **7 tests JavaScript** : domain, preview limits, browsing to a buffer, revision conflicts and isolation of plan changes.
- **3 course Playwright Chromium** : exploration/research, suppliers not available in overview, modification and persistence of the plan, keyboard palette and foldable panel.
- **10 Rust tests** : persistence and atomicity plan/event, revision conflict, plan validation, containment of paths and symbolic links, conflict with external modification.
- These tests also cover transport MCPthe unknown arguments, the repository Temporary Git with Unicode path and space, the staging, diffs, unindexing and deleting a folder.
- A test checks that a subprocess keeping an open output does not indefinitely block a command.
- **5 Python tests of installer** : launcher, valid menu entry, Unicode arguments and paths with spaces, reinstallation maintaining data and refusal of incorrect packages.
- Clippy, optimized Linux compilation and Debian package generation.
- Package Extraction: Executable Presence and Permissions of Galeata and its bridge MCP ; actual bridge execution and JSON-RPC response indicating the absence of IDE.

The lockfiles npm and Cargo come from this execution. The Rust code was formatted with rustfmt before testing and then re-integrated into the repository. The CI Now uses locked dependencies and controls the Rust format.

<a id="vérifications-locales-complémentaires"></a>

## Additional local audits

- Made Firefox headless to 1,500 × 950, inspected visually.
- Simplified editor explicitly displayed when Monaco is not available.
- Node tests and compilation of interface with locally available tools.
- History and local Git trees synchronized with the commits by controlling their SHAs.
- 2026-11-24: 14 Python installation tests pass. The `.deb` actual were built in Docker (Ubuntu 22.04) and verified by `check-package.mjs`, then the AppImage was installed locally with `install.sh`. `smoke-release.sh` passes on Ubuntu 22.04 and 24.04: installation without administrator rights, gateway MCP embedded, library resolution and application kept open 15 seconds under virtual screen. Containers provide the basic graphics libraries of a Linux desktop; GTK, WebKit and FUSE are not pre-installed.
- 2026-11-24: Library `galeata-agent-protocol` 31 Rust tests pass (sessions scheduled) Claude Code 2.1.331 and Codex 0.172.0 captured, transported from end to end with false CLI, process group shutdown and start failure of a turn Codex). Rustfmt, Clippy with rejected warnings and complete workspace tests go through Docker. Tests JavaScript, validated front compilation and Playwright suite, including conserving drafts between tabs and shared view; Claude resume tested with a custom configuration folder.

The local shell network did not allow Git cloning or access to the npm registry; Rust, Cargo and GTK/WebKitGTK development tools were not installed; libraries necessary for execution are present. The connector GitHub published the code and checked its compilation on Linux runners. The office application was therefore not launched interactively on this post.

<a id="essais-restant-à-effectuer"></a>

## Tests still to be carried out

- Native interactive path: folder opening, editing, terminal, backup, closing with modified buffers and tab restoration.
- Real launch and recovery of Codex and Claude Code ; plan update via connection MCP, several agents and handoffs.
- Secret Service Box and Account Connections GitHub/GitLabincluding tokens access denied and network unavailability.
- Charge on bulk repositories, memory and start/search budgets. The values of the plan remain objectives, not measures obtained.
- Interactive launch on Pop!_OS 22.04 and other Linux distributions; no macOS or Windows support announced for this version.
- First remote passage from workflow `release.yml` and publication of GitHub Release. The AppImage controls were executed locally in Docker.

<a id="reproduire-les-contrôles"></a>

## Reproducing controls

On 2026-11-25, the choice of the model was checked without inference request: Claude Code returns its catalog upon initialization and confirms `set_model` ; Codex returns its catalogue via `model/list`. The protocol tests cover confirmation or refusal side Claude, pagination side Codex, and transmission of the chosen model to `turn/start`. The Playwright courses check the specific lists of each provider and the retention of the choice by conversation.

```sh
npm ci
npm test
npm run build
npx playwright install chromium
npm run test:ui
python3 -m unittest discover -s tests -p 'test_install_*.py' -v
cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
cargo test --locked --manifest-path src-tauri/Cargo.toml --workspace
cargo clippy --locked --manifest-path src-tauri/Cargo.toml --workspace --all-targets
npm run package -- --bundles deb
node scripts/check-package.mjs
```

The Linux prerequisites are detailed in README. The package is available in workflow artifacts, without constituting a stable release publication.


<a id="composants-react"></a>

### React components

`npm run test:components` Run Vitest with jsdom and Testing Library; this suite is also included in `npm test`.
`ChoicePicker` and `ChoiceGroup` are shared among models, modes and preferences.
Isolated tests cover selection, disabled condition, closure, focus and keyboard navigation.
The Playwright tests retain the checks of connection to conversations, persistence and course.
A component test does not replace native visual validation or career paths.
