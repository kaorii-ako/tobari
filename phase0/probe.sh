#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
usage: probe.sh <engine> [binary]

engines:
  flatpak:<app-id>   run on the HOST. e.g. flatpak:com.google.Chrome, flatpak:org.mozilla.firefox
                     strace comes from the matching org.freedesktop.Sdk via --devel
  chromium <bin>     run in distrobox. Chromium-family binary (Chromium, cefsimple, cefclient)
  firefox <bin>      run in distrobox. Firefox binary

env:
  PROBE_SECONDS      how long the headful strace run lasts (default 20)
  PROBE_OUT          output dir (default phase0/results/<host>-<engine>-<date>)
EOF
  exit 2
}

[[ $# -ge 1 ]] || usage
ENGINE=$1
BIN=${2:-}
HERE=$(cd "$(dirname "$0")" && pwd)
PAGE="$HERE/cjk-thai.html"
SECS=${PROBE_SECONDS:-20}
SLUG=$(echo "$ENGINE" | tr ':/' '__')
OUT=${PROBE_OUT:-"$HERE/results/$(hostname -s)-$SLUG-$(date +%Y%m%d-%H%M%S)"}
mkdir -p "$OUT"
REPORT="$OUT/report.md"

say() { printf '%s\n' "$*" | tee -a "$REPORT"; }
block() { printf '```\n' >>"$REPORT"; cat >>"$REPORT"; printf '```\n\n' >>"$REPORT"; }

say "# Font probe: $ENGINE"
say ""
say "- date: $(date -Is)"
say "- host: $(hostname) ($(. /etc/os-release && echo "$PRETTY_NAME"))"
say "- inside distrobox: $([[ -n "${CONTAINER_ID:-}" || -f /run/.containerenv ]] && echo yes || echo no)"
say "- session: ${XDG_SESSION_TYPE:-unknown} ${XDG_CURRENT_DESKTOP:-}"
say ""

JA_FILE=""
fc_report() {
  local run=("$@")
  JA_FILE=$("${run[@]}" fc-match -f '%{file}' 'sans-serif:lang=ja' 2>/dev/null | xargs -0 basename 2>/dev/null || true)
  say "## fontconfig as the engine sees it"
  {
    echo "\$ fc-match 'sans-serif:lang=ja'"; "${run[@]}" fc-match -f '%{family[0]} | %{file} | index=%{index}\n' 'sans-serif:lang=ja' 2>&1 || true
    echo "\$ fc-match 'sans-serif:lang=th'"; "${run[@]}" fc-match -f '%{family[0]} | %{file}\n' 'sans-serif:lang=th' 2>&1 || true
    echo "\$ fc-match 'Noto Sans CJK JP'"; "${run[@]}" fc-match -f '%{family[0]} | %{file} | index=%{index}\n' 'Noto Sans CJK JP' 2>&1 || true
    echo "\$ fc-list :lang=ja file | wc -l"; "${run[@]}" sh -c 'fc-list :lang=ja file | wc -l' 2>&1 || true
    echo "\$ fc-list | grep -i cjk | head"; "${run[@]}" sh -c 'fc-list | grep -i cjk | head -5' 2>&1 || true
    echo "\$ fc-cache --version"; "${run[@]}" fc-cache --version 2>&1 || true
    echo "\$ env | grep -i fontconfig"; "${run[@]}" sh -c 'env | grep -i fontconfig || echo "(none)"' 2>&1 || true
  } | block
}

summarize_strace() {
  local log=$1
  set +o pipefail
  say "## strace summary"
  say ""
  say "- CJK font opened (success): $(grep -E 'openat\(.*[Nn]oto[^"]*CJK' "$log" | grep -vcE '= -1' || true)"
  say "- CJK font ENOENT: $(grep -E 'openat\(.*[Nn]oto[^"]*CJK' "$log" | grep -c 'ENOENT' || true)"
  say "- CJK font EACCES/EPERM: $(grep -E 'openat\(.*[Nn]oto[^"]*CJK' "$log" | grep -cE 'EACCES|EPERM' || true)"
  if [[ -n "$JA_FILE" ]]; then
    say "- lang=ja fallback file $JA_FILE opened (success): $(grep -F "$JA_FILE" "$log" | grep -vcE '= -1' || true)"
    say "- lang=ja fallback file $JA_FILE failed: $(grep -F "$JA_FILE" "$log" | grep -cE '= -1' || true)"
  fi
  say "- Thai font opened (success): $(grep -E 'openat\(.*([Tt]hai|tlwg|Loma|Garuda)' "$log" | grep -vcE '= -1' || true)"
  say "- any font path EACCES/EPERM: $(grep -E 'openat\(.*(/fonts/|\.tt[fc]|\.otf)' "$log" | grep -cE 'EACCES|EPERM' || true)"
  say ""
  say "### libfontconfig / libfreetype / libharfbuzz loaded"
  grep -oE '"[^"]*lib(fontconfig|freetype|harfbuzz)[^"]*\.so[^"]*"[^=]*= [0-9]+' "$log" | sort -u | head -20 | block
  say "### fontconfig config files read"
  grep -oE 'openat\([^"]*"[^"]*(fonts\.conf|conf\.d/[^"]*\.conf|fonts/[^"]*\.conf)"[^=]*= [0-9]+' "$log" | grep -oE '"[^"]+"' | sort -u | head -60 | block
  say "### fontconfig cache dirs touched"
  grep -oE '"[^"]*fontconfig[^"]*cache[^"]*"[^=]*= -?[0-9]+( [A-Z]+)?' "$log" | sort -u | head -30 | block
  say "### every CJK font open (first 20)"
  grep -E 'openat\(.*[Nn]oto[^"]*CJK' "$log" | head -20 | block
  say "### font-path failures (first 40)"
  grep -E 'openat\(.*(/fonts/|\.tt[fc]|\.otf)' "$log" | grep -E '= -1' | head -40 | block
}

headless_verdict_chromium() {
  local run=("$@")
  say "## headless verdict (--dump-dom)"
  timeout 60 "${run[@]}" --headless --disable-gpu --virtual-time-budget=4000 --dump-dom "file://$PAGE" 2>/dev/null \
    | sed -n '/TOBARI-PROBE-BEGIN/,/TOBARI-PROBE-END/p' | sed 's/<[^>]*>//g' | block || say "(dump-dom failed)"
  timeout 60 "${run[@]}" --headless --disable-gpu --window-size=1000,1400 --virtual-time-budget=4000 \
    --screenshot="$OUT/headless.png" "file://$PAGE" >/dev/null 2>&1 || true
  [[ -f "$OUT/headless.png" ]] && say "screenshot: headless.png" && say ""
}

case "$ENGINE" in
  flatpak:*)
    APP=${ENGINE#flatpak:}
    command -v flatpak >/dev/null || { echo "flatpak not found: run this on the host, not in distrobox"; exit 1; }
    say "- app: $APP $(flatpak info "$APP" 2>/dev/null | awk -F': *' '/Version|Runtime/{printf "%s=%s ", $1, $2}')"
    say ""
    fc_report flatpak run --command=sh "$APP" -c '"$@"' _
    APPDATA="$HOME/.var/app/$APP/tobari-probe"
    mkdir -p "$APPDATA"
    cp "$PAGE" "$APPDATA/cjk-thai.html"
    PAGE="$APPDATA/cjk-thai.html"
    ENTRY=$(flatpak info -m "$APP" | awk -F= '/^command=/{print $2}')
    if [[ "$APP" == *firefox* ]]; then
      say "## headless verdict"
      timeout 90 flatpak run "$APP" --headless --window-size=1000,1400 --screenshot "$APPDATA/headless.png" "file://$PAGE" >/dev/null 2>&1 || true
      [[ -f "$APPDATA/headless.png" ]] && cp "$APPDATA/headless.png" "$OUT/" && say "screenshot: headless.png (read the PASS/FAIL badges)" && say ""
    else
      headless_verdict_chromium flatpak run "$APP"
    fi
    say "## headful strace ($SECS s) via org.freedesktop.Sdk"
    if flatpak run --devel --command=sh "$APP" -c 'command -v strace' >/dev/null 2>&1; then
      flatpak run --devel --command=strace "$APP" \
        -f -e trace=openat -o "$APPDATA/strace.log" "$ENTRY" "file://$PAGE" >/dev/null 2>&1 &
      sleep "$SECS"; flatpak kill "$APP" 2>/dev/null || true; wait || true
      cp "$APPDATA/strace.log" "$OUT/strace.log" 2>/dev/null || true
    else
      say "strace unavailable: install the Sdk matching this app's runtime with"
      say "  flatpak install --user flathub $(flatpak info "$APP" | awk -F': *' '/Runtime/{print $2}' | sed 's/Platform/Sdk/')"
    fi
    ;;
  chromium)
    [[ -x "$BIN" ]] || usage
    fc_report env
    headless_verdict_chromium "$BIN"
    say "## headful strace ($SECS s)"
    PROFILE=$(mktemp -d -t tobari-probe-XXXX)
    strace -f -e trace=openat -o "$OUT/strace.log" "$BIN" --user-data-dir="$PROFILE" --no-first-run "file://$PAGE" >/dev/null 2>&1 &
    sleep "$SECS"; pkill -TERM -f "$PROFILE" || true; wait || true
    ;;
  firefox)
    [[ -x "$BIN" ]] || usage
    fc_report env
    say "## headless verdict"
    timeout 90 "$BIN" --headless --profile "$(mktemp -d)" --window-size=1000,1400 --screenshot "$OUT/headless.png" "file://$PAGE" >/dev/null 2>&1 || true
    [[ -f "$OUT/headless.png" ]] && say "screenshot: headless.png (read the PASS/FAIL badges)" && say ""
    say "## headful strace ($SECS s)"
    PROFILE=$(mktemp -d -t tobari-probe-XXXX)
    strace -f -e trace=openat -o "$OUT/strace.log" "$BIN" --no-remote --profile "$PROFILE" "file://$PAGE" >/dev/null 2>&1 &
    sleep "$SECS"; pkill -TERM -f "$PROFILE" || true; wait || true
    ;;
  *) usage ;;
esac

if [[ -s "$OUT/strace.log" ]]; then
  summarize_strace "$OUT/strace.log"
  gzip -f "$OUT/strace.log"
fi

say "During the headful run, look at the window and the browser's own UI (tab title, menus). Note whether 帳 shows as a glyph or a box."
echo
echo "report: $REPORT"
