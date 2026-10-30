# Tobari: a new browser from scratch

You are the lead engineer on a new Tobari. Tawin (Kao) is the product owner. Read this whole prompt, then start at Step 0. Stop at every gate marked **ASK** and wait for an answer.

## Working rules

1. Find the root cause before you patch anything.
2. Ask before any `sudo`, `rpm-ostree` or system-level change. Build tools live in distrobox, never on the Bazzite host.
3. Keep `HANDOFF.md` at the repo root current after every step: done, next, open risks, exact commands to resume.
4. Don't claim a number (RAM, speed, rule counts) that a script in the repo didn't produce. Don't claim a feature works until a test or a real run shows it.
5. Short, direct updates. Push back with numbers when something is unrealistic.
6. Never ship `--no-sandbox`. Never put a signing key in CI.
7. Write in English.

## Start clean

This is a new codebase. Do not build on, copy or port the earlier Tobari code. Previous attempts exist only as history:

- the `browser` branch (Tobari 0.1 to 0.4, a CEF privacy browser with signed releases)
- `main` (the "v2" AI-assistant extension plus a Rust core, never shipped as a browser)

At Step 0, archive both without deleting anything: tag their heads `archive/browser-0.4.0` and `archive/v2-extension`, then start the new code on a fresh branch, `rewrite`. It becomes `main` once Kao approves. The existing GitHub Releases (0.1.0 to 0.4.0) stay as they are.

You may read the old code and docs for **lessons only**. These are the ones that cost the most time:

- On Kao's Bazzite machines, Flatpak Chrome and an earlier CEF build showed empty boxes for Japanese text, while Firefox rendered it correctly. The cause was never confirmed. Test CJK and Thai rendering before committing to an engine.
- CEF can't be downloaded from some sandboxed environments. GitHub Actions can download it, so build the engine in CI.
- Branded Google Chrome ignores `--load-extension`. The Flatpak sandbox blocks native messaging to programs outside it. An AppImage's mount path changes on every launch, so helper binaries need a stable copy.
- Releases were signed offline with minisign. The public key is `tobari.pub` (id `0F0DC333B8A4E968`). Reuse this key, or **ASK** before making a new one.
- Measure RAM as PSS summed over the whole process tree, never RSS.

## What to build

A desktop web browser for Linux first (Bazzite: Fedora Atomic, KDE and GNOME, Wayland). It must be **private**, **look good**, and **use little RAM when the AI isn't in use**. Kao downloads it as an **AppImage**.

Target machines: a Ryzen 5 9600X desktop with an RX 6800 XT (Vulkan, no ROCm) and 32 GB of RAM, and a Legion Pro 5 laptop with an RTX 5060.

Required features. Each one needs a test or a recorded real run before it counts as done:

1. **Browsing basics:** tabs, the address bar, history, bookmarks, downloads, find in page, zoom, full screen, and the Chrome Web Store (or the engine's own extension store) with password managers working.
2. **Layout:** vertical tabs and a horizontal tab strip (user's choice), workspaces, split view (two pages in one window), and a command bar (Alt+K).
3. **Blocking:** ads and trackers blocked at the network layer before they load, from EasyList, EasyPrivacy and uBlock Origin lists, with a per-site switch and a count. Lists update weekly, and that update is the only traffic the browser starts by itself.
4. **Private defaults:**
   - a privacy-friendly search engine and no search suggestions;
   - third-party cookies blocked, HTTPS-Only on, WebRTC IP leaks limited;
   - no telemetry, crash uploads or sync unless the user turns them on;
   - device APIs blocked unless allowed per site.
   Prove the "nothing sent home" claim with a network capture of an idle profile.
5. **`!bangs`:** resolved on the machine before the request leaves.
6. **First-run setup:** search engine, theme, privacy options, and import from Chrome, Chromium, Brave, Edge, Vivaldi and Firefox (native and Flatpak installs): bookmarks, history, cookies, and the extension list. Read-only on the other browser's files.
7. **Tab management:** tab groups (by site, or AI-clustered), and sleeping tabs that unload after idle to free RAM.
8. **Assistant (optional, off until opened):**
   - a side panel chat that defaults to a local model on llama.cpp (Vulkan, Qwen3 4B Instruct Q4_K_M), downloaded only when the user asks and verified against a pinned SHA-256;
   - cloud providers only with the user's own key, stored in the OS keyring;
   - the panel header always shows the model and where prompts go;
   - `@` context (tab, all tabs, selection, element, screenshot, PDF, file), `/` skills stored as `SKILL.md` folders, and Markdown memory the user owns;
   - an agent that can read, click, type and navigate, with tools **off by default**, a confirm step for every action that changes something, and a prompt-injection defense where page text can never trigger a tool;
   - the model loads on first use and unloads after idle.
9. **Built-in pages,** like `chrome://`: about, blocking, bangs, AI, setup.
10. **CLI:** `tobari` to open URLs, list tabs, and run a skill.
11. **Crash reports:** written locally, sent only after the user sees and approves them.

## Targets

- **RAM:** with the assistant never opened, idle and 10-tab PSS at or below Brave's on the same machine and pages. Build a harness in `bench/` that runs Tobari, Brave, Chrome, Firefox and Zen at 0, 5, 10 and 25 tabs. Publish its table in `docs/bench.md` with the date and machine. No other RAM claims anywhere.
- **CJK and Thai:** Japanese and Thai render correctly in pages and in the browser's own UI on Bazzite. This is a release gate, not a nice-to-have.
- **Look:**
  - one design system: tokens, a type scale and spacing, light and dark, WCAG AA contrast checked by a script;
  - motion of 150 to 250 ms with ease-out, nothing animated while typing, reduced-motion respected;
  - screenshots of every surface in both themes before each **ASK**.

## Steps

**Step 0: ASK.** Confirm you read this, archive the old branches as described, and ask Kao:
- AppImage only, or also Flatpak, a tarball with `curl | bash` installer, or a macOS dmg?
- Reuse the existing minisign key, or make a new one?
- Is `cef-builds.spotifycdn.com` (or whatever the engine needs) reachable here, or does every engine build happen in GitHub Actions?

**Step 1: engine decision, ASK.** Compare at least CEF in Chrome style, a Chromium fork with a small patch set, and a Gecko-based build. Use measured results, not opinions:
- CJK and Thai rendering on Bazzite, using a test page that grades itself;
- build time and disk use in CI;
- RAM at idle and at 10 tabs;
- extension support;
- the number of patches each needs to maintain.

Write `docs/engine-decision.md` with a recommendation and stop.

**Step 2: browser shell.** Window, tabs, layout options, address bar, built-in pages, setup and import. CI builds an AppImage on every push to `rewrite`. ASK with screenshots.

**Step 3: privacy and blocking.** Blocking, defaults, bangs, and the idle network capture. ASK with the capture summary.

**Step 4: assistant.** Sidecar, providers, panel, agent, skills, memory, CLI. Then prove that RAM with the assistant closed matches Step 3's. ASK.

**Step 5: benchmark.** Run the harness on Kao's desktop and publish the table. If Tobari is above Brave, find out why before changing anything.

**Step 6: release 0.5.0, ASK before tagging.**
- CI builds the AppImage (plus the agreed packages) and a draft GitHub Release with `SHA256SUMS`.
- Kao signs offline and publishes.
- The website (`site/`, GitHub Pages from `main`, Vercel with Root Directory `site`) lists the release with files, sizes and checksums.
- The installer refuses anything whose signature or checksum doesn't match. Test it with a throwaway key: signed, tampered and wrong-key cases, plus uninstall, as a normal user.

## Deliverables per step

Working code, tests that pass (paste the summary lines), an updated `HANDOFF.md`, screenshots in light and dark for any UI, and a short note listing what you measured and what's still open.

## First message back

Confirm you read this, do Step 0, and don't write product code until Kao answers.
