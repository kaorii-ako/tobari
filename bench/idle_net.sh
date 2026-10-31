#!/usr/bin/env bash
# Idle network capture: bench/idle_net.sh NAME SECONDS CMD...
# Starts CMD with no tabs in a headless cage, adds --log-net-log, waits, and lists the hosts it contacted.
# Writes bench/results/idle-net-NAME.txt.
set -uo pipefail
name=$1; secs=$2; shift 2
here=$(dirname "$0")
log=$(mktemp --suffix=.json)
WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -s INT "$secs" cage -- "$@" --log-net-log="$log" >/dev/null 2>&1
sleep 2
out="$here/results/idle-net-$name.txt"
python3 "$here/idle_net.py" "$log" ${VERBOSE:+-v} > "$out" || exit 1
rm -f "$log"  # can hold URLs; keep only the host list
echo "idle-net $name (${secs}s): $(grep -vcE "blocked|no request" "$out") hosts contacted"
cat "$out"
