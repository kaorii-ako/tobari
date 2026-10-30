#!/usr/bin/env python3
import argparse
import datetime
import http.server
import json
import os
import platform
import shutil
import signal
import socketserver
import subprocess
import sys
import tempfile
import threading
import time

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.dirname(HERE)
EXT = os.path.join(REPO, "extension", "dist")
EXT_ID = "dbpaojilndlchffoodnamfgjccblnpoe"

CHROMIUM_FLAGS = [
    "--no-first-run",
    "--no-default-browser-check",
    "--disable-sync",
    "--password-store=basic",
    "--disable-features=Translate,MediaRouter",
    "--disable-background-networking",
]

BROWSERS = {
    "tobari": {"family": "tobari", "bins": ["tobari-shell"], "flatpak": "dev.tobari.Tobari"},
    "tobari-ext": {"family": "tobari-ext", "bins": ["chromium", "chromium-browser"], "flatpak": None},
    "chromium": {"family": "chromium", "bins": ["chromium", "chromium-browser"], "flatpak": "org.chromium.Chromium"},
    "chrome": {"family": "chromium", "bins": ["google-chrome-stable", "google-chrome"], "flatpak": "com.google.Chrome"},
    "brave": {"family": "chromium", "bins": ["brave-browser", "brave"], "flatpak": "com.brave.Browser"},
    "firefox": {"family": "firefox", "bins": ["firefox"], "flatpak": "org.mozilla.firefox"},
    "zen": {"family": "firefox", "bins": ["zen-browser", "zen"], "flatpak": "app.zen_browser.zen"},
}


def find_launcher(name, override):
    if override:
        return override.split()
    spec = BROWSERS[name]
    for b in spec["bins"]:
        p = shutil.which(b)
        if p:
            return [p]
    if spec["flatpak"] and shutil.which("flatpak"):
        r = subprocess.run(["flatpak", "info", spec["flatpak"]], capture_output=True)
        if r.returncode == 0:
            return ["flatpak", "run", spec["flatpak"]]
    return None


def version_of(cmd):
    try:
        r = subprocess.run(cmd + ["--version"], capture_output=True, text=True, timeout=20)
        return (r.stdout or r.stderr).strip().splitlines()[0][:80]
    except Exception:
        return "unknown"


def children_map():
    kids = {}
    for pid in os.listdir("/proc"):
        if not pid.isdigit():
            continue
        try:
            with open(f"/proc/{pid}/stat") as f:
                stat = f.read()
            ppid = int(stat[stat.rindex(")") + 2 :].split()[1])
            kids.setdefault(ppid, []).append(int(pid))
        except (OSError, ValueError):
            pass
    return kids


def tree(root):
    kids = children_map()
    out, stack = [], [root]
    while stack:
        p = stack.pop()
        out.append(p)
        stack.extend(kids.get(p, []))
    return out


def pss_kib(pid):
    try:
        with open(f"/proc/{pid}/smaps_rollup") as f:
            for line in f:
                if line.startswith("Pss:"):
                    return int(line.split()[1])
    except OSError:
        return 0
    return 0


def comm(pid):
    try:
        with open(f"/proc/{pid}/comm") as f:
            return f.read().strip()
    except OSError:
        return "?"


def measure(root, samples=3, gap=2.0):
    vals = []
    procs = 0
    by_comm = {}
    for _ in range(samples):
        pids = tree(root)
        procs = len(pids)
        total = 0
        by_comm = {}
        for p in pids:
            k = pss_kib(p)
            total += k
            c = comm(p)
            by_comm[c] = by_comm.get(c, 0) + k
        vals.append(total)
        time.sleep(gap)
    vals.sort()
    return vals[len(vals) // 2], procs, by_comm


class Quiet(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a):
        pass


def serve_corpus(port):
    corpus = os.path.join(HERE, "corpus")
    if not os.path.isdir(corpus):
        subprocess.run([sys.executable, os.path.join(HERE, "make_corpus.py")], check=True)
    handler = lambda *a, **k: Quiet(*a, directory=corpus, **k)
    srv = socketserver.ThreadingTCPServer(("127.0.0.1", port), handler)
    srv.daemon_threads = True
    threading.Thread(target=srv.serve_forever, daemon=True).start()
    return srv


def page_list(args):
    if args.pages == "local":
        return [f"http://127.0.0.1:{args.port}/page{i:02d}.html" for i in range(1, 26)]
    with open(args.pages) as f:
        return [l.strip() for l in f if l.strip() and not l.startswith("#")]


def firefox_profile(d):
    with open(os.path.join(d, "user.js"), "w") as f:
        for k, v in {
            "browser.aboutwelcome.enabled": "false",
            "browser.startup.homepage_override.mstone": '"ignore"',
            "startup.homepage_welcome_url": '""',
            "datareporting.policy.dataSubmissionEnabled": "false",
            "toolkit.telemetry.reportingpolicy.firstRun": "false",
            "browser.shell.checkDefaultBrowser": "false",
            "browser.tabs.warnOnClose": "false",
            "browser.sessionstore.resume_from_crash": "false",
        }.items():
            f.write(f'user_pref("{k}", {v});\n')


def tobari_ext_profile(d, core_bin):
    nm = os.path.join(d, "NativeMessagingHosts")
    os.makedirs(nm, exist_ok=True)
    with open(os.path.join(nm, "dev.tobari.core.json"), "w") as f:
        json.dump({"name": "dev.tobari.core", "description": "bench", "path": core_bin, "type": "stdio", "allowed_origins": [f"chrome-extension://{EXT_ID}/"]}, f)


def launch(name, cmd, profile, urls, core_bin, extra):
    fam = BROWSERS[name]["family"]
    env = dict(os.environ)
    if fam == "firefox":
        firefox_profile(profile)
        argv = cmd + ["--no-remote", "--profile", profile] + (urls or ["about:blank"])
    else:
        flags = list(CHROMIUM_FLAGS) + list(extra)
        if fam == "tobari-ext":
            tobari_ext_profile(profile, core_bin)
            flags += [f"--disable-extensions-except={EXT}", f"--load-extension={EXT}"]
        argv = cmd + [f"--user-data-dir={profile}"] + flags + (urls or ["about:blank"])
    return subprocess.Popen(argv, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, start_new_session=True)


def stop(proc):
    try:
        os.killpg(proc.pid, signal.SIGTERM)
    except ProcessLookupError:
        return
    try:
        proc.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(proc.pid, signal.SIGKILL)
        proc.wait()
    time.sleep(2)


def machine():
    cpu = "unknown"
    try:
        with open("/proc/cpuinfo") as f:
            cpu = next(l.split(":", 1)[1].strip() for l in f if l.startswith("model name"))
    except Exception:
        pass
    mem = 0
    with open("/proc/meminfo") as f:
        mem = int(next(l for l in f if l.startswith("MemTotal")).split()[1]) // 1024
    osname = "unknown"
    try:
        with open("/etc/os-release") as f:
            osname = next(l.split("=", 1)[1].strip().strip('"') for l in f if l.startswith("PRETTY_NAME"))
    except Exception:
        pass
    session = f"{os.environ.get('XDG_SESSION_TYPE', 'no session')} {os.environ.get('XDG_CURRENT_DESKTOP', '')}".strip()
    return f"{cpu}, {mem} MiB RAM, {osname}, kernel {platform.release()}, {session}"


def main():
    ap = argparse.ArgumentParser(description="Measure browser memory as PSS summed over the whole process tree.")
    ap.add_argument("--browsers", default="tobari,firefox,zen,brave,chrome")
    ap.add_argument("--counts", default="0,5,10,25")
    ap.add_argument("--pages", default=os.path.join(HERE, "pages.txt"), help="file with one URL per line, or 'local' for the bundled corpus")
    ap.add_argument("--settle", type=float, default=25.0, help="seconds to wait after launch before sampling")
    ap.add_argument("--port", type=int, default=8766)
    ap.add_argument("--bin", action="append", default=[], help="override a launcher, e.g. chromium=/opt/pw-browsers/chromium/chrome")
    ap.add_argument("--discard", action="store_true", help="for tobari-ext: also measure after putting background tabs to sleep")
    ap.add_argument("--core", default=os.path.join(REPO, "core", "target", "release", "tobari"))
    ap.add_argument("--out", default=os.path.join(REPO, "docs", "bench.md"))
    ap.add_argument("--label", default="", help="free text added to the report heading")
    ap.add_argument("--extra", action="append", default=[], help="extra flag for Chromium-family browsers, e.g. --extra=--no-sandbox when running as root")
    args = ap.parse_args()

    overrides = dict(b.split("=", 1) for b in args.bin)
    srv = serve_corpus(args.port) if args.pages == "local" else None
    pages = page_list(args)
    counts = [int(c) for c in args.counts.split(",")]
    if max(counts) > len(pages):
        sys.exit(f"need {max(counts)} pages, {args.pages} has {len(pages)}")
    if "tobari-ext" in args.browsers and not os.path.isfile(args.core):
        alt = os.path.join(REPO, "core", "target", "debug", "tobari")
        args.core = alt if os.path.isfile(alt) else args.core

    rows, notes, raw = [], [], []
    for name in [b.strip() for b in args.browsers.split(",") if b.strip()]:
        cmd = find_launcher(name, overrides.get(name))
        if not cmd:
            notes.append(f"{name}: not installed, skipped")
            print(f"skip {name}: not found", file=sys.stderr)
            continue
        ver = version_of(cmd)
        for n in counts:
            profile = tempfile.mkdtemp(prefix=f"bench-{name}-")
            env_runtime = tempfile.mkdtemp(prefix="bench-run-")
            os.environ["XDG_RUNTIME_DIR"] = env_runtime
            proc = launch(name, cmd, profile, pages[:n], args.core, args.extra)
            time.sleep(args.settle)
            if proc.poll() is not None and BROWSERS[name]["family"] != "firefox":
                notes.append(f"{name} exited early at {n} tabs (code {proc.returncode})")
                continue
            kib, procs, by_comm = measure(proc.pid)
            rows.append((name, ver, n, "", kib, procs))
            raw.append({"browser": name, "version": ver, "tabs": n, "pss_kib": kib, "processes": procs, "by_process": by_comm})
            print(f"{name:<11} {n:>3} tabs  {kib / 1024:8.1f} MiB  {procs} processes", file=sys.stderr)
            if args.discard and name == "tobari-ext" and n > 1:
                tob = args.core
                r = subprocess.run([tob, "--json", "sleep"], capture_output=True, text=True, env=dict(os.environ), timeout=30)
                time.sleep(8)
                kib2, procs2, by2 = measure(proc.pid)
                rows.append((name, ver, n, "background tabs asleep", kib2, procs2))
                raw.append({"browser": name, "version": ver, "tabs": n, "variant": "asleep", "pss_kib": kib2, "processes": procs2, "by_process": by2, "sleep_output": r.stdout.strip() or r.stderr.strip()})
                print(f"{name:<11} {n:>3} tabs  {kib2 / 1024:8.1f} MiB  after sleep: {r.stdout.strip() or r.stderr.strip()}", file=sys.stderr)
            stop(proc)
            shutil.rmtree(profile, ignore_errors=True)
            shutil.rmtree(env_runtime, ignore_errors=True)
    if srv:
        srv.shutdown()

    stamp = datetime.datetime.now().strftime("%Y-%m-%d %H:%M")
    src = "bundled local corpus (bench/corpus, 25 static pages)" if args.pages == "local" else f"`{os.path.relpath(args.pages, REPO)}`"
    lines = [
        f"## {stamp}{' · ' + args.label if args.label else ''}",
        "",
        f"Machine: {machine()}",
        f"Pages: {src}. Settle time {args.settle:.0f} s, median of 3 samples 2 s apart. PSS summed over the browser's whole process tree.",
        "",
        "| Browser | Version | Tabs | Variant | PSS (MiB) | Processes |",
        "|---|---|---:|---|---:|---:|",
    ]
    for name, ver, n, variant, kib, procs in rows:
        lines.append(f"| {name} | {ver} | {n} | {variant} | {kib / 1024:.0f} | {procs} |")
    if notes:
        lines.append("")
    for note in notes:
        lines.append(f"- {note}")
    lines.append("")
    block = "\n".join(lines)
    os.makedirs(os.path.dirname(args.out), exist_ok=True)
    header = "# Memory benchmark\n\nProduced by `bench/run.py`. Every number below comes from a run of that script; nothing is estimated.\n\n"
    old = ""
    if os.path.exists(args.out):
        with open(args.out) as f:
            old = f.read()
        if old.startswith("# Memory benchmark"):
            old = old.split("\n\n", 2)[2] if old.count("\n\n") >= 2 else ""
    with open(args.out, "w") as f:
        f.write(header + block + "\n" + old)
    rawdir = os.path.join(HERE, "results", "raw")
    os.makedirs(rawdir, exist_ok=True)
    with open(os.path.join(rawdir, f"{datetime.datetime.now():%Y%m%d-%H%M%S}.json"), "w") as f:
        json.dump({"machine": machine(), "date": stamp, "pages": args.pages, "runs": raw}, f, indent=1)
    print(block)


if __name__ == "__main__":
    main()
