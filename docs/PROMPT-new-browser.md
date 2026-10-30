# Tobari: a new AI browser from scratch, modeled on Tabbit

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

An AI browser **modeled on Tabbit (tabbit.ai)**, built for Linux first (Bazzite: Fedora Atomic, KDE and GNOME, Wayland). It must be **private**, **look good**, and **use little RAM when the AI isn't in use**. Kao downloads it as an **AppImage**.

Use Tabbit's feature list and window layout as the reference. Do not copy its name, logo, colours, wording, screenshots or other assets. Tobari keeps its own name (帳, the curtain), icon and design system. Read tabbit.ai at Step 0 and write `docs/tabbit-parity.md`, a checklist of every Tabbit feature that says built, not built, or deliberately different (and why). Keep it current.

Target machines: a Ryzen 5 9600X desktop with an RX 6800 XT (Vulkan, no ROCm) and 32 GB of RAM, and a Legion Pro 5 laptop with an RTX 5060.

### Tabbit parity

Each one needs a test or a recorded real run before it counts as done.

1. **Layout like Tabbit:**
   - vertical tabs on the left, with back, forward, reload and the address bar at the top of the sidebar;
   - the page in the middle as a rounded card on a tinted window background;
   - the AI panel on the right as its own card, resizable and toggled with one shortcut;
   - workspaces in the sidebar, split view (two pages in one window), and a command bar (Alt+K);
   - a compact mode that hides the sidebar until hovered.
2. **Context:** the AI can take the current page, all tabs, screenshots, highlighted text, a picked element, local files, PDFs and bookmarks. `@` in the chat box adds any of them.
3. **Skills:** reusable recipes bound to sites or tasks, run with `/name` or `@name`. A skill is a folder with `SKILL.md` and optional scripts in `~/.config/tobari/skills`. Ship at least 10 first-party skills: summarize page, extract PDF tables, explain a GitHub PR, triage a feed, save to memory, search across tabs, cluster tabs, translate a page (including Japanese and Thai), daily digest, and find a free PDF of a paper. Any prompt can be turned into a skill.
4. **Agent roles:** Research, Operator, Writer and Analyst, each a preset of skills and tool permissions. The agent can read, click, type, navigate, extract tables and save files. Every action that changes something shows a preview and needs a confirm, with a per-site allowlist. Page text is untrusted and can never trigger a tool, and each proposed action is checked against the user's original request.
5. **Site MCP:** sites can expose tools to the agent, with an explicit permission prompt per site and per call.
6. **Memory:** plain Markdown files the user owns in `~/.local/share/tobari/memory`. Searchable, exportable, never uploaded.
7. **Multi-model chat:**
   - local by default: llama.cpp on Vulkan with Qwen3 4B Instruct Q4_K_M, downloaded only when asked and checked against a pinned SHA-256;
   - Ollama, any OpenAI-compatible endpoint, Anthropic and Google, each with the user's own key stored in the OS keyring;
   - the chat header always shows the active model and where the prompt goes (this device, or a host and region).
8. **Tab management:** AI tab grouping and clustering, tab groups, and sleeping tabs that unload when idle.
9. **Import:** history, bookmarks, cookies, passwords (through CSV export) and the extension list, from Chrome, Chromium, Brave, Edge, Vivaldi and Firefox, native and Flatpak installs. Read-only on the other browser's files.
10. **CLI:** `tobari` opens URLs, lists tabs, runs a skill headless, and queries memory.
11. **Updates, crashes, data:**
    - AppImage updates through AppImageUpdate or zsync, and Flatpak updates through Flatpak;
    - crash reports written locally and sent only after the user sees and approves them;
    - history and chats stored encrypted at rest;
    - sync optional and off by default.

### Where Tobari beats Tabbit

Tabbit ships only for macOS and Windows, sends prompts to cloud providers, and has no local-only mode. Tobari must have:

12. **Native Linux:** Wayland first, KDE and GNOME, AppImage first with Flatpak next.
13. **Local-first AI:** works fully offline with the local model. No Tobari server between the user and any provider.
14. **Privacy:**
    - ads and trackers blocked at the network layer before they load (EasyList, EasyPrivacy and uBlock Origin lists, per-site switch and count);
    - no telemetry, HTTPS-Only, third-party cookies blocked, WebRTC IP leaks limited, device APIs blocked unless allowed;
    - `!bangs` resolved on the machine.
    Prove "nothing sent home" with a network capture of an idle profile, where only the weekly filter-list update may appear.
15. **Low RAM:** with the AI never opened, no AI process runs and no model is loaded. The model loads on first use and unloads after idle.
16. **Built-in pages,** like `chrome://`: about, blocking, bangs, AI, setup.

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

**Step 2: browser shell.** The Tabbit-style window (sidebar, page card, AI panel card), workspaces, split view, command bar, built-in pages, setup and import. CI builds an AppImage on every push to `rewrite`. **ASK** with screenshots in light and dark, next to the matching Tabbit view, so Kao can compare the layout. Tobari's own look must stay its own.

**Step 3: privacy and blocking.** Blocking, defaults, bangs, and the idle network capture. ASK with the capture summary.

**Step 4: assistant.** Sidecar, providers, `@` context, skills, roles, agent, site MCP, memory, CLI. Then prove that RAM with the assistant closed matches Step 3's, and update `docs/tabbit-parity.md`. ASK.

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
