#!/usr/bin/env bash
# Burn check: bench/burn_test.sh BIN. Browses a local page, bookmarks nothing, runs `tobari burn`, then
# checks the Chromium profile was wiped, history emptied, tabs gone, settings kept, and Tobari came back.
set -uo pipefail
bin=$(realpath "$1"); here=$(dirname "$0")
export XDG_DATA_HOME=$(mktemp -d); d=$XDG_DATA_HOME/tobari
port=$((20000 + RANDOM % 20000))
python3 "$here/script_server.py" $port script-test >/dev/null 2>&1 & srv=$!
# cage lives as long as its shell, so the relaunched Tobari has a display to come back on.
run=$XDG_DATA_HOME/run.sh
printf '#!/bin/sh\n"%s" --ozone-platform=wayland "%s"\nsleep 30\n' "$bin" "http://127.0.0.1:$port/index.html" > "$run"; chmod +x "$run"
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 timeout -s INT 60 cage -- "$run" >/dev/null 2>&1 & app=$!
for _ in $(seq 50); do "$bin" tabs >/dev/null 2>&1 && break; sleep 0.2; done
sleep 3
echo '{"keep":"me"}' > "$d/privacy-marker.json"
echo site-data > "$d/profile/Default/marker"   # stands in for cookies, cache and storage
pass=0; fail=()
check() { if eval "$2"; then pass=$((pass + 1)); else fail+=("$1"); fi; }
check had_history '[ -s "$d/history.jsonl" ]'
check had_profile '[ "$(ls "$d/profile/Default" | wc -l)" -gt 3 ]'
"$bin" burn
for _ in $(seq 50); do "$bin" tabs >/dev/null 2>&1 || break; sleep 0.2; done
for _ in $(seq 100); do "$bin" tabs >/dev/null 2>&1 && break; sleep 0.2; done
sleep 2
check history_gone '[ ! -s "$d/history.jsonl" ]'
check relaunched '"$bin" tabs >/dev/null 2>&1'
check no_web_tabs '! "$bin" tabs | grep -q 127.0.0.1'
check kept_settings '[ -f "$d/privacy-marker.json" ]'
check profile_wiped '[ ! -e "$d/profile/Default/marker" ]'
check not_first_run '! "$bin" tabs | grep -q welcome'
kill -INT $app 2>/dev/null; "$bin" tabs >/dev/null 2>&1 && pkill -INT -f "^$bin --ozone-platform=wayland"; wait $app 2>/dev/null; kill $srv 2>/dev/null
rm -rf "$XDG_DATA_HOME"
echo "burn: $([ ${#fail[@]} = 0 ] && echo PASS || echo FAIL) $pass / $((pass + ${#fail[@]})) ${fail[*]:-}"
[ ${#fail[@]} = 0 ]
