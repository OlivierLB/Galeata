#!/bin/sh
# Release smoke test, run as a regular user inside a clean distribution container
# (no WebKitGTK, no FUSE): installs Galeata with install.sh from local release
# assets, checks the MCP bridge, then starts the app under a virtual display.
#
# Usage: GALEATA_DOWNLOAD_URL=file:///release sh scripts/smoke-release.sh /path/to/install.sh
# Exit codes: 0 success, 1 install/bridge/launch failure (details on stderr).
set -eu

installer="$1"
step() { printf '\n== %s\n' "$*"; }
fail() {
    printf 'ÉCHEC : %s\n' "$*" >&2
    exit 1
}

step "Installation par install.sh"
sh "$installer"
launcher="$HOME/.local/bin/galeata"
[ -x "$launcher" ] || fail "lanceur absent"
root="$HOME/.local/share/galeata/current"

step "Passerelle MCP embarquée"
bridge=$(find -L "$root" -name galeata-mcp -type f | head -n 1)
[ -n "$bridge" ] || fail "galeata-mcp introuvable dans l’AppImage extraite"
reply=$(printf '%s\n' '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-06-18","capabilities":{},"clientInfo":{"name":"smoke","version":"1"}}}' |
    timeout 5 "$bridge" --socket /tmp/absent.sock --workspace smoke)
printf '%s\n' "$reply"
case "$reply" in
*'"code":-32001'*) ;;
*) fail "la passerelle ne signale pas l’IDE fermé" ;;
esac

step "Bibliothèques résolues"
binary=$(find -L "$root" -path '*/usr/bin/galeata' -type f | head -n 1)
[ -n "$binary" ] || fail "exécutable usr/bin/galeata introuvable"
missing=$(LD_LIBRARY_PATH="$root/usr/lib:$root/usr/lib/x86_64-linux-gnu" ldd "$binary" | grep 'not found' || true)
[ -z "$missing" ] || fail "bibliothèques manquantes : $missing"

step "Démarrage sous écran virtuel (15 s)"
set +e
timeout 15 xvfb-run -a dbus-run-session -- "$launcher" >"$HOME/galeata.log" 2>&1
status=$?
set -e
tail -n 40 "$HOME/galeata.log"
# 124: still running when the timeout hit, i.e. the window started and stayed up.
[ "$status" -eq 124 ] || fail "Galeata s’est arrêtée avec le code $status"
printf '\nGaleata démarre sur une distribution vierge.\n'
