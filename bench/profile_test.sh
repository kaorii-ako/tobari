#!/usr/bin/env bash
# First run and profiles: bench/profile_test.sh BIN. A fresh data folder opens tobari://welcome/ once; a second
# profile runs as its own browser with its own data folder, cookies and CLI socket, next to the default one.
set -uo pipefail
bin=$(realpath "$1")
export XDG_DATA_HOME=$(mktemp -d) WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1
pass=0; fail=()
check() { if eval "$2"; then pass=$((pass + 1)); else fail+=("$1"); fi; }
start() { timeout -s INT 30 cage -- "$bin" --ozone-platform=wayland "$@" >/dev/null 2>&1 & }
ready() { for _ in $(seq 60); do "$bin" "$@" tabs >/dev/null 2>&1 && return; sleep 0.25; done; }
urls() { "$bin" "$@" tabs | python3 -c "import json,sys; print(' '.join(t['url'] for t in json.load(sys.stdin)))"; }
stop() { pkill -INT -f "$bin --ozone-platform=wayland${1:+ $1}\$" ; sleep 2; pkill -INT -x cage; sleep 1; }

start; ready; sleep 1
check welcome_first_run '[[ "$(urls)" == *tobari://welcome/* ]]'
stop
start; ready; sleep 1
check no_welcome_second_run '[[ "$(urls)" != *tobari://welcome/* ]]'
start --profile=School; ready --profile=School; sleep 1
check profile_welcome '[[ "$(urls --profile=School)" == *tobari://welcome/* ]]'
check profile_own_folder '[ -S "$XDG_DATA_HOME/tobari/profiles/School/ctl.sock" ] && [ -d "$XDG_DATA_HOME/tobari/profiles/School/profile" ]'
check both_running '"$bin" tabs >/dev/null && "$bin" --profile=School tabs >/dev/null'
"$bin" profile Work; ready --profile=Work
check open_from_running '"$bin" --profile=Work tabs >/dev/null && [ -d "$XDG_DATA_HOME/tobari/profiles/Work/profile" ]'
check bad_name '! "$bin" --profile=../x tabs 2>/dev/null; [ ! -e "$XDG_DATA_HOME/tobari/x" ]'
pkill -INT -f -- "--profile=Work"; pkill -INT -x cage; sleep 2
rm -rf "$XDG_DATA_HOME"
echo "profile: $([ ${#fail[@]} = 0 ] && echo PASS || echo FAIL) $pass / $((pass + ${#fail[@]})) ${fail[*]:-}"
[ ${#fail[@]} = 0 ]
