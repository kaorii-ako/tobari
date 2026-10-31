# Tobari rewrite: handoff

Updated 2026-10-31. Current step: **Step 4 (assistant, import, CLI) is done. Next is Step 5 (benchmark), then Step 6 (0.5.0 release).**

## Done
- **Step 0:** the archive tags `archive/browser-0.4.0` (893ad36) and `archive/v2-extension` (c44e407) are pushed. The orphan branch `rewrite` is created, and `docs/tabbit-parity.md` is written.
- **Step 1:** `docs/engine-decision.md` picks CEF 156 in Alloy style. The measurements behind it come from `bench/` (`script_test.sh`, `ram.py`, `engines.sh`) and the `engine-build-cost` workflow.
- **Step 2:** a shell on CEF 156 in Alloy style.
  - `shell/src/`:
    - `main.cc`: app and settings.
    - `shell.cc` and `shell.h`: window, tabs, workspaces, split view, sleeping tabs, session, history, downloads, find, permissions (all refused with a toast for now), and pop-up blocking.
    - `scheme.cc`: built-in pages at `tobari://` and the UI API.
    - `util.cc`: input fixup and paths. It's tested by `shell/test/util_test.cc`.
  - `ui/`: the frame UI in HTML, CSS and JS.
    - `tokens.css`: design tokens, light and dark through `light-dark()`, durations of 0 under reduced motion.
    - `ui.*`: sidebar, top bar, page card, assistant placeholder, toasts.
    - `cmd.*`: the Alt+K command bar. It's a popup that shares the UI renderer and is drawn as an overlay.
    - `about.*`: the about page.
  - `tools/contrast.py` checks the token pairs for WCAG AA. `tools/screens.sh` writes `docs/screens/<surface>-<theme>.png`.
  - `packaging/`: AppRun, a desktop file, our own icon and `appimage.sh`. The AppImage strips `libcef.so`, leaves out `chrome-sandbox` (Chromium uses the user-namespace sandbox), and embeds zsync update info for GitHub Releases.
  - `.github/workflows/build.yml`: on every push to `rewrite`, it runs build, util_test, contrast, the AppImage and a CJK/Thai smoke test, then uploads the artifact.

- **Step 3:** `shell/src/privacy.cc` plus the pure `block.cc` (tested by `shell/test/block_test.cc`).
  - Network-layer blocking from EasyList, EasyPrivacy and uBlock filters/privacy. Lists are downloaded on first start, refreshed weekly, and kept in `~/.local/share/tobari/lists/`. Only host rules are used (a `shortcut:` comment says when to upgrade).
  - Per-site switch and blocked count: a shield in the top bar. `tobari://blocking/` lists the lists and the sites where blocking is off.
  - HTTPS-Only: http navigations and redirects are upgraded; a failed upgrade shows `tobari://https/` with a "continue over http" button.
  - Third-party cookies blocked (`profile.cookie_controls_mode`), WebRTC limited to proxied UDP, device APIs refused with a toast.
  - !bangs resolved locally in `util.cc` (24 bangs, listed on `tobari://bangs/`).
  - No idle calls home. `bench/idle_net.sh` records a Chromium net log and lists the hosts that got a request. What it found, and the fix for each:
    - Component updater (`update.googleapis.com`): `--disable-component-update`. The Optimization Guide models manifest still installs "on demand" past that switch and has no off switch, so `main.cc` maps its host to `~NOTFOUND` with `--host-resolver-rules`.
    - AI Mode eligibility (`www.google.com/async/folae`) and network time (`clients2.google.com/time`): `--disable-features=AimEnabled,AimServerEligibilityEnabled,AimEligibilityComponentExtension,NetworkTimeServiceQuerying`.
    - The GNOME browser connector, installed through the host's `/usr/share/chromium/extensions/*.json` and fetched from the Chrome Web Store: `extensions.block_external_extensions`.
    - Spellcheck dictionaries from `redirector.gvt1.com`: spellcheck is off (a `shortcut:` comment).
    - Safe Browsing list refresh (`safebrowsing.googleapis.com`, every ~30 min): off by default, per Kao's choice. A switch on `tobari://blocking/` turns it on.
    - These prefs have to be in place before profile setup starts downloading, so `main.cc` writes them into a new profile's `Preferences` before `CefInitialize`.

- **Step 4:** the assistant, import and the CLI.
  - `shell/src/ai.cc`: chat over any OpenAI-compatible endpoint (Ollama, llama.cpp, LM Studio locally; OpenAI, OpenRouter and others with your key), streamed through an SSE parser tested in `util_test`. Settings live in `ai.json` (0600). Nothing is bundled or started; no request leaves until you send one.
  - `ui/ai.js`: the Alt+J panel, loaded the first time it opens. It attaches the current page's text on request and has 10 skills on `/`.
  - `shell/src/import.cc` and `tobari://import/`: bookmarks and history from Chrome, Chromium, Brave, Edge, Vivaldi and Firefox (native and Flatpak), read from a copy so a running browser isn't disturbed. Imports merge into `history.jsonl`; bookmarks rank first in the command bar.
  - `shell/src/ctl.cc`: `tobari tabs | open URL | text [ID] | close ID` for outside agents, over `~/.local/share/tobari/ctl.sock` (0600). `open` only takes http(s) pages.
  - `packaging/install.sh`: the old v2 installer moved to the AppImage. It checks the minisign signature on `SHA256SUMS` against the pinned key (minisign, or OpenSSL 3 without it), then the AppImage's checksum, and deletes anything that fails.
  - Decided: no own encryption for history and session. They're 0600 files in a 0700 folder like Chrome's and Firefox's; a key on the same disk adds little, so disk encryption covers rest (`docs/tabbit-parity.md`).

## Step 4 results (2026-10-31, Kao's desktop)
- RAM with the assistant never opened (`bench/ram.py`, median of 3, PSS): Step 3 build 482 MiB at 0 tabs and 1443 MiB at 10; Step 4 build 476 and 1442. Unchanged. A first try showed +14–18 MiB; the per-process split put it in the UI renderer (+9) and GPU (+6), so the assistant panel now loads on first open. The Step 3 baseline was also rebuilt, since building only the `tobari` target had left its UI folder out.
- `bench/ai_test.sh` 5/5 against `bench/ai_fake.py` (streamed request, chosen model, page attached and marked untrusted, the question). `bench/import_test.sh` 7/7 on fake Chromium and Firefox profiles. `bench/cli_test.sh` 8/8. `bench/install_test.sh` 9/9 (a good release installs; a bad checksum, bad or missing signature, or another key is refused and nothing is installed; minisign and OpenSSL paths; uninstall). All four pass from the AppImage too and run in CI.

## Step 3 results (2026-10-31, Kao's desktop)
- `build/block_test` → `block_test: all checks passed`
- `TEST=privacy-test bench/script_test.sh tobari build/out/tobari ...` → `tobari: PASS 7 / 7`. The negative control, stock cefsimple 156, scores `FAIL 4 / 7 ['webrtc_ip', 'third_party_cookie', 'blocks_ads']`: its WebRTC candidates included the public IPv4 and IPv6 addresses. The three device checks pass on stock CEF too in a headless cage, so they only prove that no prompt is granted.
- `bench/https_test.sh build/out/tobari` → 3/3 ok (example.org is upgraded; http.badssl.com and neverssl.com never end on plain http).
- `bench/idle_net.sh` on a new profile (`bench/results/idle-net-tobari-*.txt`):
  - First start (75 s): only `easylist.to` and `ublockorigin.github.io`, the filter lists. `update.googleapis.com` is attempted and doesn't resolve.
  - Idle (150 s, same profile): **0 hosts contacted.**
  - Before the fixes, an idle Tobari contacted `update.googleapis.com`, `www.google.com` and `safebrowsing.googleapis.com`, and the first start also reached `clients2.google.com`, `clients2.googleusercontent.com` and `redirector.gvt1.com`.
- CI: build run 41161977353 (commit d589e1b) is green, and the CI now runs the idle capture too.

## Step 2 results (2026-10-31, Kao's desktop, Bazzite 44)
- `build/util_test` → `util_test: all checks passed`
- `python3 tools/contrast.py` → `contrast: 44/44 pairs pass WCAG AA`
- `bench/script_test.sh tobari dist/Tobari-0.5.0-dev-x86_64.AppImage --ozone-platform=wayland` → `tobari: PASS 60 / 60`
- AppImage size: 140 MiB (146,528,760 bytes).
- Screenshots: 12 surfaces × light and dark in `docs/screens/` (blocking, bangs and https pages added in Step 3).
- No RAM numbers for the shell yet. They come in Step 4 (before and after the assistant) and Step 5.

## Fixed on the way (root causes)
- `*** stack smashing detected ***` in each zygote child. Chromium's zygote gives each forked child a new stack canary, and the child returns through our `main`, so `main` is now `__attribute__((no_stack_protector))`, as Chromium's own is.
- The UI's CSS and JS didn't load. On the IO thread, CEF reports neither the frame URL nor a referrer for subresources. `scheme.cc` now keeps a set of browsers whose main frame is a `tobari://` page.
- The command bar never opened. Chromium's pop-up blocker rejected the UI's `window.open` from a shortcut, since shortcuts carry no user gesture. The browser now runs with `--disable-popup-blocking`, and `Shell::OnBeforePopup` blocks web pop-ups without a user gesture itself.

## Next
1. Step 5: `bench/compare.sh BIN` then `python3 bench/report.py` writes `docs/benchmark.md` (Tobari, Chromium, Firefox: RAM at 0 and 10 tabs, start time).
2. Step 6: tag `v0.5.0`, let CI build it, sign `SHA256SUMS` locally with `~/.minisign/tobari.key`, attach `install.sh`.

## Open risks
- Blocking uses host rules only, so path rules, `$domain=` rules and cosmetic filters are skipped. YouTube-style in-page ads aren't blocked.
- The site check uses a short list of two-part suffixes, not the full Public Suffix List.
- The privacy, HTTPS and idle checks in CI hit real sites (example.org, badssl, neverssl, googlesyndication and the list hosts), so a network hiccup can fail a run.
- The idle capture only covers what Chromium's net log sees. It doesn't watch the network from outside. Spellcheck is off until dictionaries are bundled or fetched on request.
- Resizing a frameless window on GNOME Wayland is untested. The headless cage can't test it. Kao should try dragging the window edges.
- Manual tab groups, agent mode, memory and user skill folders aren't built (cut from 0.5.0).
- The API key in `ai.json` is plain text, readable only by this user.
- Sleeping tabs ignore audio: a tab playing media sleeps after 30 minutes in the background.
- The CI image is Ubuntu 22.04. Ubuntu 24.04 users need `kernel.apparmor_restrict_unprivileged_userns=0` or an AppArmor profile, because the sandbox needs user namespaces.
- `appimagetool` in CI comes from the moving "continuous" release, not a pinned one.

## Resume
```
cd ~/projects/tobari && git switch rewrite
CEF=$HOME/.cache/tobari-engines/cef_binary_156.0.14+g4fa4ab5+chromium-156.0.8078.48_linux64_minimal
distrobox enter tobari -- sh -c "cmake -G Ninja -S shell -B build -DCEF_ROOT=$CEF -DCMAKE_BUILD_TYPE=Release && ninja -C build"
build/util_test && build/block_test && python3 tools/contrast.py
TEST=privacy-test bash bench/script_test.sh tobari build/out/tobari --ozone-platform=wayland
bash bench/https_test.sh build/out/tobari
for t in ai import cli; do bash bench/${t}_test.sh build/out/tobari; done
PATH=~/.local/opt/minisign:$PATH bash bench/install_test.sh
XDG_DATA_HOME=$(mktemp -d) bash bench/idle_net.sh tobari-first-start 75 build/out/tobari --ozone-platform=wayland   # then again as tobari-idle
build/out/tobari --ozone-platform=wayland            # run it; data lives in ~/.local/share/tobari
distrobox enter tobari -- sh packaging/appimage.sh build/out 0.5.0-dev
sh tools/screens.sh                                  # light and dark screenshots
gh run list --workflow build --branch rewrite
```
