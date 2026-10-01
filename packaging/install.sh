#!/usr/bin/env bash
# Installs a Tobari build into the current user's home. Nothing is written
# outside $HOME, so this works on immutable distributions (Bazzite, Silverblue).
#
#   packaging/install.sh <build-dir> [--set-default]
#   packaging/install.sh --uninstall
set -euo pipefail

PREFIX="${XDG_DATA_HOME:-$HOME/.local/share}"
LIB="$HOME/.local/lib/tobari"
BIN="$HOME/.local/bin"
APPS="$PREFIX/applications"
ICONS="$PREFIX/icons/hicolor"
META="$PREFIX/metainfo"
HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$HERE/.." && pwd)"

uninstall() {
  rm -rf "$LIB"
  rm -f "$BIN/tobari" "$APPS/dev.tobari.Browser.desktop" "$META/dev.tobari.Browser.metainfo.xml"
  find "$ICONS" -name dev.tobari.Browser.png -delete 2>/dev/null || true
  command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" || true
  echo "Tobari removed. Your profile in ${XDG_DATA_HOME:-$HOME/.local/share}/tobari was left in place."
}

if [ "${1:-}" = "--uninstall" ]; then
  uninstall
  exit 0
fi

BUILD="${1:?usage: install.sh <build-dir> [--set-default]}"
[ -x "$BUILD/tobari" ] || { echo "no tobari binary in $BUILD" >&2; exit 1; }

# The Chromium sandbox needs unprivileged user namespaces when the SUID helper
# is unavailable, which it always is for a per-user install. Without them
# Chromium refuses to start renderers rather than running unsandboxed; say so
# up front instead of failing on first launch.
if [ "$(cat /proc/sys/kernel/unprivileged_userns_clone 2>/dev/null || echo 1)" = "0" ]; then
  echo "Unprivileged user namespaces are disabled on this system; Tobari's sandbox needs them." >&2
  echo "Refusing to install a browser that could only run without its sandbox." >&2
  exit 1
fi

rm -rf "$LIB"
mkdir -p "$LIB" "$BIN" "$APPS" "$META"
cp -a "$BUILD"/. "$LIB"/
rm -rf "$LIB/CMakeFiles" "$LIB/cargo-home" "$LIB/libcef_dll_wrapper" "$LIB"/*.ninja "$LIB"/.ninja_* \
       "$LIB/CMakeCache.txt" "$LIB/cmake_install.cmake" 2>/dev/null || true

cat > "$BIN/tobari" <<WRAP
#!/bin/sh
exec "$LIB/tobari" "\$@"
WRAP
chmod +x "$BIN/tobari"

install -m644 "$HERE/dev.tobari.Browser.desktop" "$APPS/"
sed -i "s|^Exec=tobari|Exec=$BIN/tobari|" "$APPS/dev.tobari.Browser.desktop"
install -m644 "$HERE/dev.tobari.Browser.metainfo.xml" "$META/"
for size in 16 24 32 48 64 128 256 512; do
  install -Dm644 "$ROOT/shell/icons/hicolor/${size}x${size}/apps/dev.tobari.Browser.png" \
    "$ICONS/${size}x${size}/apps/dev.tobari.Browser.png"
done
command -v update-desktop-database >/dev/null && update-desktop-database "$APPS" || true
command -v gtk-update-icon-cache >/dev/null && gtk-update-icon-cache -q "$ICONS" 2>/dev/null || true

if [ "${2:-}" = "--set-default" ]; then
  xdg-settings set default-web-browser dev.tobari.Browser.desktop
  for t in x-scheme-handler/http x-scheme-handler/https text/html; do
    xdg-mime default dev.tobari.Browser.desktop "$t"
  done
  echo "Tobari is now the default browser."
fi

echo "Installed to $LIB. Launch from your app menu or run: tobari"
case ":$PATH:" in *":$BIN:"*) ;; *) echo "Note: $BIN is not on your PATH." ;; esac
