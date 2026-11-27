[Français](../fr/installation.md) · [English](installation.md)

> Automatically translated from French with Argos Translate. The French version is the reference; the application interface is currently in French.

<a id="installer-galeata"></a>

# Install Galeata

Only one command, without sudo or dependency to install (Linux x86_64) :

```sh
curl -fsSL https://raw.githubusercontent.com/OlivierLB/Galeata/main/install.sh | sh
```

Galeata appears in the application menu and command `galeata` is added in `~/.local/bin`. Relaunch same command sets Galeata up to date; `sh install.sh --uninstall` removes it while preserving your projects, plans and preferences.

You need **Claude Code or Codex** Only one of them is enough. Galeata detects them and guides you to the first launch if it finds none.

<details>
<summary>What the installer does</summary>

- It downloads the AppImage from the last [Release](https://github.com/OlivierLB/Galeata/releases) (all libraries are included) SHA-256 checksum.
- It extracts in `~/.local/share/galeata`, without FUSE, which also gives a faster start than a mounted AppImage. It keeps the previous version so it can go back.
- It also keeps the versions used by a window or auxiliary process still open, in order to preserve their libraries. They will be cleaned at a later installation, after closure. Relaunch Galeata to use the new version.
- It never replaces a file it did not create, and does not touch the application data (`~/.local/share/dev.olivierlb.galeata`).
- Variables: `GALEATA_VERSION=v0.2.0` to install a precise version, `GALEATA_BIN_DIR` for another command folder.

Built on Ubuntu 22.04: works on Pop!_OS 22.04 and more recent distributions. Each Release also contains a package `.deb` (`sudo apt install ./galeata-linux-amd64.deb`).
</details>

For developers, `python3 scripts/install-linux.py` install the last compilation of the CI (needs GitHub CLI connected).
