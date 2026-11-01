#!/usr/bin/env bash
# Screenshot + annotate: bench/shot_test.sh BIN. The demo hook runs the command-bar "Screenshot" action; the
# annotator tab must open on a real PNG (the canvas gets the image's size).
set -uo pipefail
bin=$(realpath "$1"); here=$(dirname "$0")
export XDG_DATA_HOME=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
python3 "$here/script_server.py" $port mcp-test >/dev/null 2>&1 & srv=$!
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -s INT 40 cage -- "$bin" --ozone-platform=wayland "--tobari-demo=demo=x&shot=1" http://127.0.0.1:$port/index.html >/dev/null 2>&1 & app=$!
for _ in $(seq 50); do "$bin" tabs >/dev/null 2>&1 && break; sleep 0.2; done
sleep 8
n=$("$bin" tabs | python3 -c 'import json,sys; print(sum(t["url"].startswith("tobari://shot/") for t in json.load(sys.stdin)))')
kill -INT $app 2>/dev/null; wait $app 2>/dev/null; kill $srv 2>/dev/null
rm -rf "$XDG_DATA_HOME"
[ "$n" = 1 ] && echo "shot: PASS 1 / 1" || { echo "shot: FAIL annotator tab not opened ($n)"; exit 1; }
