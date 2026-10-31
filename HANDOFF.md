# Tobari rewrite: handoff

Updated 2026-10-31. Current step: **Step 3 (privacy) is mostly done; the idle network capture and new screenshots are left.**

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

- **Step 3 (partial):** `shell/src/privacy.cc` plus the pure `block.cc` (tested by `shell/test/block_test.cc`).
  - Network-layer blocking from EasyList, EasyPrivacy and uBlock filters/privacy. Lists are downloaded on first start, refreshed weekly, and kept in `~/.local/share/tobari/lists/`. Only host rules are used (a `shortcut:` comment says when to upgrade).
  - Per-site switch and blocked count: a shield in the top bar. `tobari://blocking/` lists the lists and the sites where blocking is off.
  - HTTPS-Only: http navigations and redirects are upgraded; a failed upgrade shows `tobari://https/` with a "continue over http" button.
  - Third-party cookies blocked (`profile.cookie_controls_mode`), WebRTC limited to proxied UDP, device APIs refused with a toast.
  - !bangs resolved locally in `util.cc` (24 bangs, listed on `tobari://bangs/`).

## Step 3 results (2026-10-31, Kao's desktop)
- `build/block_test` → `block_test: all checks passed`
- `TEST=privacy-test bench/script_test.sh tobari build/out/tobari ...` → `tobari: PASS 7 / 7`. The negative control, stock cefsimple 156, scores `FAIL 4 / 7 ['webrtc_ip', 'third_party_cookie', 'blocks_ads']`: its WebRTC candidates included the public IPv4 and IPv6 addresses. The three device checks pass on stock CEF too in a headless cage, so they only prove that no prompt is granted.
- `bench/https_test.sh build/out/tobari` → 3/3 ok (example.org is upgraded; http.badssl.com and neverssl.com never end on plain http).

## Step 2 results (2026-10-31, Kao's desktop, Bazzite 44)
- `build/util_test` → `util_test: all checks passed`
- `python3 tools/contrast.py` → `contrast: 44/44 pairs pass WCAG AA`
- `bench/script_test.sh tobari dist/Tobari-0.5.0-dev-x86_64.AppImage --ozone-platform=wayland` → `tobari: PASS 60 / 60`
- AppImage size: 140 MiB (146,528,760 bytes).
- Screenshots: 9 surfaces × light and dark in `docs/screens/`.
- No RAM numbers for the shell yet. They come in Step 4 (before and after the assistant) and Step 5.

## Fixed on the way (root causes)
- `*** stack smashing detected ***` in each zygote child. Chromium's zygote gives each forked child a new stack canary, and the child returns through our `main`, so `main` is now `__attribute__((no_stack_protector))`, as Chromium's own is.
- The UI's CSS and JS didn't load. On the IO thread, CEF reports neither the frame URL nor a referrer for subresources. `scheme.cc` now keeps a set of browsers whose main frame is a `tobari://` page.
- The command bar never opened. Chromium's pop-up blocker rejected the UI's `window.open` from a shortcut, since shortcuts carry no user gesture. The browser now runs with `--disable-popup-blocking`, and `Shell::OnBeforePopup` blocks web pop-ups without a user gesture itself.

## Next
1. Finish Step 3: an idle network capture script (prove that an idle Tobari only fetches the weekly list update), re-take the screenshots (toasts moved over the sidebar) and add the blocking, bangs and https pages.
2. Step 4: the assistant (local llama.cpp and BYOK), skills, memory, and a CLI. Prove that RAM is unchanged while the assistant is never opened.
3. Encrypt `session.json` and `history.jsonl` before 0.5.0. Both are plaintext with mode 0600 today, marked with a `shortcut:` comment.

## Open risks
- Blocking uses host rules only, so path rules, `$domain=` rules and cosmetic filters are skipped. YouTube-style in-page ads aren't blocked.
- The site check uses a short list of two-part suffixes, not the full Public Suffix List.
- The privacy and HTTPS checks in CI hit real sites (example.org, badssl, neverssl, googlesyndication), so a network hiccup can fail a run.
- Resizing a frameless window on GNOME Wayland is untested. The headless cage can't test it. Kao should try dragging the window edges.
- Manual tab groups aren't built. They come with AI grouping in Step 4.
- Sleeping tabs ignore audio: a tab playing media sleeps after 30 minutes in the background.
- The CI image is Ubuntu 22.04. Ubuntu 24.04 users need `kernel.apparmor_restrict_unprivileged_userns=0` or an AppArmor profile, because the sandbox needs user namespaces.
- `appimagetool` in CI comes from the moving "continuous" release, not a pinned one.
- The CI build hasn't been seen green yet as of this update. Check the latest run of the `build` workflow.

## Resume
```
cd ~/projects/tobari && git switch rewrite
CEF=$HOME/.cache/tobari-engines/cef_binary_156.0.14+g4fa4ab5+chromium-156.0.8078.48_linux64_minimal
distrobox enter tobari -- sh -c "cmake -G Ninja -S shell -B build -DCEF_ROOT=$CEF -DCMAKE_BUILD_TYPE=Release && ninja -C build"
build/util_test && build/block_test && python3 tools/contrast.py
TEST=privacy-test bash bench/script_test.sh tobari build/out/tobari --ozone-platform=wayland
bash bench/https_test.sh build/out/tobari
build/out/tobari --ozone-platform=wayland            # run it; data lives in ~/.local/share/tobari
distrobox enter tobari -- sh packaging/appimage.sh build/out 0.5.0-dev
sh tools/screens.sh                                  # light and dark screenshots
gh run list --workflow build --branch rewrite
```
