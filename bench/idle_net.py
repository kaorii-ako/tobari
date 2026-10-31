"""List every host a browser contacts while idle, from a Chromium net log.

Usage: python3 bench/idle_net.py NETLOG.json [-v]   (one host per line with a request count; -v lists URLs)
Run the browser with --log-net-log=NETLOG.json and no tabs, wait, then quit it.
"""
import collections, json, re, sys

head = ""
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    if '"events"' in line:
        break
    head += line
URL_REQUEST = json.loads(head.rstrip().rstrip(",") + "}")["constants"]["logSourceType"]["URL_REQUEST"]
hosts, urls = collections.Counter(), collections.Counter()
src_hosts, failed = collections.defaultdict(set), set()  # URL request id -> hosts (with redirects); ids that never resolved
# One event per line; reading line by line also copes with a log cut off by a hard kill.
for line in open(sys.argv[1], encoding="utf-8", errors="replace"):
    line = line.strip().rstrip(",")
    if not line.startswith('{"params"') and not line.startswith('{"phase"') and not line.startswith('{"source"'):
        continue
    try:
        ev = json.loads(line)
    except json.JSONDecodeError:
        continue
    p, sid = ev.get("params") or {}, (ev.get("source") or {}).get("id")
    if p.get("net_error") == -105:  # ERR_NAME_NOT_RESOLVED
        failed.add(sid)
    for key in ("url", "host"):
        v = p.get(key)
        m = isinstance(v, str) and re.match(r"(?:[a-z-]+://)?([^/:?#]+)", v)
        if m and m.group(1) not in ("127.0.0.1", "localhost", "~notfound") and not v.startswith(("tobari:", "data:", "chrome")):
            if ev["source"]["type"] == URL_REQUEST:
                src_hosts[sid].add(m.group(1))
            hosts[m.group(1)] += 1
            if key == "url":
                urls[v.split("?")[0]] += 1
# A host counts as contacted when a URL request to it resolved. Hosts seen only in DNS or TLS events (an ECH
# public name, for example) never got a request.
asked = set().union(*src_hosts.values()) if src_hosts else set()
reached = set().union(*(h for sid, h in src_hosts.items() if sid not in failed)) if src_hosts else set()
for h, n in sorted(hosts.items()):
    note = "" if h in reached else "\tnot resolved (blocked)" if h in asked else "\tno request"
    print(f"{h}\t{n}{note}")
if "-v" in sys.argv:
    for u, n in urls.most_common(20):
        print(f"  {n}\t{u}", file=sys.stderr)
