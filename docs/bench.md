# Memory benchmark

Produced by `bench/run.py`. Every number below comes from a run of that script; nothing is estimated.

## 2026-10-30 06:46 · cloud container smoke test, not target hardware

Machine: Intel(R) Xeon(R) Processor @ 2.10GHz, 16091 MiB RAM, Ubuntu 24.04.5 LTS, kernel 6.18.44-fc-v185, no session
Pages: bundled local corpus (bench/corpus, 25 static pages). Settle time 20 s, median of 3 samples 2 s apart. PSS summed over the browser's whole process tree.

| Browser | Version | Tabs | Variant | PSS (MiB) | Processes |
|---|---|---:|---|---:|---:|
| chromium | Google Chrome for Testing 153.0.8010.12 | 0 |  | 468 | 12 |
| chromium | Google Chrome for Testing 153.0.8010.12 | 5 |  | 549 | 16 |
| chromium | Google Chrome for Testing 153.0.8010.12 | 10 |  | 629 | 21 |
| chromium | Google Chrome for Testing 153.0.8010.12 | 25 |  | 869 | 36 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 0 |  | 484 | 14 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 5 |  | 569 | 18 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 5 | background tabs asleep | 534 | 16 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 10 |  | 655 | 23 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 10 | background tabs asleep | 615 | 21 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 25 |  | 894 | 38 |
| tobari-ext | Google Chrome for Testing 153.0.8010.12 | 25 | background tabs asleep | 840 | 36 |

