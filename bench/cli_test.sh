#!/usr/bin/env bash
# CLI check: bench/cli_test.sh BIN. Starts Tobari headless on a local page, then drives it with
# `tobari tabs | open | text | close` as an outside agent would.
set -uo pipefail
bin=$(realpath "$1"); here=$(dirname "$0")
export XDG_DATA_HOME=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
python3 "$here/script_server.py" $port script-test >/dev/null 2>&1 & srv=$!
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -s INT 40 cage -- "$bin" --ozone-platform=wayland http://127.0.0.1:$port/index.html >/dev/null 2>&1 & app=$!
for _ in $(seq 50); do "$bin" tabs >/dev/null 2>&1 && break; sleep 0.2; done
sleep 3
pass=0; fail=()
check() { if eval "$2"; then pass=$((pass + 1)); else fail+=("$1"); fi; }
check tabs_json '"$bin" tabs | python3 -c "import json,sys; t=json.load(sys.stdin); assert len(t)==1 and t[0][\"active\"]"'
check text_thai '"$bin" text | grep -q "ภาษาไทย"'
id=$("$bin" open "http://127.0.0.1:$port/index.html?two")
check open_id '[[ $id =~ ^[0-9]+$ ]] && [ "$("$bin" tabs | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")" = 2 ]'
check no_internal '! "$bin" open tobari://import/ 2>/dev/null'
check close '"$bin" close "$id" && [ "$("$bin" tabs | python3 -c "import json,sys; print(len(json.load(sys.stdin)))")" = 1 ]'
check bad_id '! "$bin" text 99999 2>/dev/null'
check socket_private '[ "$(stat -c %a "$XDG_DATA_HOME/tobari/ctl.sock")" = 600 ]'
kill -INT $app 2>/dev/null; wait $app 2>/dev/null; kill $srv 2>/dev/null
check not_running '! "$bin" tabs 2>/dev/null'
rm -rf "$XDG_DATA_HOME"
echo "cli: $([ ${#fail[@]} = 0 ] && echo PASS || echo FAIL) $pass / $((pass + ${#fail[@]})) ${fail[*]:-}"
[ ${#fail[@]} = 0 ]
