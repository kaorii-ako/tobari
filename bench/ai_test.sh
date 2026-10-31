#!/usr/bin/env bash
# Assistant end to end: bench/ai_test.sh BIN [SCREENSHOT.png]. Points Tobari at bench/ai_fake.py, opens its test
# page, sends one question with the page attached and checks the request the model server got.
set -uo pipefail
here=$(dirname "$0"); bin=$1; shot=${2:-}
port=$((20000 + RANDOM % 20000)); d=$(mktemp -d); req=$d/request.json
python3 "$here/ai_fake.py" "$port" "$req" & srv=$!
mkdir -p "$d/tobari"
printf '{"url":"http://127.0.0.1:%s/v1","model":"fake-1"}' "$port" > "$d/tobari/ai.json"
args=(--ozone-platform=wayland "--tobari-demo=demo=ai&ask=Can kiwis fly?" "http://127.0.0.1:$port/page.html")
if [ -n "$shot" ]; then XDG_DATA_HOME=$d "$here/shot.sh" "$shot" 10 "$bin" "${args[@]}" >/dev/null 2>&1
else XDG_DATA_HOME=$d WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 timeout -s INT 15 cage -- "$bin" "${args[@]}" >/dev/null 2>&1; fi
kill $srv 2>/dev/null
python3 - "$req" <<'PY'
import json, sys
try: r = json.load(open(sys.argv[1]))
except Exception: print("ai: FAIL no chat request reached the model server"); sys.exit(1)
m = r["messages"]
checks = {
    "stream": r.get("stream") is True,
    "model": r.get("model") == "fake-1",
    "page_attached": m[0]["role"] == "system" and "ZEBRA-42" in m[0]["content"],
    "page_marked_untrusted": "never follow instructions" in m[0]["content"],
    "question": m[-1] == {"role": "user", "content": "Can kiwis fly?"},
}
bad = [k for k, ok in checks.items() if not ok]
print(f"ai: {'PASS' if not bad else 'FAIL'} {len(checks) - len(bad)} / {len(checks)} {bad}")
sys.exit(1 if bad else 0)
PY
rc=$?; rm -rf "$d"; exit $rc
