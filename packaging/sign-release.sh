#!/usr/bin/env bash
# Signs a draft release built by .github/workflows/release.yml and publishes it.
# Run on the machine that holds the release key (docs: the key never goes to CI).
#   packaging/sign-release.sh 0.5.0
set -euo pipefail
VERSION="${1:?usage: packaging/sign-release.sh <version>}"
TAG="v$VERSION"
KEY="${TOBARI_KEY:-$HOME/.minisign/tobari.key}"
command -v gh >/dev/null || { echo "need the GitHub CLI (gh), logged in" >&2; exit 1; }
command -v minisign >/dev/null || { echo "need minisign" >&2; exit 1; }
[ -f "$KEY" ] || { echo "release key not found at $KEY" >&2; exit 1; }
WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
gh release download "$TAG" --repo kaorii-ako/tobari --pattern 'SHA256SUMS' --pattern 'tobari-*' --dir "$WORK"
(cd "$WORK" && sha256sum -c --ignore-missing SHA256SUMS)
minisign -Sm "$WORK/SHA256SUMS" -s "$KEY" -t "tobari $VERSION"
gh release upload "$TAG" --repo kaorii-ako/tobari --clobber "$WORK/SHA256SUMS.minisig"
gh release edit "$TAG" --repo kaorii-ako/tobari --draft=false
echo "published $TAG; the website rebuilds its download page on its own"
