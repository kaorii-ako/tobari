#!/usr/bin/env bash
# Renders gallery.html into docs/producthunt/out/gallery-N.png (1270x760) with headless Chrome (flatpak).
set -e
cd "$(dirname "$0")"
mkdir -p out
python3 -m http.server 38190 --bind 127.0.0.1 >/dev/null 2>&1 & srv=$!
trap 'kill $srv' EXIT
sleep 1
for n in 1 2 3 4 5 6; do
  flatpak run --filesystem="$PWD/out" com.google.Chrome --headless=new --disable-gpu --hide-scrollbars \
    --window-size=1270,760 --virtual-time-budget=3000 --screenshot="$PWD/out/gallery-$n.png" \
    "http://127.0.0.1:38190/gallery.html#$n" 2>/dev/null
done
ls out
