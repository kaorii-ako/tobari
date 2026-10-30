"""PSS summed over a browser's whole process tree, at N open tabs.

Usage: python3 bench/ram.py NAME TABS [--popups] -- CMD...
  CMD gets the URLs appended (one per tab). With --popups it instead gets one
  launcher page that opens the rest with window.open (for shells like cefsimple
  that take a single URL; they need popup blocking off).
Runs in a headless cage on the GPU (WLR_RENDERER=gles2) so no window shows.
Prints and appends one JSON line to bench/results/ram.jsonl.
"""
import json, os, pathlib, subprocess, sys, tempfile, time, urllib.parse

PAGES = [
    "https://en.wikipedia.org/wiki/Linux",
    "https://ja.wikipedia.org/wiki/%E6%97%A5%E6%9C%AC%E8%AA%9E",
    "https://th.wikipedia.org/wiki/%E0%B8%A0%E0%B8%B2%E0%B8%A9%E0%B8%B2%E0%B9%84%E0%B8%97%E0%B8%A2",
    "https://github.com/torvalds/linux",
    "https://news.ycombinator.com/",
    "https://www.bbc.com/news",
    "https://www.youtube.com/",
    "https://developer.mozilla.org/en-US/",
    "https://www.reddit.com/r/linux/",
    "https://stackoverflow.com/questions",
]
SETTLE, SAMPLES, GAP = 60, 3, 5


def tree(root):
    kids = {}
    for p in pathlib.Path("/proc").iterdir():
        if p.name.isdigit():
            try:
                ppid = int((p / "stat").read_text().rsplit(")", 1)[1].split()[1])
                kids.setdefault(ppid, []).append(int(p.name))
            except (OSError, IndexError):
                pass
    out, todo = [], [root]
    while todo:
        pid = todo.pop()
        out.append(pid)
        todo += kids.get(pid, [])
    return out


def pss_kib(pid):
    try:
        for line in open(f"/proc/{pid}/smaps_rollup"):
            if line.startswith("Pss:"):
                return int(line.split()[1])
    except OSError:
        pass
    return 0


def is_content(pid):
    try:
        args = open(f"/proc/{pid}/cmdline", "rb").read()  # Chromium rewrites argv into one string
    except OSError:
        return False
    return b"--type=renderer" in args or b"\0tab" in args or b" tab" in args  # Firefox content: "-contentproc ... tab"


def main():
    name, tabs = sys.argv[1], int(sys.argv[2])
    popups = "--popups" in sys.argv
    cmd = sys.argv[sys.argv.index("--") + 1:]
    urls = PAGES[:tabs]
    tmp = None
    if popups and tabs:
        tmp = tempfile.NamedTemporaryFile("w", suffix=".html", delete=False)
        tmp.write("<script>" + "".join(f"window.open({json.dumps(u)});" for u in urls[1:])
                  + f"location={json.dumps(urls[0])}</script>")
        tmp.close()
        urls = ["file://" + tmp.name]
    if not urls:
        urls = ["about:blank"]
    env = dict(os.environ, WLR_BACKENDS="headless", WLR_RENDERER="gles2", WLR_LIBINPUT_NO_DEVICES="1")
    proc = subprocess.Popen(["cage", "--", *cmd, *urls], env=env,
                            stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    try:
        time.sleep(SETTLE)
        samples = []
        for _ in range(SAMPLES):
            # The compositor is harness, not browser: count only its children.
            pids = [p for p in tree(proc.pid) if p != proc.pid]
            renderers = sum(is_content(p) for p in pids)
            samples.append((sum(map(pss_kib, pids)), len(pids), renderers))
            time.sleep(GAP)
    finally:
        proc.terminate()
        try:
            proc.wait(10)
        except subprocess.TimeoutExpired:
            proc.kill()
        if tmp:
            os.unlink(tmp.name)
    samples.sort()
    kib, nproc, renderers = samples[len(samples) // 2]
    row = {"name": name, "tabs": tabs, "pss_mib": round(kib / 1024), "processes": nproc, "content_processes": renderers,
           "date": time.strftime("%Y-%m-%d"), "samples_mib": [round(s[0] / 1024) for s in samples]}
    print(json.dumps(row))
    res = pathlib.Path(__file__).parent / "results"
    res.mkdir(exist_ok=True)
    with open(res / "ram.jsonl", "a") as f:
        f.write(json.dumps(row) + "\n")


if __name__ == "__main__":
    main()
