#!/usr/bin/env bash
# Step 5: Tobari against stock Chromium and Firefox (unpacked in ~/.cache/tobari-engines, see docs/engine-decision.md).
# bench/compare.sh TOBARI_BIN: RAM at 0 and 10 tabs (3 rounds, bench/ram.py) and cold start to a rendered page
# (5 runs, bench/startup.sh), each with a fresh profile. Results append to bench/results/{ram,startup}.jsonl;
# python3 bench/report.py turns them into docs/benchmark.md.
set -euo pipefail
cd "$(dirname "$0")"
tob=$(realpath "$1"); E=~/.cache/tobari-engines; tag=$(date +%F)
ffprofile() {  # no first-run tabs, so "0 tabs" means one blank tab
  local d; d=$(mktemp -d)
  printf '%s\n' 'user_pref("browser.aboutwelcome.enabled", false);' \
    'user_pref("browser.startup.homepage_override.mstone", "ignore");' \
    'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);' \
    'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);' > "$d/user.js"
  echo "$d"
}
tobari=(sh -c 'XDG_DATA_HOME=$(mktemp -d) exec "$0" --ozone-platform=wayland "$@"' "$tob")
chromium=("$E/chromium/chrome-linux/chrome" --ozone-platform=wayland --no-first-run --no-default-browser-check)
for run in 1 2 3; do
  for tabs in 0 10; do
    python3 ram.py "tobari-$tag" "$tabs" -- "${tobari[@]}"
    python3 ram.py "chromium-$tag" "$tabs" -- "${chromium[@]}" --user-data-dir="$(mktemp -d)"
    python3 ram.py "firefox-$tag" "$tabs" -- "$E/firefox/firefox/firefox" --no-remote --profile "$(ffprofile)"
  done
done
bash startup.sh "tobari-$tag" "${tobari[@]}"
bash startup.sh "chromium-$tag" sh -c 'exec "$@" --user-data-dir="$(mktemp -d)"' sh "${chromium[@]}"
bash startup.sh "firefox-$tag" sh -c 'exec "$0" --no-remote --profile "$(mktemp -d)" "$@"' "$E/firefox/firefox/firefox"
