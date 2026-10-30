#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/../.." && pwd)"
out="${1:-$repo/dist}"
appdir="$(mktemp -d)/Tobari.AppDir"
mkdir -p "$appdir/usr/bin" "$out"

cargo build --release --manifest-path "$repo/core/Cargo.toml"
npm ci --prefix "$repo/extension"
npm run build --prefix "$repo/extension" -- --minify
cmake -S "$repo/shell" -B "$repo/shell/build" -G Ninja -DCMAKE_BUILD_TYPE=Release
cmake --build "$repo/shell/build"

shell_out="$repo/shell/build/Release"
[ -d "$shell_out" ] || shell_out="$repo/shell/build"
cp -a "$shell_out/." "$appdir/usr/bin/"
install -m755 "$repo/core/target/release/tobari" "$appdir/usr/bin/tobari"
install -m755 "$repo/packaging/tobari-launch" "$appdir/usr/bin/tobari-launch"
if [ -n "${LLAMA_SERVER:-}" ]; then
  install -m755 "$LLAMA_SERVER" "$appdir/usr/bin/llama-server"
fi
install -m644 "$repo/packaging/dev.tobari.Tobari.desktop" "$appdir/dev.tobari.Tobari.desktop"
install -m644 "$repo/extension/static/icons/tobari-256.png" "$appdir/dev.tobari.Tobari.png"
install -Dm644 "$repo/packaging/dev.tobari.Tobari.metainfo.xml" "$appdir/usr/share/metainfo/dev.tobari.Tobari.appdata.xml"
cat > "$appdir/AppRun" <<'RUN'
#!/bin/sh
exec "$APPDIR/usr/bin/tobari-launch" "$@"
RUN
chmod +x "$appdir/AppRun"

tool="${APPIMAGETOOL:-appimagetool}"
UPDATE="gh-releases-zsync|kaorii-ako|tobari|latest|Tobari-*x86_64.AppImage.zsync"
ARCH=x86_64 "$tool" -u "$UPDATE" "$appdir" "$out/Tobari-0.5.0-x86_64.AppImage"
echo "built $out/Tobari-0.5.0-x86_64.AppImage"
