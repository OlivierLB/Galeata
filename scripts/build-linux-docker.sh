#!/bin/sh
# Builds Galeata's Linux release assets inside Docker (Ubuntu 22.04), without
# installing any build dependency on the host, then lays them out exactly like a
# GitHub Release in ./release-local:
#   galeata-linux-x86_64.AppImage, galeata-linux-amd64.deb, SHA256SUMS, VERSION
#
# Usage:   sh scripts/build-linux-docker.sh          build release assets
#          sh scripts/build-linux-docker.sh check    rustfmt, clippy and tests of the
#                                                    whole Rust workspace (no packaging)
# Install: GALEATA_DOWNLOAD_URL="file://$PWD/release-local" sh install.sh
#
# Rerunnable: the image is cached by Docker; cargo and npm caches persist in
# ~/.cache/galeata-docker; build outputs go to the usual gitignored folders.
set -eu

root=$(cd "$(dirname "$0")/.." && pwd)
image="galeata-build:ubuntu22.04"
cache="${XDG_CACHE_HOME:-$HOME/.cache}/galeata-docker"
out="$root/release-local"

step() { printf '\n== %s\n' "$*"; }

command -v docker >/dev/null 2>&1 || {
    echo "Docker est nécessaire pour ce script." >&2
    exit 1
}

step "Image de compilation ($image)"
docker build -q -t "$image" -f "$root/scripts/docker/Dockerfile.build" "$root/scripts/docker"

mkdir -p "$cache/cargo" "$cache/home"
in_container() {
    docker run --rm \
        --user "$(id -u):$(id -g)" \
        -e HOME=/cache/home \
        -e CARGO_HOME=/cache/cargo \
        -e APPIMAGE_EXTRACT_AND_RUN=1 \
        -e CI=true \
        -v "$cache:/cache" \
        -v "$root:/src" \
        -w /src \
        "$image" \
        sh -c "set -e; $1"
}

if [ "${1:-}" = "check" ]; then
    step "Vérification Rust du workspace (fmt, clippy, tests)"
    # The desktop crate embeds ../dist: build the UI first if it is missing.
    in_container '[ -d dist ] || { npm ci --no-audit --no-fund && npm run build; }
        cargo fmt --manifest-path src-tauri/Cargo.toml --all -- --check
        cargo clippy --locked --manifest-path src-tauri/Cargo.toml --workspace --all-targets -- -D warnings
        cargo test --locked --manifest-path src-tauri/Cargo.toml --workspace'
    step "Vérification réussie"
    exit 0
fi

step "Compilation (AppImage + .deb) — plusieurs minutes la première fois"
in_container 'npm ci --no-audit --no-fund
    npm run package -- --bundles appimage,deb
    node scripts/check-package.mjs'

step "Assemblage de $out"
rm -rf "$out"
mkdir -p "$out"
cp "$root"/src-tauri/target/release/bundle/appimage/*.AppImage "$out/galeata-linux-x86_64.AppImage"
cp "$root"/src-tauri/target/release/bundle/deb/*.deb "$out/galeata-linux-amd64.deb"
version=$(node -p 'require(process.argv[1]).version' "$root/package.json")
commit=$(git -C "$root" rev-parse --short HEAD)
dirty=$(git -C "$root" status --porcelain | head -n 1)
printf 'v%s-local.%s%s' "$version" "$commit" "${dirty:+-modifie}" >"$out/VERSION"
(cd "$out" && sha256sum galeata-linux-x86_64.AppImage galeata-linux-amd64.deb >SHA256SUMS)
ls -l "$out"
printf '\nInstaller : GALEATA_DOWNLOAD_URL="file://%s" sh %s/install.sh\n' "$out" "$root"
