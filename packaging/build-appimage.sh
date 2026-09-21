#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="${TOBARI_STAGING:-$REPO_ROOT/packaging/build/staging}"
DIST="$REPO_ROOT/packaging/build/dist"
VERSION="0.1.0"
ARCH="x86_64"
APPDIR="$STAGING/Tobari.AppDir"
RUNTIME_URL="https://github.com/AppImage/type2-runtime/releases/download/continuous/runtime-x86_64"
RUNTIME_SHA256="1cc49bcf1e2ccd593c379adb17c9f85a36d619088296504de95b1d06215aebbf"

command -v appimagetool >/dev/null 2>&1 || { echo "appimagetool missing — install it inside the distrobox container (docs/PACKAGING.md)" >&2; exit 1; }
[ -x "$STAGING/llama-server" ] || { echo "staged llama-server missing — run packaging/build-llama-server.sh first" >&2; exit 1; }

if command -v cargo >/dev/null 2>&1; then
  echo "building tobari-core (release) so the AppImage never ships a stale sidecar"
  cargo build --release --manifest-path "$REPO_ROOT/core/Cargo.toml"
  install -m 755 "$REPO_ROOT/core/target/release/tobari-core" "$STAGING/tobari-core"
else
  echo "cargo missing: reusing $STAGING/tobari-core as-is (may be stale)" >&2
fi
[ -x "$STAGING/tobari-core" ] || { echo "staged tobari-core missing — run scripts/dev-run.sh first" >&2; exit 1; }
STAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"
echo "$STAMP $(sha256sum "$STAGING/tobari-core" | cut -d' ' -f1)" > "$STAGING/tobari-core.buildinfo"

rm -rf "$APPDIR"
mkdir -p "$APPDIR/usr/bin" "$APPDIR/usr/share/tobari/extension" "$APPDIR/usr/share/icons/hicolor/128x128/apps"

install -m 755 "$STAGING/tobari-core" "$APPDIR/usr/bin/tobari-core"
install -m 755 "$STAGING/llama-server" "$APPDIR/usr/bin/llama-server"
for lib in "$STAGING"/libggml*.so* "$STAGING"/libllama*.so* "$STAGING"/libmtmd*.so*; do
  [ -e "$lib" ] || continue
  cp -P "$lib" "$APPDIR/usr/bin/"
done
cat > "$APPDIR/usr/bin/tobari-launch.sh" <<'EOF'
#!/bin/sh
set -eu
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$HERE/tobari-core" "$@"
EOF
chmod 755 "$APPDIR/usr/bin/tobari-launch.sh"
install -m 644 "$REPO_ROOT/core/models.toml" "$APPDIR/usr/share/tobari/models.toml"
cp "$REPO_ROOT/extension/dist/"* "$APPDIR/usr/share/tobari/extension/"

cat > "$APPDIR/AppRun" <<'EOF'
#!/bin/sh
set -eu
HERE="$(dirname "$(readlink -f "$0")")"
export LD_LIBRARY_PATH="$HERE/usr/bin${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}"
exec "$HERE/usr/bin/tobari-core" "$@"
EOF
chmod 755 "$APPDIR/AppRun"

cat > "$APPDIR/tobari.desktop" <<'EOF'
[Desktop Entry]
Type=Application
Name=Tobari
Comment=A browser that closes over the window
Exec=tobari-core
Icon=tobari
Terminal=true
Categories=Network;
EOF

base64 -d > "$APPDIR/tobari.png" <<'EOF'
iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==
EOF
cp "$APPDIR/tobari.png" "$APPDIR/usr/share/icons/hicolor/128x128/apps/tobari.png"

RUNTIME="$STAGING/runtime-$ARCH"
if [ ! -f "$RUNTIME" ]; then
  curl -sL -o "$RUNTIME" "$RUNTIME_URL"
fi
echo "$RUNTIME_SHA256  $RUNTIME" | sha256sum -c -

mkdir -p "$DIST"
OUTPUT="$DIST/Tobari-$VERSION-linux-$ARCH.AppImage"
appimagetool -n "$APPDIR" "$OUTPUT"

tar -C "$APPDIR/usr" -czf "$DIST/tobari-$VERSION-linux-$ARCH.tar.gz" bin share

echo "built: $OUTPUT"
echo "built: $DIST/tobari-$VERSION-linux-$ARCH.tar.gz"
