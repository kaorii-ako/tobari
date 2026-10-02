#!/usr/bin/env bash
# Stages a CMake build and produces a local Flatpak bundle.
#   packaging/flatpak/build.sh <cmake-build-dir> [--install]
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="${1:?usage: build.sh <cmake-build-dir> [--install]}"
STAGE="$ROOT/.flatpak-stage"
REPO="$ROOT/.flatpak-repo"

rm -rf "$STAGE"
mkdir -p "$STAGE/lib" "$STAGE/icons"
cp -a "$BUILD"/. "$STAGE/lib/"
rm -rf "$STAGE/lib/CMakeFiles" "$STAGE/lib/cargo-home" "$STAGE/lib/libcef_dll_wrapper" \
       "$STAGE/lib"/*.ninja "$STAGE/lib"/.ninja_* "$STAGE/lib/CMakeCache.txt" "$STAGE/lib/cmake_install.cmake"
cp "$HERE/tobari.sh" "$ROOT/packaging/dev.tobari.Browser.desktop" \
   "$ROOT/packaging/dev.tobari.Browser.metainfo.xml" "$STAGE/"
cp -a "$ROOT/shell/icons/hicolor/." "$STAGE/icons/"

flatpak-builder --user --force-clean --repo="$REPO" "$ROOT/.flatpak-build" "$HERE/dev.tobari.Browser.yml"
# --runtime-repo lets `flatpak install` fetch the runtime from Flathub on a
# machine that has never added it.
flatpak build-bundle --runtime-repo=https://dl.flathub.org/repo/flathub.flatpakrepo \
  "$REPO" "$ROOT/tobari.flatpak" dev.tobari.Browser
echo "bundle: $ROOT/tobari.flatpak"

if [ "${2:-}" = "--install" ]; then
  flatpak install --user -y --noninteractive --reinstall "$ROOT/tobari.flatpak"
fi
