#!/usr/bin/env bash
set -euo pipefail

# Refreshes the bundled filter lists and records their hashes.
# Updates carry no identifier: plain GETs, no cookies, no query string.

DEST="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)/shell/filters"
mkdir -p "$DEST"

declare -A LISTS=(
  [easylist.txt]="https://easylist.to/easylist/easylist.txt"
  [easyprivacy.txt]="https://easylist.to/easylist/easyprivacy.txt"
  [ubo-filters.txt]="https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"
  [ubo-privacy.txt]="https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt"
)

for name in "${!LISTS[@]}"; do
  url="${LISTS[$name]}"
  tmp="$(mktemp)"
  curl -sSL --fail --max-time 120 -H 'Accept: text/plain' -o "$tmp" "$url"
  if [ ! -s "$tmp" ]; then
    echo "refusing to install empty list: $name" >&2
    rm -f "$tmp"
    exit 1
  fi
  mv "$tmp" "$DEST/$name"
  printf '%-18s %8d B  %6d rules\n' "$name" "$(stat -c%s "$DEST/$name")" \
    "$(grep -cvE '^(!|\[Adblock|$)' "$DEST/$name")"
done

( cd "$DEST" && sha256sum ./*.txt > SHA256SUMS )
echo "hashes written to $DEST/SHA256SUMS"
