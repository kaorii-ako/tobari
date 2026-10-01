# BENCHMARKS

## Memory at 10 identical tabs

Does Tobari use less memory than stock Chrome at the same workload, and how
much of the difference is the blocker?

### Method

`scripts/benchmark-ram.sh` opens the same ten pages in a browser on a **fresh,
throwaway profile**, waits 45 seconds for them to settle, and sums memory
across every process that browser owns.

```
en.wikipedia.org/wiki/Wayland_(protocol)   github.com/chromiumembedded/cef
news.ycombinator.com                       developer.mozilla.org/en-US/docs/Web/CSS
theguardian.com/international              arstechnica.com
bbc.com/news                               stackoverflow.com/questions
archlinux.org                              kernel.org
```

Ad-supported news sits beside static documentation so the blocking result is
not flattered.

**PSS is the headline number.** Proportional set size divides each shared page
between the processes that map it, so a multi-process browser is counted once,
not once per renderer. RSS is shown alongside but over-counts the shared
Chromium libraries in every process.

Each browser is measured by taking a baseline of its own processes before
launch and subtracting it. This makes the run correct on a machine where Chrome
is already open, and nothing has to be killed. (Chrome from Flathub reparents
through `bwrap`, so walking the process tree from the launched PID does not
find its renderers.)

**Three runs per configuration, interleaved** — Tobari on, Tobari off, Chrome,
then again — because live pages change between loads. A single run is not
enough: across two days the same Chrome configuration measured 933 MB and
1,292 MB.

Machine: Ryzen 5 9600X, 32 GB, Bazzite, Wayland. 2026-10-01. Tobari on CEF
154.0.32 (Chromium 154.0.8037.58); Chrome 154.0.8037.92 from Flathub.

### Result

| configuration | PSS run 1 / 2 / 3 | **median PSS** | processes | median RSS |
|---|---|---:|---|---:|
| Tobari, blocking on | 866.1 / 917.5 / 905.9 MB | **905.9 MB** | 20 / 20 / 20 | 2,823.6 MB |
| Tobari, blocking off | 1,106.4 / 1,069.4 / 1,113.1 MB | 1,106.4 MB | 34 / 33 / 34 | 4,427.4 MB |
| Google Chrome, stock | 1,291.6 / 1,017.2 / 1,285.4 MB | 1,285.4 MB | 69 / 66 / 66 | 7,971.5 MB |

Tobari, blocking on, against stock Chrome (medians):

- **379.5 MB less PSS — 29.5% lower**
- **20 processes against 66**

A bound that does not depend on medians: Tobari's **worst** run (917.5 MB) is
still 9.8% below Chrome's **best** (1,017.2 MB).

The blocker's own contribution, on against off (medians):

- **200.5 MB less PSS — 18.1% lower**
- **14 fewer processes** (34 → 20)

### What this does and does not show

**Blocking is where the processes go.** A third-party subframe cancelled before
it loads is a renderer that is never created; here that removed 14 of them.
An earlier single-run measurement found only one, on a different day's ad
inventory — the effect is real but varies a great deal with what the pages
happen to be serving, which is why three runs are reported.

**Not all of the gap is efficiency.** Even with blocking off, Tobari is 13.9%
below Chrome and runs about half the processes. Part of that is Tobari's
defaults doing their job — no network prediction means no speculative
renderers for pages you did not open — and part is that Chrome runs services
Tobari does not: Safe Browsing, sync, the Google account integration,
optimisation hints and on-device model services. That second part is a
difference in features, not engineering, and SECURITY.md says what Tobari
gives up.

**Two things bias the Chrome numbers downward**, so the comparison is
conservative: Chrome was measured by subtraction while another Chrome was open,
which spreads shared pages across more processes and lowers the measured delta;
and Chrome was given longer to settle.

Tobari carries two small bundled extensions (the new-tab page and the blocking
control); their cost is included in every Tobari figure above.

### History

An earlier version of Tobari drew its own interface in HTML on CEF's Alloy
runtime. It measured 821.8 MB PSS in a single run against Chrome's 933.2 MB on
2026-09-30, and was replaced because that runtime cannot host Chrome extensions
(`docs/DESIGN.md`). Chromium's own interface costs more than the HTML chrome
did; the single-run numbers are not comparable with the medians above.

### Reproduce

```sh
TOBARI_BUILD=~/.cache/tobari-dev/build scripts/benchmark-ram.sh tobari
TOBARI_BUILD=~/.cache/tobari-dev/build TOBARI_NO_BLOCKING=1 scripts/benchmark-ram.sh tobari
scripts/benchmark-ram.sh chrome
SETTLE=90 scripts/benchmark-ram.sh chrome   # longer settle
```

### Decision on Phase 2

Phase 2 — a Chromium patch set — starts only if a measurement shows a
**specific, named limit CEF cannot get past**. Memory does not show one: Tobari
already runs under a third of Chrome's processes and 29.5% less PSS on CEF
unpatched.

The engine-currency gap in SECURITY.md is the stronger argument for owning a
Chromium build, because it would let Tobari ship a Chromium security release
without waiting for CEF. It is a different cost: a 4–8 hour build on six cores
and a rebase every four weeks, indefinitely. It is recorded as the open
question for Phase 2, not decided here.
