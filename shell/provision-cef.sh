#!/usr/bin/env bash
# Downloads the pinned CEF binary distribution, verifies it against the SHA-1
# published in Spotify's build index, and unpacks it into a persistent cache.
# Prints the resulting CEF_ROOT on the last line.
set -euo pipefail

CEF_VERSION="${CEF_VERSION:-154.0.33+ga03e714+chromium-154.0.8037.94}"
PLATFORM="${CEF_PLATFORM:-linux64}"
FLAVOR="minimal"
CACHE="${XDG_CACHE_HOME:-$HOME/.cache}/tobari-dev"
NAME="cef_binary_${CEF_VERSION}_${PLATFORM}_${FLAVOR}"
ROOT="$CACHE/$NAME"

mkdir -p "$CACHE"

if [ -f "$ROOT/.verified" ]; then
  echo "$ROOT"
  exit 0
fi

# Pinned SHA-1 from Spotify's CEF build index. Bumping CEF means updating both
# CEF_VERSION and this hash together; see docs/RELEASING.md.
SHA1="${CEF_SHA1:-9794ecf85ccd4dfcca42bfaac7a7666004f051e8}"

ARCHIVE="$CACHE/$NAME.tar.bz2"
ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$NAME.tar.bz2")

for attempt in 1 2 3 4 5; do
  if curl -sS --fail -C - --max-time 3600 -o "$ARCHIVE" "https://cef-builds.spotifycdn.com/$ENC"; then
    break
  fi
  echo "download interrupted, resuming ($attempt)" >&2
  sleep 5
done

ACTUAL=$(sha1sum "$ARCHIVE" | cut -d' ' -f1)
if [ "$ACTUAL" != "$SHA1" ]; then
  echo "SHA-1 mismatch for $NAME: expected $SHA1, got $ACTUAL" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

tar xjf "$ARCHIVE" -C "$CACHE"
rm -f "$ARCHIVE"
echo "$SHA1" > "$ROOT/.verified"
echo "$ROOT"
