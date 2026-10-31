#!/bin/sh
# appimage.sh BUILD_OUT VERSION — package a built shell (build/out) as dist/Tobari-VERSION-x86_64.AppImage.
set -eu
out=$(realpath "$1"); version=$2
here=$(dirname "$(realpath "$0")")
dist=$(realpath -m "$here/../dist")
app=$(mktemp -d)/Tobari.AppDir
mkdir -p "$app/usr/lib/tobari" "$dist"
cp -a "$out/." "$app/usr/lib/tobari/"
# libcef.so ships with debug symbols (about 1.4 GB); users don't need them.
strip --strip-unneeded "$app/usr/lib/tobari/libcef.so" "$app/usr/lib/tobari/tobari"
rm -f "$app/usr/lib/tobari/chrome-sandbox"
cp "$here/AppRun" "$here/tobari.desktop" "$here/tobari.svg" "$app/"
ln -s tobari.svg "$app/.DirIcon"
name="Tobari-$version-x86_64.AppImage"
ARCH=x86_64 VERSION=$version ${APPIMAGETOOL:-appimagetool} -n \
  -u "gh-releases-zsync|kaorii-ako|tobari|latest|Tobari-*x86_64.AppImage.zsync" \
  "$app" "$dist/$name"
rm -rf "$(dirname "$app")"
# appimagetool writes the .zsync next to the cwd's AppImage name; keep both in dist/.
[ -f "$name.zsync" ] && mv "$name.zsync" "$dist/"
ls -la "$dist"
