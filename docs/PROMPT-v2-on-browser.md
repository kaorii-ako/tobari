# Tobari 0.5.0: put v2 on top of the old browser

You are the lead engineer on Tobari. Tawin (Kao) is the product owner. Read this whole prompt, then start at Step 0. Stop at every gate marked **ASK** and wait for an answer.

## Working rules

1. Find the root cause before you patch anything.
2. Ask before any `sudo`, `rpm-ostree` or system-level change. Build tools live in distrobox, never on the Bazzite host.
3. Keep `HANDOFF.md` at the repo root current after every step: done, next, open risks, exact commands to resume.
4. Don't claim a number (RAM, speed, rule counts) that a script in the repo didn't produce. Don't claim a feature works until a test or a real run shows it.
5. Short, direct updates. Push back with numbers when something is unrealistic.
6. Never use `--no-sandbox` in shipped code. Never put the release signing key in CI.
7. Don't delete either branch's history. Merge, don't rewrite.

## Where things are

Repository: `kaorii-ako/tobari`. There are two unrelated codebases (no shared git history):

**`browser` branch: the old Tobari, 0.4.0, released and working.**
- CEF 154 shell (`shell/`, pinned by `shell/provision-cef.sh`) that drives Chromium's own window, tabs and toolbar.
- `blocker/` (Rust, adblock-rust, about 142k rules from EasyList, EasyPrivacy and uBO), cancelling requests before they load, with a per-site switch and a badge.
- 35 local `!bangs`, first-run setup window (`tobari://welcome`), `tobari://about|blocking|bangs|ai`.
- Hardened defaults: V8 optimizers off (per-site "Fast JavaScript"), HTTPS-Only, device APIs blocked, no phoning home except weekly filter-list downloads.
- Import from Chrome, Chromium, Brave, Edge, Vivaldi and Firefox. Tab groups by site.
- Simple local AI (Ask AI side panel, Organize with AI), with llama.cpp running Qwen3.
- `.github/workflows/build.yml` builds the shell in CI and produces the Flatpak, AppImage, tarball and macOS dmg. Releases are signed with minisign offline (`docs/RELEASING.md`, key `tobari.pub`, id `0F0DC333B8A4E968`).
- Measured at 861 MB PSS against Chrome's 1,220 MB at 10 tabs (`BENCHMARKS.md`).

**`main` branch: v2, the assistant. No buildable browser window.**
- `core/` (Rust `tobari` binary): CLI plus native messaging host. Starts the llama.cpp sidecar on demand and unloads it after idle. Loopback-only with a 32-byte CSPRNG token. Provider layer (local, Ollama, OpenAI-compatible, Anthropic, Google; keys in the OS keyring). Two-stage prompt-injection guard. Skills (`SKILL.md` folders, 10 bundled in `skills/`). Markdown memory. Profile import. Control socket for the CLI.
- `extension/` (MV3, TypeScript, GSAP motion): side panel with vertical tabs and the assistant, `@` context picker, `/` skills, agent tools with confirm cards and a per-site allowlist, new tab page, Alt+K command bar, settings, site MCP, a Tabbit-style `window.html` preview.
- Tests: `cargo test` (36), `core/tests/e2e.py` (18 checks against a fake llama-server), `extension/scripts/ui-e2e.mjs` (24 checks in real Chromium).
- `site/` website (GitHub Pages from `main`, Vercel through Git integration with Root Directory `site`). The Download page is built from GitHub Releases. `packaging/v2/install.sh` and `.github/workflows/release.yml` were written for a Chromium-extension preview. They get replaced or adapted here.
- `shell/` on main is an unbuilt CEF sketch. Drop it in favour of the browser branch's shell.

## Goal

One Tobari, version **0.5.0**, that is the old browser with everything it had, plus the v2 assistant, shipped as a **downloadable AppImage** (and the other packages Kao picks) built in GitHub Actions. It has to look good, stay private, and use little RAM when the AI is not in use.

## Decisions (use these defaults unless Kao answers otherwise at Step 0)

1. **Base:** the `browser` branch's browser becomes the base. v2's core, extension, skills and memory go on top. The v2 shell sketch on main is dropped.
2. **Layout:** Chromium's own window (tabs on top, toolbar) like 0.4.0. The v2 assistant lives in the side panel. Vertical tabs are an optional side-panel view, off by default.
3. **AI:** the v2 assistant replaces the old Ask AI and Organize with AI. Agent tools are **off by default**, so it is read-only like the old Ask AI. You turn them on per site, and every state-changing step still needs a confirm. Nothing AI-related runs or uses RAM until the user opens the assistant. No model downloads without asking.
4. **Packages:** AppImage and Flatpak at minimum. Tarball plus `install.sh`, and the macOS dmg, if they still build.
5. **Privacy:** keep every 0.4.0 default. v2 must add no network traffic of its own. Cloud providers stay opt-in with the user's own key, and the chat header always shows where prompts go.

## Step 0: ASK

Confirm the four decisions above with Kao, or take his answers. Also ask:
- Is `cef-builds.spotifycdn.com` reachable from this environment? If not, all shell builds happen in GitHub Actions only. Say so plainly.
- Should 0.4.0 users get 0.5.0 through the same `install.sh` command?

## Step 1: bring the browser into main

- Merge `browser` into `main` with `--allow-unrelated-histories` on a working branch. Resolve conflicts so that:
  - the browser's `shell/`, `blocker/`, `packaging/`, `SECURITY.md`, `BENCHMARKS.md`, `CHANGELOG.md` and `docs/` win;
  - v2's `core/`, `extension/`, `skills/`, `bench/`, `phase0/` and `site/` are kept;
  - workflows are reconciled. Keep `build.yml` (shell plus packages), the v2 `ci.yml` jobs (core, extension, site) and the `pages.yml` from main, and make sure only one workflow deploys Pages.
- Rename collisions explicitly (for example, two `install.sh` files or two `docs/RELEASING.md` files). Keep the browser's app id `dev.tobari.Browser`.
- Gate: CI green on the merged branch, with the old 0.4.0 build still producing its AppImage unchanged. **ASK** Kao to review before Step 2.

## Step 2: the assistant inside the browser

- Bundle `extension/dist` as a component extension the shell loads, the way the 0.4.0 shell loads its `shield` and `newtab` extensions. It must not depend on `--load-extension`. Pin its ID through the manifest `key`.
- Ship the `tobari` core binary and `llama-server` inside the packages. The shell registers the native messaging host on start, pointing to the bundled binary. The AppImage must copy it to a stable path, because AppImage mount paths change on every launch.
- Merge the two AI stacks. Keep v2's sidecar (on-demand start, idle unload, checksummed models, loopback plus token). Remove the old Ask AI code paths, or route them to the v2 core. Map `tobari://ai` to the v2 model and provider settings.
- Agent tools are off by default (decision 3). Add the per-site toggle to the existing toolbar popup next to "Blocking" and "Fast JavaScript".
- Keep 0.4.0's new tab with bangs, or merge it with v2's new tab. **ASK** with screenshots of both.
- Run the v2 UI test (`extension/scripts/ui-e2e.mjs`) against the real shell where possible, and the 0.4.0 smoke tests (`scripts/smoke.mjs`, `scripts/ai-smoke.mjs`).

## Step 3: look good

- One visual system. 0.4.0 has `docs/DESIGN.md` (IBM Plex, vermilion signal, WCAG AA in both themes). v2 has `extension/static/tobari.css` (Inter, 藍 indigo plus ember, warm paper). **ASK** Kao which one wins, showing side-by-side screenshots of the toolbar popup, side panel, new tab and setup window in light and dark. Then apply it everywhere, including the website.
- Motion follows the v2 rules: 150 to 250 ms ease-out, nothing animates on typing or arrow keys, reduced-motion and hidden pages turn it off, and every tween has a timer backstop.
- Check contrast with `scripts/contrast.py`.

## Step 4: RAM

- With the assistant never opened, Tobari 0.5.0 must stay within 3% of 0.4.0's PSS at idle and at 10 tabs. Measure with `bench/run.py` (PSS over the whole process tree) or 0.4.0's `scripts/benchmark-ram.sh`. Report the table. If it's over, find out why before changing anything.
- With the assistant open but no model loaded, report the extra PSS. With a model loaded, report RAM and VRAM, and show that idle unload frees them.
- Tab sleeping (v2's discard) is on, with a setting. Measure it on real multi-site pages (`bench/pages.txt`), not the single-site corpus.

## Step 5: release 0.5.0

- Version 0.5.0 everywhere (shell, core, extension, metainfo, installer).
- CI builds the AppImage (plus the other agreed packages) and creates a **draft** release with `SHA256SUMS`. Kao signs offline with `packaging/sign-release.sh 0.5.0` and publishes.
- `install.sh` installs 0.5.0 and still verifies the signature before installing anything. Test it with a throwaway key: signed, tampered and wrong-key cases, plus uninstall. Run it as a normal user, never root.
- The site's Download page then lists 0.5.0 on its own. Update the home page copy to describe the merged product honestly: what works, what's off by default, what isn't done.
- **ASK** before tagging or publishing anything.

## Deliverables per step

Working code, tests that pass (paste the summary lines), an updated `HANDOFF.md`, screenshots for any UI change in light and dark, and a short note listing what you measured and what's still open.

## First message back

Confirm you read this, run Step 0's questions, and don't touch code until Kao answers.
