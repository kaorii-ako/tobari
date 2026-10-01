#!/usr/bin/env bash
# Measures resident memory for Tobari vs stock Chrome at an identical tab set.
#
# PSS (proportional set size) is the headline number: it divides shared pages
# between the processes mapping them, so a multi-process browser is not
# double-counted. RSS is reported alongside because people expect it, but RSS
# over-counts shared Chromium libraries badly.
set -uo pipefail

SETTLE="${SETTLE:-45}"
URLS=(
  "https://en.wikipedia.org/wiki/Wayland_(protocol)"
  "https://news.ycombinator.com/"
  "https://www.theguardian.com/international"
  "https://github.com/chromiumembedded/cef"
  "https://developer.mozilla.org/en-US/docs/Web/CSS"
  "https://arstechnica.com/"
  "https://www.bbc.com/news"
  "https://stackoverflow.com/questions"
  "https://archlinux.org/"
  "https://www.kernel.org/"
)

# Sums PSS/RSS across every process with the given name. Chrome inside Flatpak
# reparents through bwrap, so walking a process tree from the PID we launched
# does not find the renderers. Instead we take a baseline before launching and
# subtract it, which is correct even when the user already has that browser
# open -- and never requires killing their session.
sum_for() {
  local name="$1" pss=0 rss=0 count=0 v r
  for p in $(pgrep -x "$name" 2>/dev/null); do
    v=$(awk '/^Pss:/{s+=$2} END{print s+0}' "/proc/$p/smaps_rollup" 2>/dev/null)
    r=$(awk '/^Rss:/{s+=$2} END{print s+0}' "/proc/$p/smaps_rollup" 2>/dev/null)
    [ -z "$v" ] && continue
    [ "$v" = "0" ] && continue
    pss=$((pss + v)); rss=$((rss + r)); count=$((count + 1))
  done
  echo "$count $pss $rss"
}

report_delta() {
  local name="$1" label="$2" b_count="$3" b_pss="$4" b_rss="$5"
  read -r a_count a_pss a_rss <<< "$(sum_for "$name")"
  printf '  %-26s %2d procs   PSS %7.1f MB   RSS %7.1f MB\n' \
    "$label" "$((a_count - b_count))" \
    "$(echo "($a_pss - $b_pss)/1024" | bc -l)" \
    "$(echo "($a_rss - $b_rss)/1024" | bc -l)"
  if [ "$b_count" -gt 0 ]; then
    printf '  (baseline excluded: %d pre-existing %s processes, %.1f MB PSS)\n' \
      "$b_count" "$name" "$(echo "$b_pss/1024" | bc -l)"
  fi
}

echo "Tabs: ${#URLS[@]}   settle: ${SETTLE}s"
echo

if [ "${1:-}" = "tobari" ]; then
  BUILD="${TOBARI_BUILD:?set TOBARI_BUILD to the build directory}"
  pkill -x tobari 2>/dev/null; sleep 3
  PROFILE_HOME="$(mktemp -d)"
  read -r BC BP BR <<< "$(sum_for tobari)"
  ( cd "$BUILD" && XDG_DATA_HOME="$PROFILE_HOME" nohup ./tobari --remote-debugging-port=9600 >/dev/null 2>&1 </dev/null & )
  sleep 14
  node "$(dirname "$0")/bench-open.mjs" 9600 "${URLS[@]}"
  sleep "$SETTLE"
  report_delta tobari "tobari" "$BC" "$BP" "$BR"
  for p in $(pgrep -x tobari); do kill "$p" 2>/dev/null; done
  sleep 3
  rm -rf "$PROFILE_HOME"
elif [ "${1:-}" = "chrome" ]; then
  PROFILE="$(mktemp -d)"
  read -r BC BP BR <<< "$(sum_for chrome)"
  flatpak run com.google.Chrome --user-data-dir="$PROFILE" --no-first-run \
    --no-default-browser-check --disable-session-crashed-bubble \
    "${URLS[@]}" >/dev/null 2>&1 &
  sleep $((SETTLE + 25))
  report_delta chrome "google chrome" "$BC" "$BP" "$BR"
  for attempt in 1 2 3; do
    for p in $(pgrep -x chrome); do
      if tr '\0' ' ' < "/proc/$p/cmdline" 2>/dev/null | grep -q "$PROFILE"; then
        kill "$p" 2>/dev/null
      fi
    done
    sleep 4
  done
  rm -rf "$PROFILE"
else
  echo "usage: $0 {tobari|chrome}" >&2
  exit 2
fi
