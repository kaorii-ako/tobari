# Changelog

There has been no release yet. Until there is, this file records the history
of `main` one commit at a time, newest first, in plain language. Each entry
names the commit it describes so it can be checked against `git log`.

Numbers quoted here are the ones recorded at the time; the current figures and
their caveats live in `BENCHMARKS.md`, `SECURITY.md` and `docs/DESIGN.md`.

## 2026-09-30 — Side panel in its own browser view (`51e790e`)

- The side panel used to live inside the 72px chrome document, so it was
  clipped to the top strip and showed up as a small box in the corner. It is
  now a second browser view docked to the right of the page, 320px wide, and
  hidden outright when closed so it costs no layout or paint.
- The panel has its own document and talks to the same IPC. Settings moved
  into it from the chrome menu.
- The omnibox dropdown stays in the chrome document and grows the strip while
  open, then returns to 72px. The reasoning is in `docs/DESIGN.md`.
- Fixed: bookmark titles and URLs in the panel were centred instead of
  left-aligned.

## 2026-09-30 — Persistence and the first RAM benchmark (`0737baa`)

- Bookmarks, history and the reading list are now saved as JSON under
  `$XDG_DATA_HOME/tobari/profiles/default/`, written atomically. History skips
  internal pages, collapses repeat visits and keeps at most 3000 entries.
  Bookmark with Ctrl+D or the star.
- Added `BENCHMARKS.md`. At ten identical tabs Tobari measured 821.8 MB PSS
  against stock Chrome's 933.2 MB (11.9% lower), with 20 processes against 45.
  Blocking accounts for 7.7 points of that. This is a single run, and part of
  the gap is features Tobari does not have yet.
- Recorded what the measurement did not show: blocking produced one fewer
  process across the ten pages, not several.
- On this result, the conditional Chromium patch set (Phase 2) is not
  justified.
- `TOBARI_NO_BLOCKING=1` starts the browser without the blocking engine.

## 2026-09-30 — Network-layer blocking and a frameless window (`5ec156e`)

- Added ad and tracker blocking with `adblock-rust`, linked into the browser
  and built by the same `cmake --build`. Requests are cancelled before they
  load. Pages you navigate to directly are never blocked.
- Ships EasyList, EasyPrivacy and uBlock Origin's filters and privacy lists:
  141,987 rules. `scripts/update-filters.sh` refreshes them with plain requests
  that carry no identifier, and records checksums.
- The omnibox shield shows how many requests were blocked on the current page
  and turns blocking off for that host.
- The window is frameless: the tab strip is the title bar, with the window
  controls at its right edge. About 40px of page height comes back.
- `TOBARI_LOG=info` sets log verbosity.

## 2026-09-30 — Visual system, new-tab page and idle-cost fixes (`e605c0e`)

- Replaced ad hoc styling with a written visual system (`docs/DESIGN.md`):
  one token file, IBM Plex Sans and Plex Mono bundled locally, a monochrome
  palette with one accent colour, and both themes checked against WCAG AA.
- Fixed three performance problems found by measurement: tab animations that
  forced layout on every tab event, an animation loop that ran even when
  nothing moved (idle CPU went from 8.00% to 0.50% of one core), and spinner
  animations left running on removed tabs.
- Smooth scrolling and the animated new-tab background are now off by default
  because both cost idle CPU.
- Added keyboard focus styles everywhere, a real tab list with arrow-key
  navigation, and proper combobox semantics on the omnibox.
- The new-tab page is a real page instead of `about:blank`.
- Fixed several bugs from an audit, including a toolbar that stayed dead after
  a renderer crash and a blocking toggle that did nothing.
- The chrome is 72px tall, down from 84px.

## 2026-09-22 — New phase order (`20c2e3b`)

- The project order changed: the browser comes first, the Chromium patch set
  second and only if needed, and the assistant last.
- Earlier prototype work that did not fit the new order was moved to a
  separate branch rather than deleted, and removed from `main` together with
  its CI.

## 2026-09-22 — Prototype fixes (`9c0b341`)

- Fixed a deadlock, an extension ID that could never match, and wrong offload
  reporting in the earlier prototype. This work now lives off `main`.

## 2026-09-21 — Prototype fixes (`8678ad8`)

- Fixed GPU memory detection and AppImage start-up in the earlier prototype.

## 2026-09-21 — Shell scaffold (`7fc1749`)

- First browser shell scaffold and a design proposal. Both were later
  replaced; the current visual system is `docs/DESIGN.md`.

## 2026-09-21 — First commit (`7010a5c`)

- Initial prototype, packaging scripts and CI.
