#!/usr/bin/env bash
# HTTPS-Only check: bench/https_test.sh BIN. Opens http URLs headless and reads where each tab ended up
# from the saved session. Needs network.
set -uo pipefail
bin=$1
fail=0
check() {  # URL EXPECTED-PREFIX (a leading ! means "must not start with")
  local d; d=$(mktemp -d)
  XDG_DATA_HOME=$d WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
    timeout 25 cage -- "$bin" --ozone-platform=wayland "$1" >/dev/null 2>&1
  local got; got=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["tabs"][0]["url"])' "$d/tobari/session.json" 2>/dev/null)
  rm -rf "$d"
  local ok=0; case $got in "${2#!}"*) ok=1 ;; esac
  [ "${2:0:1}" = '!' ] && [ -n "$got" ] && ok=$((1 - ok))
  case $ok in 1) echo "https: ok   $1 → $got" ;; *) echo "https: FAIL $1 → ${got:-nothing}"; fail=1 ;; esac
}
check http://example.org/ https://example.org/                  # upgraded
check http://http.badssl.com/ tobari://https/#http://http.badssl.com/  # no https: explained, http offered
check http://neverssl.com/ '!http://'  # https redirects to a random host: must never end on plain http
exit $fail
