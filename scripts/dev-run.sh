#!/usr/bin/env bash
set -euo pipefail
repo="$(cd "$(dirname "$0")/.." && pwd)"
profile="${XDG_CONFIG_HOME:-$HOME/.config}/tobari/browser"

cargo build --release --manifest-path "$repo/core/Cargo.toml"
if [ ! -d "$repo/extension/node_modules" ]; then npm ci --prefix "$repo/extension"; fi
npm run build --prefix "$repo/extension"

"$repo/core/target/release/tobari" install-host

chromium="$(command -v chromium-browser || command -v chromium || true)"
if [ -z "$chromium" ]; then
  echo "No Chromium in this container. Run: sudo dnf install -y chromium" >&2
  exit 1
fi
mkdir -p "$profile"
exec "$chromium" \
  --user-data-dir="$profile" \
  --load-extension="$repo/extension/dist" \
  --no-first-run --no-default-browser-check \
  --ozone-platform-hint=auto --enable-wayland-ime \
  "$@"
