#!/usr/bin/env bash
# Builds Tobari-<version>-x86_64.AppImage from a CMake build.
#
#   packaging/appimage/build.sh <cmake-build-dir> <out-file>
#
# appimagetool is downloaded once into ~/.cache/tobari-dev/tools and checked
# against the SHA-256 pinned below; bump both together.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
BUILD="$(cd "${1:?usage: build.sh <cmake-build-dir> <out-file>}" && pwd)"
OUT="${2:?usage: build.sh <cmake-build-dir> <out-file>}"

TOOL_VERSION="1.9.1"
TOOL_SHA256="ed4ce84f0d9caff66f50bcca6ff6f35aae54ce8135408b3fa33abfc3cb384eb0"
TOOLS="${XDG_CACHE_HOME:-$HOME/.cache}/tobari-dev/tools"
TOOL="$TOOLS/appimagetool-$TOOL_VERSION-x86_64.AppImage"
mkdir -p "$TOOLS"
if [ ! -x "$TOOL" ] || [ "$(sha256sum "$TOOL" | cut -d' ' -f1)" != "$TOOL_SHA256" ]; then
  curl -sSLf --proto =https -o "$TOOL.part" \
    "https://github.com/AppImage/appimagetool/releases/download/$TOOL_VERSION/appimagetool-x86_64.AppImage"
  [ "$(sha256sum "$TOOL.part" | cut -d' ' -f1)" = "$TOOL_SHA256" ] || { echo "appimagetool hash mismatch" >&2; rm -f "$TOOL.part"; exit 1; }
  mv "$TOOL.part" "$TOOL" && chmod +x "$TOOL"
fi

APPDIR="$(mktemp -d)/Tobari.AppDir"
trap 'rm -rf "$(dirname "$APPDIR")"' EXIT
mkdir -p "$APPDIR/usr/lib/tobari" "$APPDIR/usr/share/applications" "$APPDIR/usr/share/metainfo"
cp -a "$BUILD"/. "$APPDIR/usr/lib/tobari/"
rm -rf "$APPDIR/usr/lib/tobari"/{CMakeFiles,cargo-home,libcef_dll_wrapper,CMakeCache.txt,cmake_install.cmake,.vercel} \
       "$APPDIR/usr/lib/tobari"/*.ninja "$APPDIR/usr/lib/tobari"/.ninja_*
cp "$HERE/AppRun" "$APPDIR/AppRun"

# The launcher entry inside the image runs the image itself.
sed -e 's|^Exec=tobari --new-window|Exec=AppRun --new-window|' -e 's|^Exec=tobari|Exec=AppRun|' \
    "$ROOT/packaging/dev.tobari.Browser.desktop" > "$APPDIR/dev.tobari.Browser.desktop"
cp "$APPDIR/dev.tobari.Browser.desktop" "$APPDIR/usr/share/applications/"
cp "$ROOT/packaging/dev.tobari.Browser.metainfo.xml" "$APPDIR/usr/share/metainfo/dev.tobari.Browser.appdata.xml"
mkdir -p "$APPDIR/usr/share/icons"
cp -a "$ROOT/shell/icons/hicolor" "$APPDIR/usr/share/icons/"
cp "$ROOT/shell/icons/hicolor/256x256/apps/dev.tobari.Browser.png" "$APPDIR/dev.tobari.Browser.png"
ln -s dev.tobari.Browser.png "$APPDIR/.DirIcon"

ARCH=x86_64 APPIMAGE_EXTRACT_AND_RUN=1 "$TOOL" --no-appstream "$APPDIR" "$OUT" >/dev/null
echo "$OUT"
