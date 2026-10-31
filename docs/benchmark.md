# Benchmark: Tobari, Chromium and Firefox (2026-10-31)

Machine: x86_64, Linux 7.2.11-ogc4.1.fc44.x86_64. Made by `bench/compare.sh BIN` and `python3 bench/report.py`; the raw runs are in `bench/results/`.

| Browser | RAM, 1 blank tab | RAM, 10 real pages | Start to first rendered page |
| --- | --- | --- | --- |
| Tobari | 479 MiB | 1516 MiB | 329 ms |
| Chromium | 522 MiB | 2031 MiB | 352 ms |
| Firefox | 609 MiB | 2216 MiB | 798 ms |

How it's measured:
- RAM is PSS summed over the browser's whole process tree, 60 s after the pages are opened, median of 3 rounds of 3 samples. The 10 pages are Wikipedia (English, Japanese, Thai), GitHub, Hacker News, BBC News, YouTube, MDN, Reddit and Stack Overflow, so ads and trackers count: Tobari blocks them and the stock browsers don't.
- Start time runs from launch until a local CJK/Thai test page has rendered and reported its checks, median of 5 runs with a fresh profile and a warm disk cache. The first run after a build or boot is slower while files load from disk; every sample is in `bench/results/startup.jsonl`.
- Every browser runs in the same headless Wayland compositor (cage) on the GPU, with no window shown.
- Chromium and Firefox are the stock builds listed in `docs/engine-decision.md`, with no extensions.
