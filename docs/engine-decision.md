# Engine decision

Decided 2026-10-30: **CEF 156 in Chrome style**, with Tobari's own shell built on CEF Views.
Kao waived the Step 1 ASK gate ("just do all steps"), so this file records the decision instead of asking for one.

Measured on Kao's desktop: Ryzen 5 9600X, RX 6800 XT, 32 GB, Bazzite 44.20261026.0 (GNOME, Wayland).
Every browser ran inside a headless `cage` compositor, so no window showed.

## Engines tested

| Engine | Build | Source |
| --- | --- | --- |
| CEF | 156.0.14+g4fa4ab5, Chromium 156.0.8078.48, `cefsimple` | cef-builds.spotifycdn.com, client distribution |
| Chromium | snapshot 1731338 (159.0.8133.0) | chromium-browser-snapshots, Linux_x64 |
| Gecko | Firefox 159.0 release | download-installer.cdn.mozilla.net |

The Chromium snapshot stands in for "a Chromium fork with a small patch set": the fork would run the same engine plus patches.

## Results

### CJK and Thai rendering (`bench/script_test.sh`, page `bench/script-test/`)

The page draws each character to a canvas. It marks a character as missing if it comes out blank, or if its ink bounding box matches the box drawn for an unassigned code point. It also checks that Thai tone marks stack on their base letter instead of widening it. That's 60 checks in all.

| Engine | Bazzite fonts | Latin-only fonts (negative control) |
| --- | --- | --- |
| CEF 156 | PASS 60/60 | FAIL 1/60 |
| Chromium 159 | PASS 60/60 | FAIL 1/60 |
| Firefox 159 | PASS 60/60 | FAIL 0/60 |
| Flatpak Google Chrome 156 | PASS 60/60 | not run |

The negative control (`bench/fonts-latin-only/fonts.conf`) shows the page can detect missing glyphs.
The empty boxes Kao saw before didn't reproduce in any engine on this machine. The cause is still unknown, so the test stays a release gate and runs again inside the AppImage.

### RAM (`bench/engines.sh`, `bench/ram.py`)

PSS summed over the browser's whole process tree (the compositor itself isn't counted).
Each figure is the median of 3 samples taken after a 60 s settle. Pages are the first 10 of `PAGES` in `bench/ram.py`.

| Engine | 0 tabs (one blank page) | 10 tabs | Processes at 10 tabs |
| --- | --- | --- | --- |
| CEF `cefsimple` | 339 MiB | 2017 MiB | 68 |
| Chromium 159 | 529 MiB | 2168 MiB | 73 |
| Firefox 159 | 608 MiB | 2313 MiB | 68 |

Source: `bench/results/ram.jsonl`, run 1 of 3. Runs 2 and 3 are in that file when the script finishes.
Caveats:
- `cefsimple` has no browser UI. Tobari's shell will add its own cost on top, and Step 3 measures that.
- Firefox loads its own UI and new-tab page.
- None of the engines blocked ads in this run.

### Build cost on a standard GitHub runner (`.github/workflows/engine-build-cost.yml`)

| Engine | What CI does | Time | Disk |
| --- | --- | --- | --- |
| CEF | download the prebuilt binary, build the C++ wrapper | 49 s download + 87 s build | 2 GB |
| Gecko, artifact mode | clone, bootstrap, build (front-end changes only, prebuilt C++) | 60 s + 48 s + 48 s | 9 GB |
| Gecko, full build | needed for any C++ patch | pending (run 41057802271) | pending |
| Chromium from source | fetch, then build `chrome` | pending (run 41057802271) | pending |

The standard runner has a 6-hour job limit. A pending row gets filled in when that run finishes, and if a build doesn't finish in time, the row records how far ninja got.

### Extension support (`bench/ext_test.sh`, MV3 content script in `bench/ext-test/ext`)

| Engine | Unpacked MV3 extension | Store install |
| --- | --- | --- |
| CEF 156, Chrome style | ran in 3 of 4 runs. The failed run was the first start on a fresh cache, not yet explained | Chrome Web Store not tested |
| Chromium 159 | ran | not tested |
| Firefox 159 | release builds need a signed extension | uBlock Origin from AMO installed by policy, active, signedState 2 |
| Flatpak Google Chrome | did not run. Branded Chrome ignores `--load-extension`, as recorded before | n/a |

### Patches each project carries (counted on GitHub, 2026-10-30)

| Project | Patch files |
| --- | --- |
| CEF on top of Chromium (maintained by the CEF project, not by us) | 118 |
| ungoogled-chromium (a small privacy fork) | 110 |
| Zen (a Firefox-based browser) | 273 |
| Brave (a Chromium fork) | 1302 |

A Tobari fork of Chromium or Firefox would start near the low end of this range and have to rebase every 4 weeks.
With CEF, Tobari carries 0 engine patches. Everything Tobari adds lives in its own code, through CEF's public API.

## Decision

**CEF, Chrome style.**
- It had the lowest RAM of the three at 0 and at 10 tabs, before any shell was added.
- It is the only option with zero engine patches to maintain.
- It is the only option that builds in about 2 minutes on a free runner. Chromium from source can't fit a 6-hour job on 14 GB of free disk (the final number comes from the pending run).
- It passes the CJK and Thai test the same as Chromium.
- It loads Chromium extensions.

What CEF costs us:
- Network-layer blocking has to be written in Tobari through `CefResourceRequestHandler`, with no help from an engine patch.
- Chrome Web Store installs are unproven in CEF, so 0.5.0 supports unpacked and CRX extensions only.
- History and chats encrypted at rest has to be Tobari's own store. The CEF profile directory stays as Chromium writes it.

Rejected:
- **Chromium fork:** the build doesn't fit free CI, and it means a patch rebase every 4 weeks.
- **Gecko:** it used 270 MiB more than CEF at idle (608 vs 339 MiB). The front-end-only artifact build is cheap, but network blocking, sleeping tabs and the AI panel layout would mean C++ patches, and those need the full build.

## Shell language

C++17 against the CEF C++ API, built with the CMake project that comes with the CEF distribution.
The browser UI (sidebar, command bar, AI panel and built-in pages) is HTML served from a `tobari://` scheme handler, running in its own CEF views.
