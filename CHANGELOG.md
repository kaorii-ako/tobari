# Changelog

There has been no release yet. Until there is, this file records the history
of `main` one commit at a time, newest first, in plain language. Each entry
names the commit it describes so it can be checked against `git log`.

Numbers quoted here are the ones recorded at the time; the current figures and
their caveats live in `BENCHMARKS.md`, `SECURITY.md` and `docs/DESIGN.md`.

## 2026-10-07 — 0.4.0: import from other browsers, tab groups, local AI

- **Import from another browser.** Toolbar menu → Import: cookies (so you stay
  signed in), bookmarks (into a "From Chrome"-style folder on the bookmarks
  bar), history and a list of your extensions with links to install them, from
  Chrome, Chromium, Brave, Edge, Vivaldi (native or Flatpak) or Firefox.
  Read-only: the other browser's files are copied and read, never changed.
  Cookie keys come from the keyring (Linux) or Keychain (macOS) only for the
  import. Passwords move through the other browser's CSV export; the page
  explains how.
- **Tab groups.** "Group tabs by site" in the toolbar menu, as a switch that
  groups new tabs as you open them, or once with Group now. Ungroup removes
  only the groups Tobari made.
- **Local AI.** Ask AI opens a side panel that summarizes the page or answers
  questions about it; Organize with AI sorts the window's tabs into groups by
  topic. Both run a Qwen3 model on this computer through llama.cpp's server
  (Vulkan on Linux, Metal on macOS), which starts on first use and stops after
  ten idle minutes. `tobari://ai` downloads a model (0.6B, 4B or 30B-A3B),
  checks it against a pinned SHA-256, and switches or deletes models. Nothing
  is downloaded until you choose. Threat model in SECURITY.md.

## 2026-10-04 — 0.3.0: setup in its own window, `tobari://` pages

- **Setup opens in its own window** over the browser, not as a tab: a
  frameless window with its own title bar and close button (so it looks and
  moves the same on GNOME, KDE and macOS), grouped under Tobari in the dock.
  Closing it keeps what was chosen.
- **Search engine logos** on the engine step, bundled with the browser.
- **`tobari://` pages**, like `chrome://`: `tobari://welcome` (setup),
  `tobari://about` (versions, data folder, every Tobari page),
  `tobari://blocking` (counts, filter lists with an update button, sites with
  blocking off and a button to turn it back on) and `tobari://bangs`. Typing
  them in the address bar works; websites cannot open, frame or fetch them.

## 2026-10-04 — 0.2.0: welcome flow, AppImage, macOS

- **First-run welcome.** A new profile opens a short setup sheet: search
  engine (DuckDuckGo, Brave Search, Startpage, Kagi, Ecosia, Google, Bing),
  appearance (system, light or dark, six accents, previewed live), and privacy
  choices (suggestions, reopening tabs, fast JavaScript everywhere). Choices
  are Chromium's own settings, applied as they are made. Setup reopens from the
  toolbar popup or the new tab.
- Fixed while building it: choosing an engine Chromium also ships (Brave) left
  the browser with no default search engine, because the keyword collided with
  the built-in entry; built-in engines are now referenced by their Chromium ID.
  The new tab's search box searched DuckDuckGo regardless of the default; it
  now uses the default engine. Finishing setup by navigating to the new tab was
  refused by Chromium (cross-extension navigation); a browser-created tab is
  used instead.
- **AppImage.** Portable, refuses to start without user namespaces, and adds
  itself to the app menu on first launch so the dock shows its name and icon.
  `install.sh --appimage` installs it.
- **macOS (Apple silicon, preview).** `Tobari.app` built, ad-hoc signed,
  launched and smoke-tested on GitHub's macOS runners; the installer installs
  it into `~/Applications`. Not notarized, not yet used day to day on a Mac.

## 2026-10-02 — Installer, website, re-measured (`0047328`, `20deb5a`, `9e72461`, `1924ab1`)

- **One-line installer.** `curl -fsSL https://kaorii-ako.github.io/tobari/install.sh | bash`
  installs the Flatpak or a per-user build for the current user, after
  checking the release's minisign signature (with minisign or plain OpenSSL 3)
  and the artifact's checksum. Tested against tampered artifacts, a tampered
  checksum list and a foreign key: all refused. `packaging/release.sh` builds
  and signs a release.
- **Website on GitHub Pages**, rebuilt around the product: real screenshots, a
  live bang demo running the new-tab page's own resolver, an install page, a
  FAQ. The installer and the release key are served from the repository's own
  copies.
- **Memory re-measured** on CEF 154.0.33 with the hardened defaults: 861.1 MB
  median PSS against Chrome's 1,219.6 MB (29.4% lower), 20 processes against
  69.
- Fixed: the toolbar popup's list age wrapped onto two lines.

## 2026-10-02 — Extensions keep updating (`131e40d`)

- Web Store extensions were never updated: the usual
  `--disable-background-networking` switch also stops Chromium's extension
  updater, which an 8-minute network log confirmed. The switch is gone; the
  services it covered that phone home were already handled individually.
- Without it, Chromium installed extensions that Linux packages register
  system-wide, downloaded from Google without asking (GNOME Shell integration
  on Fedora). Tobari now blocks external extensions; one already installed is
  removed at the next launch.
- A fresh profile left idle for 10 minutes still sends only the four
  filter-list downloads.

## 2026-10-02 — Security audit fixes (`43905ba`)

An adversarial review of the whole tree found no critical or high issues and
four medium ones. Every finding was fixed or documented:

- Requests made by service and shared workers skipped the blocker, because
  they have no tab. They now go through it; a test worker's tracker fetches
  are cancelled.
- Any web page could tell it was running in Tobari by probing
  `tobari.internal`. Those requests now fail like an unknown host.
- Unpacked extensions were loaded from the user's data directory, which let
  any program running as the user plant one. Only the bundled extensions load
  that way now.
- Filter-list downloads are capped at 16 MB, refuse redirects and reject a
  list that triples in size; a list the engine cannot load falls back to the
  bundled copies.
- The **Fast JavaScript** switch in the toolbar popup gives one site the V8
  optimizer back. It is keyed on the site Chromium uses for process decisions
  (registrable domain, no port): an exception keyed on the full origin was
  stored but never matched, which the first measurement showed.
- Smaller fixes: blocker calls serialized (adblock-rust is single-threaded), a
  launch URL can no longer land in a page's popup, command-line URLs limited to
  http, https and file, IPv6 hosts handled, state files fsynced.
- CI: actions pinned to commits, the CEF archive re-verified on every run,
  `cargo --locked`, and the engine watch fails when it crashes instead of
  passing.

## 2026-10-02 — CEF 154.0.33 and hardened defaults (`83268f6`)

- The engine moves to CEF 154.0.33 (Chromium 154.0.8037.94), which carries the
  32 security fixes from Chrome 154.0.8037.92, one Critical. It was published
  on 2026-10-02 and closes the gap SECURITY.md had recorded as open.
- New defaults, also applied to existing profiles unless the user already set
  them: the V8 optimizing compilers are blocked (most exploited V8 bugs live
  there; heavy JavaScript runs about 2× slower), HTTPS-Only mode is on, and USB,
  serial, HID, Bluetooth, sensors, local fonts and idle detection are blocked.
- Defaults that fail to apply are retried on the next launch.

## 2026-10-02 — Flatpak from source (`251d51e`)

- `packaging/flatpak/dev.tobari.Browser.source.yml` builds Tobari from source
  offline, with the blocker's crates vendored, as Flathub requires. It
  installs next to the prebuilt package and runs with the sandbox on.

## 2026-10-01 — Site brought up to date (`84a418a`)

- The landing, download and roadmap pages describe the Chrome-style browser.
  The engine version and the engine-currency table are read from the source at
  build time, and the build fails if a figure on the landing page no longer
  appears in the document it cites.

## 2026-10-01 — Packaging and measured privacy fixes (`98ef4a6`)

- Flatpak (zypak built from source) and a per-user installer. The binary had
  only run from its own directory; its library path is now relative to itself.
- A second launch opens its URL as a tab in the existing window.
- An idle network log showed Chromium still contacting Google (component
  updater, network time, account check) despite the usual switches. Those are
  now sent to a closed local port or disabled; only the four filter lists leave
  the machine.
- Benchmarks re-run three times interleaved: 905.9 MB median PSS against
  Chrome's 1,285.4 MB, 20 processes against 66.

## 2026-10-01 — Native Chrome-style window (`2f2c141`)

- CEF refuses a second Chrome-style browser view in a window for its whole
  lifetime, so custom HTML chrome, real tabs and Chrome extensions cannot
  coexist. Tobari now uses Chromium's own window: tabs in the title bar,
  extensions, and the Chrome Web Store.
- Blocking, bangs, first-run defaults, the dark theme and the hidden Google
  surfaces all live underneath Chromium's UI. The new-tab page and the
  blocking control are bundled extensions; the control reaches native code
  through `https://tobari.internal/`, answered only for that extension.
- Filter lists update weekly through an isolated request context.
- Fixed "stack smashing detected" aborting every subprocess on exit.

## 2026-10-01 — Static site and this changelog (`df1d3a3`)

- `site/` builds a static site with no trackers, cookies or third-party
  requests, and fails the build on inline scripts, foreign resources or broken
  links.

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
