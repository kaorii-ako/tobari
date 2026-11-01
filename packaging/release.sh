#!/usr/bin/env bash
# release.sh VERSION NOTES.md — publish the CI-built AppImage (and Windows zip, when it built) for tag vVERSION as a GitHub release.
# Run on the maintainer's machine after the tag's build workflow passed: it downloads that build, writes SHA256SUMS,
# signs it with ~/.minisign/tobari.key (minisign asks for nothing; the key has no password) and checks the
# signature against tobari.pub before uploading. The signing key never leaves this machine.
set -euo pipefail
ver=$1; notes=$2; tag=v$ver
here=$(cd "$(dirname "$0")" && pwd)
export GH_REPO=kaorii-ako/tobari  # gh runs from a temp dir below
run=$(gh run list --workflow build --branch "$tag" --status success -L 1 --json databaseId -q '.[0].databaseId')
[ -n "$run" ] || { echo "no successful build for $tag yet"; exit 1; }
d=$(mktemp -d)
# The artifact store can be slow from here, and gh run download neither resumes nor reports progress: fetch each
# zip with curl, resuming until it's complete. fetch NAME: unzips that artifact into $d, or returns 1 if absent.
fetch() {
  local aid size
  aid=$(gh api "repos/$GH_REPO/actions/runs/$run/artifacts" -q ".artifacts[] | select(.name==\"$1\") | .id")
  [ -n "$aid" ] || return 1
  size=$(gh api "repos/$GH_REPO/actions/artifacts/$aid" -q .size_in_bytes)
  until [ "$(stat -c %s "$d/a.zip" 2>/dev/null || echo 0)" = "$size" ]; do
    url=$(curl -sS -o /dev/null -w '%{redirect_url}' -H "Authorization: Bearer $(gh auth token)" \
      "https://api.github.com/repos/$GH_REPO/actions/artifacts/$aid/zip")
    curl -sS -C - --speed-time 60 --speed-limit 1000 -o "$d/a.zip" "$url" || sleep 5
  done
  (cd "$d" && unzip -q a.zip && rm a.zip)
}
fetch tobari-appimage
# Windows is a separate job allowed to fail; release it only when it built.
fetch tobari-windows || echo "no Windows build in run $run; releasing Linux only"
cd "$d"; app=Tobari-$ver-x86_64.AppImage; win=Tobari-$ver-windows-x64.zip
[ -f "$app" ] || { echo "the build has no $app"; ls; exit 1; }
[ -f "$win" ] || win=
cp "$here/install.sh" .
sha256sum "$app" ${win:+"$win"} install.sh > SHA256SUMS
minisign -Sm SHA256SUMS -s ~/.minisign/tobari.key -t "tobari $ver"
minisign -Vm SHA256SUMS -p "$here/../tobari.pub"
gh release create "$tag" --verify-tag --title "Tobari $ver" --notes-file "$notes" \
  "$app" "$app.zsync" ${win:+"$win"} SHA256SUMS SHA256SUMS.minisig install.sh
echo "released $tag from run $run"
