#!/usr/bin/env python3
"""Engine-currency watch: is Tobari's pinned Chromium behind Chrome stable?

Reads the pinned CEF version from shell/provision-cef.sh, the newest Linux
stable CEF build from Spotify's index, and recent desktop stable releases from
Chrome's release blog. Prints a report; with --issue, opens or updates a GitHub
issue (needs GH_TOKEN with issues:write and nothing else).

Exit status: 0 current, 1 behind with no CEF build available, 2 behind with a
CEF build available to bump to.
"""
import argparse
import html
import json
import os
import re
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
CEF_INDEX = "https://cef-builds.spotifycdn.com/index.json"
CHROME_FEED = "https://chromereleases.googleblog.com/feeds/posts/default?max-results=25"
LABEL = "engine-currency"


def fetch(url, timeout=300):
    req = urllib.request.Request(url, headers={"User-Agent": "tobari-cef-watch"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def vtuple(v):
    return tuple(int(x) for x in v.split("."))


def pinned():
    text = (ROOT / "shell/provision-cef.sh").read_text()
    m = re.search(r'CEF_VERSION="\$\{CEF_VERSION:-([^}]+)\}"', text)
    cef = m.group(1)
    return cef, cef.split("chromium-")[1]


def newest_cef(index):
    best = None
    for v in index["linux64"]["versions"]:
        if v.get("channel") != "stable":
            continue
        if not any(f["type"] == "minimal" for f in v["files"]):
            continue
        if best is None or vtuple(v["chromium_version"]) > vtuple(best["chromium_version"]):
            best = v
    return best


def chrome_releases(feed):
    out = []
    for entry in re.findall(r"<entry>(.*?)</entry>", feed, re.S):
        title = re.search(r"<title[^>]*>(.*?)</title>", entry, re.S).group(1)
        if "Stable Channel Update for Desktop" not in title:
            continue
        published = re.search(r"<published>(.*?)</published>", entry).group(1)[:10]
        body = html.unescape(re.search(r"<content[^>]*>(.*?)</content>", entry, re.S).group(1))
        text = re.sub(r"\s+", " ", re.sub(r"<[^>]+>", " ", body))
        linux = re.search(r"(\d+\.\d+\.\d+\.\d+)(?:/\.\d+)? (?:to|for) Linux", text)
        version = linux.group(1) if linux else None
        if not version:
            continue
        fixes = re.search(r"includes (\d+) security fix", text)
        cves = re.findall(r"(Critical|High|Medium|Low) (CVE-\d{4}-\d+): ([^.]+)\.", text)
        out.append({
            "version": version,
            "published": published,
            "fixes": int(fixes.group(1)) if fixes else 0,
            "cves": [{"severity": s, "id": c, "summary": d.strip()} for s, c, d in cves],
        })
    return out


def report(cef_pin, chromium_pin, latest_cef, releases):
    ahead = [r for r in releases if vtuple(r["version"]) > vtuple(chromium_pin)]
    lines = [
        f"Pinned: CEF {cef_pin} (Chromium {chromium_pin})",
        f"Newest CEF stable: {latest_cef['cef_version']} (Chromium {latest_cef['chromium_version']})",
    ]
    if not ahead:
        lines.append("Chrome stable has no release newer than the pinned Chromium.")
        return 0, "\n".join(lines), ahead
    lines.append("")
    lines.append("Chrome stable releases Tobari does not have:")
    for r in ahead:
        sev = {}
        for c in r["cves"]:
            sev[c["severity"]] = sev.get(c["severity"], 0) + 1
        sevs = ", ".join(f"{n} {s}" for s, n in sorted(sev.items(), key=lambda kv: ["Critical", "High", "Medium", "Low"].index(kv[0])))
        lines.append(f"- {r['version']} ({r['published']}): {r['fixes']} security fixes ({sevs or 'none listed'})")
        for c in r["cves"]:
            if c["severity"] in ("Critical", "High"):
                lines.append(f"    - {c['severity']} {c['id']}: {c['summary']}")
    bumpable = vtuple(latest_cef["chromium_version"]) > vtuple(chromium_pin)
    lines.append("")
    if bumpable:
        lines.append(f"ACTION: a CEF build is available. Bump to {latest_cef['cef_version']} (docs/RELEASING.md).")
        return 2, "\n".join(lines), ahead
    lines.append("No CEF stable build carries a newer Chromium yet. The gap is open; record it in SECURITY.md.")
    return 1, "\n".join(lines), ahead


def upsert_issue(title, body):
    existing = subprocess.run(
        ["gh", "issue", "list", "--label", LABEL, "--state", "open", "--json", "number", "--limit", "1"],
        capture_output=True, text=True, check=True)
    issues = json.loads(existing.stdout or "[]")
    if issues:
        subprocess.run(["gh", "issue", "edit", str(issues[0]["number"]), "--title", title, "--body", body], check=True)
    else:
        subprocess.run(["gh", "issue", "create", "--label", LABEL, "--title", title, "--body", body], check=True)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--issue", action="store_true", help="open or update a GitHub issue when behind")
    args = parser.parse_args()

    cef_pin, chromium_pin = pinned()
    latest = newest_cef(json.loads(fetch(CEF_INDEX)))
    releases = chrome_releases(fetch(CHROME_FEED))
    status, text, ahead = report(cef_pin, chromium_pin, latest, releases)
    print(text)

    if args.issue and status:
        newest = max(ahead, key=lambda r: vtuple(r["version"]))
        title = f"Engine behind Chrome stable: {chromium_pin} vs {newest['version']}"
        # The report quotes CVE summaries from a remote feed; a fence longer
        # than any backtick run inside it cannot be closed early.
        fence = "`" * (max([3] + [len(m) + 1 for m in re.findall(r"`+", text)]))
        upsert_issue(title, f"Automated engine-currency check.\n\n{fence}\n{text}\n{fence}\n")
    return status


if __name__ == "__main__":
    # Exit codes 0-2 are verdicts. A crash (feed format change, network
    # failure) exits 3 so the scheduled workflow fails loudly instead of
    # reading as "behind, no build yet".
    try:
        sys.exit(main())
    except SystemExit:
        raise
    except BaseException as exc:  # noqa: BLE001
        print(f"cef-watch failed: {exc!r}", file=sys.stderr)
        sys.exit(3)
