#!/usr/bin/env bash
# Produces the files of one Tobari release from a CMake build:
#
#   packaging/release.sh <cmake-build-dir> [out-dir]
#
#   tobari-<v>.flatpak                  Flatpak bundle (runtime from Flathub)
#   tobari-<v>-linux-x86_64.tar.gz      per-user build + its installer
#   install.sh                          the online installer (packaging/get-tobari.sh)
#   SHA256SUMS, SHA256SUMS.minisig      signed with ~/.minisign/tobari.key if present
#
# The version comes from the newest <release> in the AppStream metainfo, so the
# metainfo, the tag and the file names cannot disagree.
set -euo pipefail
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"
BUILD="$(cd "${1:?usage: release.sh <cmake-build-dir> [out-dir]}" && pwd)"
VERSION="$(grep -oP '<release version="\K[^"]+' "$HERE/dev.tobari.Browser.metainfo.xml" | head -1)"
OUT="${2:-$ROOT/dist/release-$VERSION}"
KEY="${TOBARI_SIGNING_KEY:-$HOME/.minisign/tobari.key}"

[ -x "$BUILD/tobari" ] || { echo "no tobari binary in $BUILD" >&2; exit 1; }
grep -q "VERSION=\"\${TOBARI_VERSION:-$VERSION}\"" "$HERE/get-tobari.sh" \
  || { echo "get-tobari.sh does not pin $VERSION; update it first" >&2; exit 1; }

rm -rf "$OUT"
mkdir -p "$OUT"
STAGE="$(mktemp -d)"
trap 'rm -rf "$STAGE"' EXIT
T="$STAGE/tobari-$VERSION"
mkdir -p "$T/app" "$T/icons"
cp -a "$BUILD"/. "$T/app/"
rm -rf "$T/app/CMakeFiles" "$T/app/cargo-home" "$T/app/libcef_dll_wrapper" "$T/app"/*.ninja \
       "$T/app"/.ninja_* "$T/app/CMakeCache.txt" "$T/app/cmake_install.cmake"
cp "$HERE/install.sh" "$HERE/dev.tobari.Browser.desktop" "$HERE/dev.tobari.Browser.metainfo.xml" "$T/"
cp -a "$ROOT/shell/icons/hicolor" "$T/icons/"
cp "$ROOT/README.md" "$ROOT/SECURITY.md" "$ROOT/LICENSE" "$T/"
tar -C "$STAGE" --owner=0 --group=0 --sort=name -czf "$OUT/tobari-$VERSION-linux-x86_64.tar.gz" "tobari-$VERSION"

"$HERE/flatpak/build.sh" "$BUILD" >/dev/null
cp "$ROOT/tobari.flatpak" "$OUT/tobari-$VERSION.flatpak"
cp "$HERE/get-tobari.sh" "$OUT/install.sh"

(cd "$OUT" && sha256sum "tobari-$VERSION.flatpak" "tobari-$VERSION-linux-x86_64.tar.gz" install.sh > SHA256SUMS)
if [ -f "$KEY" ] && command -v minisign >/dev/null 2>&1; then
  minisign -Sm "$OUT/SHA256SUMS" -s "$KEY" -t "tobari $VERSION"
  minisign -Vm "$OUT/SHA256SUMS" -p "$ROOT/tobari.pub"
else
  echo "not signed: no key at $KEY or no minisign" >&2
fi
ls -la "$OUT"
