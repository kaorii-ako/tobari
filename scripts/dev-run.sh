#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
STAGING="${TOBARI_STAGING:-$REPO_ROOT/packaging/build/staging}"
BIN_DIR="${XDG_DATA_HOME:-$HOME/.local/share}/tobari/bin"

cd "$REPO_ROOT/core"
cargo build --release
mkdir -p "$STAGING" "$BIN_DIR"
cp target/release/tobari-core "$STAGING/tobari-core"

if [ -f "$STAGING/llama-server" ]; then
  cp "$STAGING/llama-server" "$BIN_DIR/llama-server"
  for lib in "$STAGING"/libggml*.so* "$STAGING"/libllama*.so* "$STAGING"/libmtmd*.so*; do
    [ -e "$lib" ] || continue
    cp -P "$lib" "$BIN_DIR/"
  done
else
  echo "warning: $STAGING/llama-server missing — run packaging/build-llama-server.sh first" >&2
  echo "warning: the panel will report llama-server as unavailable until then" >&2
fi

cd "$REPO_ROOT/extension"
if [ ! -d node_modules ]; then
  npm ci
fi
npm run build

"$REPO_ROOT/core/target/release/tobari-core" --install-manifests || {
  echo "note: manifest install skipped (no supported browser config dirs yet) — install Chrome/Chromium/Brave, then rerun this script" >&2
}
"$REPO_ROOT/core/target/release/tobari-core" --validate

echo
echo "Phase 1 dev loop ready:"
echo "  1. chrome://extensions -> Developer mode -> Load unpacked -> $REPO_ROOT/extension/dist"
echo "  2. pin the Tobari icon and open the panel"
echo "  3. first chat triggers the pinned-model download to XDG data dir"
