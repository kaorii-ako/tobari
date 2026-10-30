#!/usr/bin/env bash
# Grade CJK and Thai rendering in one browser: bench/script_test.sh NAME CMD...
# CMD gets the test URL appended. Runs inside a headless cage so no window shows.
set -euo pipefail
name=$1; shift
here=$(dirname "$0")
port=$((20000 + RANDOM % 10000))
out="$here/results/script-$name.json"
mkdir -p "$here/results"
python3 "$here/script_server.py" "$port" > "$out.tmp" &
srv=$!
sleep 0.5
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout 60 cage -- "$@" "http://127.0.0.1:$port/index.html" >/dev/null 2>&1 &
br=$!
for _ in $(seq 60); do kill -0 "$srv" 2>/dev/null || break; sleep 1; done
kill "$br" "$srv" 2>/dev/null || true
wait 2>/dev/null || true
[ -s "$out.tmp" ] || { echo "$name: no result (browser did not post)"; rm -f "$out.tmp"; exit 1; }
mv "$out.tmp" "$out"
python3 -c 'import json,sys; r=json.load(open(sys.argv[2])); print(sys.argv[1]+":", "PASS" if not r["failed"] else "FAIL", r["total"]-len(r["failed"]), "/", r["total"], r["failed"][:6])' "$name" "$out"
