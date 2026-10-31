#!/usr/bin/env bash
# release.sh VERSION NOTES.md — publish the CI-built AppImage for tag vVERSION as a GitHub release.
# Run on the maintainer's machine after the tag's build workflow passed: it downloads that build, writes SHA256SUMS,
# signs it with ~/.minisign/tobari.key (minisign asks for nothing; the key has no password) and checks the
# signature against tobari.pub before uploading. The signing key never leaves this machine.
set -euo pipefail
ver=$1; notes=$2; tag=v$ver
here=$(cd "$(dirname "$0")" && pwd)
export GH_REPO=kaorii-ako/tobari  # gh runs from a temp dir below
run=$(gh run list --workflow build --branch "$tag" --status success -L 1 --json databaseId -q '.[0].databaseId')
[ -n "$run" ] || { echo "no successful build for $tag yet"; exit 1; }
d=$(mktemp -d); gh run download "$run" -n tobari-appimage -D "$d"
cd "$d"; app=Tobari-$ver-x86_64.AppImage
[ -f "$app" ] || { echo "the build has no $app"; ls; exit 1; }
cp "$here/install.sh" .
sha256sum "$app" install.sh > SHA256SUMS
minisign -Sm SHA256SUMS -s ~/.minisign/tobari.key -t "tobari $ver"
minisign -Vm SHA256SUMS -p "$here/../tobari.pub"
gh release create "$tag" --verify-tag --title "Tobari $ver" --notes-file "$notes" \
  "$app" "$app.zsync" SHA256SUMS SHA256SUMS.minisig install.sh
echo "released $tag from run $run"
