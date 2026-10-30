# Phase 0 font probe

`cjk-thai.html` draws Japanese, Chinese, Korean, Thai and mixed text with 11 different
`font-family`/`lang` combinations and grades each row PASS or FAIL by comparing canvas pixels
against a codepoint no font covers. `probe.sh` runs it in one engine and writes `report.md`
with the fontconfig view, the verdicts, and an `strace -e openat` summary.

Checked in the cloud container on 2026-10-30 (Ubuntu 24.04, headless Chromium 153): 11/11 pass
with system fonts, 11/11 fail when fontconfig is limited to DejaVu Sans. Screenshots are in
`results/container-control/`. These are controls for the detector, not Bazzite results.

## Run on the Bazzite desktop

Flatpak apps run from the host. strace comes from the Flatpak SDK that matches the app's runtime,
installed per user, no sudo. The script prints the exact `flatpak install --user` line if it is missing.

```bash
cd ~/projects/tobari
```

```bash
phase0/probe.sh flatpak:com.google.Chrome
```

```bash
phase0/probe.sh flatpak:org.mozilla.firefox
```

CEF and Chromium run inside distrobox:

```bash
distrobox enter box -- sudo dnf install -y strace chromium
```

```bash
distrobox enter box -- phase0/probe.sh chromium /usr/bin/chromium-browser
```

```bash
distrobox enter box -- phase0/probe.sh chromium /path/to/cef_binary/Release/cefsimple
```

Each run writes `phase0/results/<host>-<engine>-<time>/report.md`. While the window is open, look
at the browser's own UI too (tab title says `帳 Tobari font probe`). Send back every `report.md`
and the `headless.png` files.
