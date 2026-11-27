[Français](../fr/editor.md) · [English](editor.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="écrire-et-naviguer-dans-le-code"></a>

# Write and navigate in code

The Monaco complete files section with automatic backup, semantic navigation, controlled refactoring and project settings. Git, launch, project testing and debugging are independent of this perimeter.

<a id="préserver-le-travail"></a>

## Preserving work

Automatic backup is enabled after a second without input; it deactivates by project. Ctrl+S records immediately. The scripts are serialized by file and protected by the disk stamp. An old answer never marks recent strikes as recorded. A failure retains the text and does not result in a loop of retesting of the same content.

In the browser preview, no recording on disk is attempted: the interface indicates « Brouillon local conservé » and disable the Save button.

Drafts are kept locally after 300 ms without entering, at page release and before opening another project. A reopening gets them back. If the disk has changed, the auto backup is suspended: Compare allows to reread the versions, Keep my changes explicitly adopts the new version of the disk as a base, Reload abandons local changes after confirmation. Drafts whose file has disappeared are retained for recovery after re-creation.

Local storage must be available: a sudden interruption can lose the last hits before the next recording of the draft. The browser preview keeps drafts but cannot write to the post.

Open files keep their template, cancellation, selection and scrolling between tabs. The side by side views share the model. The application restores tabs, pins, second view and language associations; server templates and documents are released when files are closed.

<a id="comprendre-et-modifier"></a>

## Understand and modify

Ctrl+click and F12 open a definition. In JavaScript/TypeScript, the Ctrl+click on the path of an import opens the file to the declaration of the first imported symbol (or default import). Relative resolution loads the module on demand and uses the engine TypeScript embedded if the external server is missing; local aliases, omitted extensions and index files are taken into account. Imports without symbol open the beginning of the file. The right click allows its preview and reference search. The results have templates loaded on demand to display their content. Alt+Left/Alt+Right travel through the positions visited. Ctrl+Shift+O searches for the symbols of the file and Ctrl+T for the project in the existing temporary palette. These commands are also accessible with the right click and the Ctrl+P palette; There is no additional bar in the editor.

The server can provide completion, import, documentation, signatures, diagnostics, implementations and formatting. F2 and right click open the rename; Ctrl+. displays the corrections available near the code. Alt+Shift+O or right click organizes imports. Actions containing text changes go through a Before/After preview with file selection. The disc and buffers are rechecked before application. Outdated versions, overlaps and off-project paths are rejected. The changes are applied to buffers with cancellation and then follow the automatic backup setting.

The creation, displacement or deletion of files proposed by a server and arbitrary server commands are not executed by the corrections. Definitions outside the project are not opened by this connection.

<a id="recherche-et-confort"></a>

## Research and comfort

Existing research remains accessible by Ctrl+Shift+F. Filters and replacement add file patterns to include or exclude, separated by semicolon, for example **/*.{ts,tsx} ; src/**. The replacement is literal and case-sensitive, like research; it loads all pages and includes modified buffers. No replacement is applied before preview. One operation is limited to 100 files and 8 Mio preview; too wide a search requires more precise filters.

Preferences → Editor brings together the sections Recording, Reading and Entering, Shortcuts and Language Tools. The File menu contains pinning, side-by-side view, renaming and deletion. The bottom bar indicates the status of the active file and offers the language selector common to the application. Text fields are validated at the exit of the field or with Enter; invalid values and storage failures are reported. Shortcuts use Ctrl, Alt, Shift and keyname (F2, F12, Space or letter). The settings belong to the project.

Backup formatting is disabled by default. Once activated, it ends before writing and abandons a result that has expired during the entry. The explicitly configured trainer is a priority, followed by the server, then native Monaco tools for JavaScript/TypeScript, JSON, CSS/SCSS/Less and HTML. The tools use their project configuration.

The .editorconfig files are read from the file folder to the project root, with legacy, root=true, unset and path patterns. indent_style, indent_Size and tab_width adjust the model; end_of the_line, trim_trailing_whitspace and insert_Final_newline normalize the saved text. Content remains UTF-8, according to existing file access.

<a id="serveurs-et-formateurs"></a>

## Servers and trainers

The Configure Servers and Trainers menu maintains a JSON configuration in the project's local preferences. No tools are installed automatically by the application. Commands are run with structured arguments and a host environment cleaned of AppImage variables.

Example:

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

Each entry accepts command, args, rootMarkers, settings, initializationOptions and formatter. The trainers receive the text on stdin and return only the text formatted on stdout; {path} and {relativePath} replace uninterpreted paths with shell. Errors leave the buffer recoverable.

The root of the server is the nearest folder containing a marker, limited to the project. The default markers cover Cargo.toml, go.mod, pyproject.toml, pyrightconfig.json, tsconfig.json, jsconfig.json and package.json according to the language. Sub-projects may have their own forums. JavaScript and TypeScript share an instance when their configurations are identical.

Presets detect rust-analyzer, pyright-langserver, typescript-language-server, gopls, clangd, vscode-html-language-server, vscode-css-language-server, vscode-json-language-server, yaml-language-server, bash-language-server, view-language-server, svelteserver, lua-language-server, zls, solargraph and intelephense. Any recognized language can use an explicitly configured server. Availability is displayed in Preferences → Publisher → Language Tools ; Relaunching the tool forces its re-creation to the next request.

The engine TypeScript It only knows open models: its syntax diagnostics remain active, but semantic diagnoses are provided by the server linked to the project. This avoids fakes « module introuvable » due to the absence of tsconfig, ambient and node types_modules in the insulated engine. If no server is available, project semantic errors are not evaluated; This status is indicated in Preferences → Editor → Language Tools. The functions actually announced by the server determine the active capabilities. Up to eight instances, 128 documents per proceeding, 2 Mio documents and 8 Mio messages. The exchanges have a delay of eight seconds, the trainers fifteen seconds. Processes are stopped when the project is changed or the application is closed. New language roads.* are reserved for the interface, outside MCP.

<a id="couverture-et-vérification"></a>

## Coverage and verification

The initial fifty languages have an example of detection and a coloring test in tests/fixtures/language-samples.json. Monaco provides integrated grammar; complementary grammars ensure a basic lexical coloration. View and Svelte recognize script blocks JavaScript/TypeScript, CSS/SCSS/Less style and template expressions; JSX/TSX and HTML use their built-in grammar. This syntactic coverage does not promise the same semantic capabilities in all ecosystems.

The tests include conflicts, cancellation of preview changes, filtered replacement, orphan drafts, preferences, mixed files and virtualization of a hundred thousand line file. Real services TypeScript, Python and JSON confirm navigation, references, completion, signatures, symbols, rename, import correction, diagnostics and formatting. Other servers remain conditioned by their presence and version capabilities.

To replay real server tests in an ignored folder repository :

```sh
rtk npm install --prefix src-tauri/target/lsp-validation --no-audit --no-fund --package-lock=false typescript-language-server@4.3.3 typescript@5.9.3 vscode-langservers-extracted@4.10.0 pyright@1.1.407
rtk sh scripts/build-linux-docker.sh check-languages
```

These dependencies are only used for testing; they are not installed globally or embedded in the application.

<a id="matrice-des-cinquante-langages-initiaux"></a>

## Matrix of the original fifty languages

The server column indicates the proposed preset, without guaranteeing its presence. « Configurable » uses the same contract LSP and requires an explicit configuration adapted to the selected server. Native formatting is available for JavaScript/TypeScript ; others use their server or the configured trainer.

| Language | Example tested | Colouring | Initial server |
|---|---|---|---|
| javascript | `sample.js` | Monaco | typescript-language-server |
| typescript | `sample.ts` | Monaco | typescript-language-server |
| python | `sample.py` | Monaco | pyright-langserver |
| java | `Sample.java` | Monaco | Configurable |
| c | `sample.c` | Monaco | clangd |
| cpp | `sample.cpp` | Monaco | clangd |
| csharp | `Sample.cs` | Monaco | Configurable |
| Go | `sample.go` | Monaco | gopls |
| rough | `sample.rs` | Monaco | rough-analyzer |
| php | `sample.php` | Monaco | intelephense |
| ruby | `sample.rb` | Monaco | solargraph |
| swift | `sample.swift` | Monaco | Configurable |
| kotlin | `sample.kt` | Monaco | Configurable |
| dart | `sample.dart` | Monaco | Configurable |
| scala | `sample.scala` | Monaco | Configurable |
| r | `sample.r` | Monaco | Configurable |
| julia | `sample.jl` | Monaco | Configurable |
| matlab | `sample.m` | Supplementary lexical | Configurable |
| lua | `sample.lua` | Monaco | lua-language-server |
| perl | `sample.pl` | Monaco | Configurable |
| shell | `sample.sh` | Monaco | bash-language-server |
| powershell | `sample.ps1` | Monaco | Configurable |
| sql | `sample.sql` | Monaco | Configurable |
| objective-c | `sample.mm` | Monaco | clangd |
| groovy | `sample.groovy` | Supplementary lexical | Configurable |
| vb | `sample.vb` | Monaco | Configurable |
| fsharp | `sample.fs` | Monaco | Configurable |
| clojur | `sample.clj` | Monaco | Configurable |
| elixir | `sample.ex` | Monaco | Configurable |
| erlang | `sample.erl` | Supplementary lexical | Configurable |
| Haskell | `sample.hs` | Supplementary lexical | Configurable |
| ocaml | `sample.ml` | Supplementary lexical | Configurable |
| lisp | `sample.lisp` | Supplementary lexical | Configurable |
| scheme | `sample.scm` | Monaco | Configurable |
| racket | `sample.rkt` | Supplementary lexical | Configurable |
| clojurescript | `sample.cljs` | Supplementary lexical | Configurable |
| coffeescript | `sample.coffee` | Monaco | Configurable |
| crystal | `sample.cr` | Supplementary lexical | Configurable |
| nim | `sample.nim` | Supplementary lexical | Configurable |
| zig | `sample.zig` | Supplementary lexical | zls |
| d | `sample.d` | Supplementary lexical | Configurable |
| Fortran | `sample.f90` | Supplementary lexical | Configurable |
| Cobol | `sample.cob` | Supplementary lexical | Configurable |
| ada | `sample.adb` | Supplementary lexical | Configurable |
| Paschal | `sample.pas` | Monaco | Configurable |
| Asm | `sample.asm` | Supplementary lexical | Configurable |
| solidity | `sample.sol` | Supplementary lexical | Configurable |
| vhdl | `sample.vhd` | Supplementary lexical | Configurable |
| verilog | `sample.v` | Monaco | Configurable |
| tcl | `sample.tcl` | Monaco | Configurable |
