#!/bin/sh
# Builds the current working tree in Docker and installs it for the current user,
# exactly like an end user (install.sh), so every change can be tried right away.
#
# Usage: sh scripts/install-local.sh
# Rerunnable: an unchanged build keeps the same version directory.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
# Serialise shared build outputs and the per-user installation across sessions.
lock_directory="${XDG_CACHE_HOME:-$HOME/.cache}/galeata"
mkdir -p "$lock_directory"
exec 9>"$lock_directory/install-local.lock"
if ! flock -n 9; then
    printf 'Une installation Galeata est déjà en cours ; attente de sa fin.\n'
    flock 9
fi
sh "$root/scripts/build-linux-docker.sh"
GALEATA_DOWNLOAD_URL="file://$root/release-local" sh "$root/install.sh"

installed=$(readlink "${XDG_DATA_HOME:-$HOME/.local/share}/galeata/current")
printf '\nVersion installée : %s (%s)\n' "$(cat "$root/release-local/VERSION")" "$installed"
if pgrep -f "$installed/" >/dev/null 2>&1 || pgrep -x galeata >/dev/null 2>&1; then
    printf 'Galeata est ouverte : fermez-la et relancez-la pour utiliser cette version.\n'
fi
