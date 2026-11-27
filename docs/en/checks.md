[Français](../fr/checks.md) · [English](checks.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="tests-et-contrôles"></a>

# Tests and checks

The button **`Tests et contrôles`** opens a window using the Preferences component and styling. Select one or more checks, then run the selection. Commands use files saved on disk. Closing the window does not stop them; the footer button indicates an active run.

<a id="catalogue-et-configuration"></a>

## Catalogue and configuration

The discovery is passive: it reads the project files without starting a command. It recognizes npm/pnpm/yarn/bun scripts for testing, build, lint and typing, Cargo, Go, certain Python configurations, Composer, Maven and .NET scripts. Automatic monitoring or correction scripts are excluded. The presence of the executable is checked; the project dependencies will actually be verified at launch.

The search is limited to three levels and a thousand entries, excluding dependencies and compilation folders. A control can be added or modified in the interface: program, separate arguments line by line, relative folder and maximum delay. Selections and profiles are recorded by project. A selection contains no more than 32 controls, with 64 custom commands and 20 maximum profiles.

A project may also provide `.galeata/checks.json` :

```json
{
  "custom": [{
    "id": "unit-tests",
    "name": "Tests unitaires",
    "program": "npm",
    "args": ["run", "test:unit"],
    "cwd": "",
    "timeout": 600,
    "origin": "Projet",
    "category": "test"
  }]
}
```

The paths remain confined to the project. A local change with the same identifier replaces the project definition.

<a id="exécution-et-résultats"></a>

## Implementation and results

Only one command runs between windows Galeata the same installation. The arguments are forwarded directly to the program. The default time is 600 seconds, configurable between 1 and 3,600 seconds. The cancellation ends the process group; leaving the application interrupts its checks.

The results indicate the command, folder, duration, output code and status: success, failure, blocking, cancellation, expiration or excessive output. Executable errors and some Python cases without tests are distinguished. The results are presented by order; There is not yet an explorer of each test or JUnit/JSON universal analyser.

The exits are loaded on demand, limited to the last 16 Kio. A command exceeding 8 Mio total output is stopped. Eight recent executions are kept per project. A result of a previous session or prior to a modification of the project is reported. Failures can be re-elected.

Follow-up is based on events, without periodic questioning at rest. The lock limits the number of simultaneous commands; each tool remains responsible for its own parallel processes. The browser preview mode allows you to discover the selection and profiles, but does not run any controls.

Methods `checks.*` are reserved for the native interface. The history of the old verification mechanism remains separate.
