#!/usr/bin/env bash
# Does an unpacked MV3 extension's content script run? bench/ext_test.sh NAME CMD...
# CMD gets the test URL appended; pass the extension with the engine's own flag.
set -euo pipefail
name=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
port=$((20000 + RANDOM % 10000))
mkdir -p "$here/results"
out="$here/results/ext-$name.json"
python3 "$here/script_server.py" "$port" ext-test/page > "$out" &
srv=$!
sleep 0.5
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout 45 cage -- "$@" "http://127.0.0.1:$port/index.html" >/dev/null 2>&1 &
br=$!
for _ in $(seq 45); do kill -0 "$srv" 2>/dev/null || break; sleep 1; done
kill "$br" "$srv" 2>/dev/null || true
wait 2>/dev/null || true
if [ -s "$out" ]; then echo "$name: extension ran"; else echo "$name: extension did NOT run"; rm -f "$out"; exit 1; fi
