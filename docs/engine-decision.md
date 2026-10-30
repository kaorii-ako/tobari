# Engine decision

Status: B picked by Kao on 2026-10-30 ("whatever works best"), pending the Bazzite probe.
Exit condition: if `phase0/probe.sh` shows the Japanese tofu bug comes from Chromium itself
(both Flatpak Chrome and a stock CEF sample fail while Firefox passes on the same host, and
the strace shows the CJK file never opened or failing), switch to C before Phase 1 ships.

## What is measured so far

| | Where | Result |
|---|---|---|
| Probe page, real fonts | cloud container, headless Chromium 153 | 11/11 PASS |
| Probe page, Latin-only fontconfig | same | 11/11 FAIL (detector works) |
| Bazzite: Flatpak Chrome | desktop | not run yet |
| Bazzite: Flatpak Firefox | desktop | not run yet |
| Bazzite: stock CEF sample (Chrome style) | distrobox | not run yet |
| Bazzite: Chromium | distrobox | not run yet |

Kao's earlier observation (not yet reproduced with the probe): Flatpak Chrome and the v1 CEF build
showed boxes for Japanese, including Chrome's own UI; Flatpak Firefox rendered it. fontconfig on the
host resolves Noto Sans CJK JP correctly.

A point worth checking first: Firefox on Bazzite is also a Flatpak, so it sees the same
`/run/host/fonts` mapping as Flatpak Chrome. If Firefox passes and Chrome fails under the same
sandbox, the fault is in how Chromium uses fontconfig, not in which files the sandbox exposes.
The probe's `fc-match` section (run through each app's own sandbox) and the strace counts will
show which.

## Comparison

Numbers marked "upstream" come from each project's published build docs, not from this hardware.
Rows marked "to measure" need the Bazzite desktop.

| | A. Chromium + patches | B. CEF, Chrome style | C. Gecko fork |
|---|---|---|---|
| Build from source | upstream: 100 GB+ disk, hours | not needed: prebuilt CEF from the Spotify CDN | upstream: ~40 GB, 1 to 2 h on 6 cores |
| Download to start | n/a | to measure (minimal dist) | n/a |
| Chrome extensions | yes | yes in Chrome style (Alloy cannot host them: v1 blocker) | WebExtensions, Firefox add-ons only |
| Chrome profile import parity | full | via tobari-core reading profile files | via tobari-core |
| CJK on Bazzite | to measure (Flatpak Chrome failed before) | to measure (v1 CEF failed before) | Firefox passes per Kao |
| RAM idle / 10 tabs | to measure with bench/ | to measure with bench/ | to measure with bench/ |
| Patches to carry | high: rebase on every Chromium milestone | none in the engine; app code against the CEF API | medium: Zen-style UI patches rebased per Firefox release |
| Builds in the cloud session | no (disk) | yes once cef-builds.spotifycdn.com is allowed | no (disk, Mozilla hosts blocked) |

## Why B

- Same engine family as Tabbit, so Chrome extensions and the Chrome Web Store work.
- Zero engine patches. Tobari is a thin CEF host plus a bundled extension and a Rust core, so a
  Chromium update means bumping the CEF version, not rebasing a patch set.
- The bundled extension also runs in stock Chromium or Brave, which gives a working Tobari on
  Bazzite before the shell is packaged.

## Risks

- The tofu bug. It hit two Chromium builds on this machine and the cause is unknown. B inherits it
  if it is Chromium-wide. This is the exit condition above.
- `--load-extension` is disabled in branded Google Chrome since 137. CEF is not branded Chrome, but
  the shell should load the bundled extension through `CefRequestContext::LoadExtension` or the
  extensions directory, not depend on the switch. To verify with a real CEF build.
- RAM. Chromium usually uses more than Gecko at high tab counts. Tab discarding and the sidecar idle
  unload are the levers; bench/ measures them.
