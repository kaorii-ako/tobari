"""Write docs/benchmark.md from the newest dated runs in bench/results/{ram,startup}.jsonl.

Usage: python3 bench/report.py [DATE]  (DATE defaults to the newest one with a tobari run)
"""
import collections, json, pathlib, platform, statistics, sys

R = pathlib.Path(__file__).parent / "results"
rows = lambda f: [json.loads(l) for l in open(R / f) if l.strip()]
ram, start = rows("ram.jsonl"), rows("startup.jsonl")
date = sys.argv[1] if len(sys.argv) > 1 else max(r["name"][7:] for r in ram if r["name"].startswith("tobari-2"))
names = ["tobari", "chromium", "firefox"]

pss = collections.defaultdict(list)
for r in ram:
    if r["name"].endswith(date):
        pss[(r["name"][: -len(date) - 1], r["tabs"])].append(r["pss_mib"])
ms = {r["name"][: -len(date) - 1]: r for r in start if r["name"].endswith(date)}
med = lambda v: round(statistics.median(v)) if v else None
cell = lambda v, unit: f"{v} {unit}" if v is not None else "not measured"

out = [f"# Benchmark: Tobari, Chromium and Firefox ({date})", "",
       f"Machine: {platform.processor() or platform.machine()}, Linux {platform.release()}. "
       "Made by `bench/compare.sh BIN` and `python3 bench/report.py`; the raw runs are in `bench/results/`.", "",
       "| Browser | RAM, 1 blank tab | RAM, 10 real pages | Start to first rendered page |", "| --- | --- | --- | --- |"]
for n in names:
    out.append(f"| {n.capitalize()} | {cell(med(pss[(n, 0)]), 'MiB')} | {cell(med(pss[(n, 10)]), 'MiB')} | "
               f"{cell(ms[n]['median_ms'] if n in ms else None, 'ms')} |")
out += ["", "How it's measured:",
        "- RAM is PSS summed over the browser's whole process tree, 60 s after the pages are opened, median of 3 rounds "
        "of 3 samples. The 10 pages are Wikipedia (English, Japanese, Thai), GitHub, Hacker News, BBC News, YouTube, "
        "MDN, Reddit and Stack Overflow, so ads and trackers count: Tobari blocks them and the stock browsers don't.",
        "- Start time runs from launch until a local CJK/Thai test page has rendered and reported its checks, median of "
        "5 runs with a fresh profile and a warm disk cache.",
        "- Every browser runs in the same headless Wayland compositor (cage) on the GPU, with no window shown.",
        "- Chromium and Firefox are the stock builds listed in `docs/engine-decision.md`, with no extensions."]
(pathlib.Path(__file__).parent.parent / "docs/benchmark.md").write_text("\n".join(out) + "\n")
print("\n".join(out[4:8]))
