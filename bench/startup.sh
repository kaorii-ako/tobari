#!/usr/bin/env bash
# Cold start to first page: bench/startup.sh NAME CMD... CMD gets a local test page appended. The time runs from
# launch until that page has rendered its CJK/Thai checks and posted them, with a fresh profile each run (the
# caller's CMD must point at one). Includes the headless cage's own start, which is the same for every browser.
# Appends one JSON line to bench/results/startup.jsonl.
set -uo pipefail
name=$1; shift
here=$(cd "$(dirname "$0")" && pwd)
runs=() 
for _ in 1 2 3 4 5; do
  port=$((20000 + RANDOM % 20000))
  python3 "$here/script_server.py" $port >/dev/null & srv=$!
  sleep 0.3
  t0=$(date +%s%N)
  WLR_BACKENDS=headless WLR_RENDERER=gles2 WLR_LIBINPUT_NO_DEVICES=1 \
    timeout 60 cage -- "$@" "http://127.0.0.1:$port/index.html" >/dev/null 2>&1 & br=$!
  wait $srv; t1=$(date +%s%N)
  kill $br 2>/dev/null; wait $br 2>/dev/null; sleep 1
  runs+=($(( (t1 - t0) / 1000000 )))
done
python3 - "$name" "${runs[@]}" <<'PY' | tee -a "$here/results/startup.jsonl"
import json, statistics, sys, datetime
ms = list(map(int, sys.argv[2:]))
print(json.dumps({"name": sys.argv[1], "median_ms": statistics.median(ms), "samples_ms": ms, "date": str(datetime.date.today())}))
PY
