#!/usr/bin/env bash
# Records docs/producthunt/out/demo.gif: an agent drives Tobari over MCP (open, fill, click, read) while grim
# grabs frames from a headless 1440x900 cage. bench/demo_gif.sh BIN
set -uo pipefail
bin=$(realpath "$1"); here=$(realpath "$(dirname "$0")"); out=$here/../docs/producthunt/out
frames=$(mktemp -d); mkdir -p "$out"
export XDG_DATA_HOME=$(mktemp -d)
port=$((20000 + RANDOM % 20000))
python3 "$here/script_server.py" $port demo >/dev/null 2>&1 & srv=$!
GRIM=${GRIM:-$(command -v grim || echo "$HOME/.local/opt/grim/usr/bin/grim")}
export WLR_BACKENDS=headless WLR_LIBINPUT_NO_DEVICES=1 WLR_RENDERER=${WLR_RENDERER:-gles2} WLR_HEADLESS_OUTPUTS=1
export GRIM FRAMES=$frames BIN=$bin PORT=$port HERE=$here
timeout 90 cage -- sh -c '
  wlr-randr --output HEADLESS-1 --custom-mode 1440x900 >/dev/null 2>&1
  "$BIN" --ozone-platform=wayland "--tobari-demo=theme=dark&demo=x" >/dev/null 2>&1 & app=$!
  for _ in $(seq 60); do "$BIN" tabs >/dev/null 2>&1 && break; sleep 0.2; done
  sleep 2
  ( i=0; while [ ! -e "$FRAMES/stop" ]; do "$GRIM" -l 0 "$FRAMES/$(printf %04d $i).png" 2>/dev/null; i=$((i+1)); sleep 0.12; done ) &
  python3 "$HERE/demo_agent.py" "$BIN" "http://127.0.0.1:$PORT/index.html"
  touch "$FRAMES/stop"; sleep 0.5; kill $app; sleep 1; kill -9 $app 2>/dev/null'
kill $srv
python3 - "$frames" "$out/demo.gif" <<'P'
import glob, sys
from PIL import Image
files = sorted(glob.glob(sys.argv[1] + "/*.png"))
ims = [Image.open(f).convert("RGB").resize((960, 600), Image.LANCZOS) for f in files]
pal = [im.quantize(colors=128, method=Image.Quantize.MEDIANCUT, dither=Image.Dither.NONE) for im in ims]
d = [140] * len(pal); d[-1] = 2500
pal[0].save(sys.argv[2], save_all=True, append_images=pal[1:], duration=d, loop=0, optimize=True)
print(len(ims), "frames ->", sys.argv[2])
P
