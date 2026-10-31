#!/usr/bin/env bash
# Import check: bench/import_test.sh BIN. Builds fake Chromium and Firefox profiles in a temporary HOME, opens
# tobari://import/#all headless and checks what landed in history.jsonl.
set -uo pipefail
bin=$(realpath "$1"); here=$(dirname "$0")
home=$(mktemp -d)
python3 "$here/import_fixture.py" "$home" || exit 1
HOME=$home XDG_DATA_HOME=$home/data WLR_BACKENDS=headless WLR_RENDERER=pixman WLR_LIBINPUT_NO_DEVICES=1 \
  timeout -s INT 15 cage -- "$bin" --ozone-platform=wayland tobari://import/#all >/dev/null 2>&1
python3 - "$home/data/tobari/history.jsonl" <<'PY'
import json, sys
recs = [json.loads(l) for l in open(sys.argv[1])] if __import__("os").path.exists(sys.argv[1]) else []
marks = {r["u"] for r in recs if r.get("b")}
visits = {r["u"]: r for r in recs if not r.get("b")}
checks = {
    "chromium_bookmark": "https://chromium-mark.example/" in marks,
    "nested_thai_bookmark": "https://thai-mark.example/" in marks,
    "firefox_bookmark": "https://firefox-mark.example/" in marks,
    "chromium_history": visits.get("https://chromium-visit.example/", {}).get("n") == 7,
    "chromium_time": visits.get("https://chromium-visit.example/", {}).get("s") == 1755526400,
    "firefox_history": visits.get("https://firefox-visit.example/", {}).get("s") == 1750000000,
    "only_web_urls": all(r["u"].startswith(("http://", "https://")) for r in recs),
}
failed = [k for k, v in checks.items() if not v]
print(f"import: {'PASS' if not failed else 'FAIL'} {len(checks) - len(failed)} / {len(checks)} {failed}")
sys.exit(1 if failed else 0)
PY
r=$?; rm -rf "$home"; exit $r
