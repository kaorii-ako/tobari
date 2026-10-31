#!/bin/sh
# shot.sh OUT.png SECONDS CMD... — run CMD in a headless 1440x900 cage and screenshot it after SECONDS.
out=$(realpath -m "$1"); wait=$2; shift 2
GRIM=${GRIM:-$(command -v grim || echo "$HOME/.local/opt/grim/usr/bin/grim")}
export WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=${WLR_RENDERER:-gles2} WLR_HEADLESS_OUTPUTS=1
export GRIM OUT="$out" WAIT="$wait"
exec cage -- sh -c 'wlr-randr --output HEADLESS-1 --custom-mode 1440x900 >/dev/null 2>&1; "$@" & pid=$!; sleep "$WAIT"; "$GRIM" "$OUT"; kill $pid; sleep 1; kill -9 $pid 2>/dev/null' sh "$@"
