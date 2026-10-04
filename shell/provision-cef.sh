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

# CI sets TOBARI_CEF_ALWAYS_VERIFY=1 and keeps the archive in a separate cache
# directory, so every run re-hashes what it is about to unpack. Locally the
# unpacked tree is trusted once verified (it lives in the user's own cache).
ALWAYS_VERIFY="${TOBARI_CEF_ALWAYS_VERIFY:-0}"
ARCHIVE_DIR="${TOBARI_CEF_ARCHIVE_DIR:-$CACHE}"

mkdir -p "$CACHE" "$ARCHIVE_DIR"

if [ "$ALWAYS_VERIFY" != "1" ] && [ -f "$ROOT/.verified" ]; then
  echo "$ROOT"
  exit 0
fi

# Pinned SHA-1s from Spotify's CEF build index, one per platform. Bumping CEF
# means updating CEF_VERSION and every hash together; see docs/RELEASING.md.
case "$PLATFORM" in
  linux64)    PINNED_SHA1="9794ecf85ccd4dfcca42bfaac7a7666004f051e8" ;;
  macosarm64) PINNED_SHA1="bfa2358a5fba8d0a016118941d9cda0bf2d06f20" ;;
  macosx64)   PINNED_SHA1="056aee40d5c32068686808887dd38ef1540b2aba" ;;
  *) echo "no pinned hash for platform $PLATFORM" >&2; exit 1 ;;
esac
SHA1="${CEF_SHA1:-$PINNED_SHA1}"

# sha1sum on Linux, shasum on macOS.
sha1() { if command -v sha1sum >/dev/null 2>&1; then sha1sum "$1"; else shasum -a 1 "$1"; fi | cut -d' ' -f1; }

ARCHIVE="$ARCHIVE_DIR/$NAME.tar.bz2"
ENC=$(python3 -c 'import sys, urllib.parse; print(urllib.parse.quote(sys.argv[1]))' "$NAME.tar.bz2")

for attempt in 1 2 3 4 5; do
  if [ -f "$ARCHIVE" ] && [ "$(sha1 "$ARCHIVE")" = "$SHA1" ]; then
    break
  fi
  if curl --proto =https -sS --fail -C - --max-time 3600 -o "$ARCHIVE" "https://cef-builds.spotifycdn.com/$ENC"; then
    break
  fi
  echo "download interrupted, resuming ($attempt)" >&2
  sleep 5
done

ACTUAL=$(sha1 "$ARCHIVE")
if [ "$ACTUAL" != "$SHA1" ]; then
  echo "SHA-1 mismatch for $NAME: expected $SHA1, got $ACTUAL" >&2
  rm -f "$ARCHIVE"
  exit 1
fi

rm -rf "$ROOT"
tar xjf "$ARCHIVE" -C "$CACHE"
[ "$ARCHIVE_DIR" = "$CACHE" ] && rm -f "$ARCHIVE"
echo "$SHA1" > "$ROOT/.verified"
echo "$ROOT"
