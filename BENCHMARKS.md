# BENCHMARKS

## Memory at 10 identical tabs

The measurement Phase 1 exists to produce: does a CEF shell with network-layer
blocking use less memory than stock Chrome at the same workload, and by enough
to matter?

### Method

`scripts/benchmark-ram.sh` opens the same ten pages in each browser, waits for
them to settle, and sums memory across every process the browser owns.

Ten pages, chosen to include ad-supported news alongside static documentation
so the blocking result is not flattered:

```
en.wikipedia.org/wiki/Wayland_(protocol)   github.com/chromiumembedded/cef
news.ycombinator.com                       developer.mozilla.org/en-US/docs/Web/CSS
theguardian.com/international              arstechnica.com
bbc.com/news                               stackoverflow.com/questions
archlinux.org                              kernel.org
```

**PSS is the headline number.** Proportional set size divides each shared page
between the processes mapping it, so a multi-process browser is counted once
rather than once per renderer. RSS is reported beside it because people expect
it, but RSS counts the shared Chromium libraries in every process and badly
over-states a browser with many renderers.

Both browsers were measured by taking a baseline of that browser's processes
before launch and subtracting it. This is what makes the run reproducible on a
machine where the user already has Chrome open — nothing has to be killed.

Settle: 45s after the last tab opens (Chrome given 25s extra for Flatpak
startup). Machine: Ryzen 5 9600X, 32 GB, Bazzite, Wayland, 2026-09-30.
Tobari on CEF 154.0.32 / Chromium 154.0.8037.58; Chrome from Flathub.

### Result

| configuration | processes | PSS | RSS |
|---|---:|---:|---:|
| Tobari, blocking on | 20 | **821.8 MB** | 2744.8 MB |
| Tobari, blocking off | 21 | 890.4 MB | 2912.9 MB |
| Google Chrome, stock | 45 | 933.2 MB | 5681.1 MB |

Tobari with blocking on, against stock Chrome:

- **111.4 MB less PSS — 11.9% lower**
- 2936 MB less RSS — 51.7% lower
- 25 fewer processes

Blocking's own contribution, Tobari on vs Tobari off:

- **68.6 MB less PSS — 7.7% lower**
- one fewer process

### What this does and does not show

The 7.7% from blocking is real but smaller than the theory suggests. The
argument for network-layer blocking is that a third-party subframe cancelled
before it loads is a renderer process never created; across these ten pages
that produced exactly **one** fewer process, not the handful expected. Most of
the saving came from ad and tracker resources never being fetched, parsed and
retained inside renderers that existed anyway. The renderer-elision effect is
real but it is not the dominant term at this tab count.

The 11.9% gap against Chrome is **not** all efficiency. Tobari currently has no
extension system, no sync, no Safe Browsing, and no translate or prefetch
machinery. Some of that gap is missing features rather than better engineering,
and it will narrow as Phase 1 finishes.

Two things bias the comparison, both against Tobari, so the figure above is
conservative:

- Chrome was measured by subtraction while the user's own Chrome was running.
  Shared pages divide across more processes when more Chrome processes exist,
  which lowers the measured PSS delta for the benchmark instance. Chrome's
  standalone cost is therefore somewhat higher than 933.2 MB.
- Chrome was given a longer settle, so more of its lazy work had completed.

This is a single run against live sites. Ad inventory and article length vary
between loads, so treat the numbers as one observation, not a distribution.
Re-run with `SETTLE=90 scripts/benchmark-ram.sh tobari|chrome`.

### Decision on Phase 2

Spec §6 starts the Chromium patch set only if Phase 1 shows a **specific, named
limit that CEF cannot get past**. It does not.

Tobari already runs 20 processes against Chrome's 45 and uses 11.9% less PSS
without patching anything, and the largest items on the Phase 2 list are things
CEF has already omitted — Safe Browsing infrastructure, sync, UMA. The
remaining lever with real headroom is the process model, and `--process-per-site`
weakens site isolation, which §3.3 and `SECURITY.md` forbid trading away by
default.

**Phase 2 is not justified by this measurement.** Revisit only if a named
workload shows CEF blocking a specific optimisation.
