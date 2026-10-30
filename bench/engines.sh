#!/usr/bin/env bash
# Step 1 engine RAM: CEF (Chrome style), Chromium, Firefox (Gecko) at 0 and 10 tabs, 3 runs each.
# Engines are unpacked in ~/.cache/tobari-engines (see docs/engine-decision.md for versions).
set -euo pipefail
cd "$(dirname "$0")"
E=~/.cache/tobari-engines
CEF=$(echo "$E"/cef/*/Release/cefsimple)
ffprofile() {  # fresh profile without first-run tabs, so "0 tabs" means one blank tab
  local d; d=$(mktemp -d)
  printf '%s\n' 'user_pref("browser.aboutwelcome.enabled", false);' \
    'user_pref("browser.startup.homepage_override.mstone", "ignore");' \
    'user_pref("datareporting.policy.dataSubmissionPolicyBypassNotification", true);' \
    'user_pref("trailhead.firstrun.didSeeAboutWelcome", true);' > "$d/user.js"
  echo "$d"
}
for run in 1 2 3; do
  for tabs in 0 10; do
    python3 ram.py chromium "$tabs" -- "$E/chromium/chrome-linux/chrome" --ozone-platform=wayland \
      --no-first-run --no-default-browser-check --user-data-dir="$(mktemp -d)"
    python3 ram.py firefox "$tabs" -- "$E/firefox/firefox/firefox" --no-remote --profile "$(ffprofile)"
    python3 ram.py cef "$tabs" --popups -- sh -c "exec $CEF --ozone-platform=wayland --disable-popup-blocking \
      --root-cache-path=$(mktemp -d) --url=\"\$0\""
  done
done
