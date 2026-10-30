# Tobari v2 handoff

Updated 2026-10-30. Branch `claude/dreamy-albattani-pl8bw2` on kaorii-ako/tobari.

## Where things stand

| Phase | State |
|---|---|
| 0. Engine gate | Probe page and script done and verified in the cloud container. Engine picked: B, CEF Chrome style (Kao said "whatever works best"). Bazzite runs still missing. |
| 1. Shell | UI done as an extension (vertical tabs, workspaces, command bar, new tab, import, tracker blocking, crash flow). CEF shell code written, **never compiled**. Split view is a two-window fallback. |
| 2. AI sidecar | Done and tested with a fake llama-server: on-demand start, idle unload, loopback plus a CSPRNG token, native messaging, model manager with SHA-256, five provider kinds, keyring storage, destination in the chat header, two-stage injection guard. |
| 3. Agent | Done and tested in real Chromium: `@` context, tools with confirm cards and a per-site allowlist, roles, skill loader plus 10 skills, prompt-to-skill, Markdown memory, site MCP, `tobari` CLI. |
| 4. Bench | Harness done. One smoke run in the cloud container (Chromium vs Chromium + Tobari only). No Bazzite numbers yet. |
| 5. Packaging | Flatpak manifest is a draft with `PIN-…` placeholders. AppImage script written, not run. |

## Tests that pass today

- `cargo test`: 36 unit tests (guard, providers, skills, memory, import, framing).
- `core/tests/e2e.py`: 18 checks against the real `tobari` binary over native messaging and a
  fake llama-server. It verifies the bearer token, the 127.0.0.1 bind, idle unload killing the
  process, parts for messages over 1 MB, the CLI reaching the browser through the control socket,
  and socket permissions.
- `extension/scripts/ui-e2e.mjs`: 22 checks in real Chromium with the real core. They cover the
  pinned extension ID, chat with the destination shown, `@` picker, Markdown with 帳 and ภาษาไทย,
  the click confirm flow, a prompt injection that tries to leak a code through a URL being
  blocked, `/` skills, Chrome profile import, tracker ruleset, command bar, `tobari tabs`, and site
  MCP detect, approve, confirm and result. Screenshots land in `docs/screenshots/`.
- `npm test`: Markdown sanitizer and model-name formatting.

## Measured so far

The cloud container (Xeon 2.1 GHz, Xvfb, software GL, `--no-sandbox` because it runs as root) is
not target hardware. Full table in `docs/bench.md`.

- Chromium 153 idle: 468 MiB PSS. With the Tobari extension and core: 484 MiB (+16 MiB).
- The `tobari` core process: 2.2 MiB PSS at idle, 2.5 MiB with 25 tabs.
- Sleeping 24 of 25 tabs saved 54 MiB (894 → 840). The corpus is one site, so Chromium already
  shares one renderer across those tabs. Expect a bigger saving on real multi-site pages, but it's
  not measured yet.

## Next, in order

1. **Kao: run the font probe on the desktop.** Commands are in `phase0/README.md`. Send back each
   `report.md` and `headless.png`. If Flatpak Chrome and the CEF sample show boxes while Firefox
   doesn't, and strace shows the CJK file never opened, switch the engine to C (Gecko) before more
   shell work. This is the exit condition in `docs/engine-decision.md`.
2. **Kao: allow `cef-builds.spotifycdn.com` in the cloud environment's network settings** (and
   `download.gnome.org`, `github.com` release assets, `huggingface.co` if Flatpak and model work
   should happen in the cloud). Then compile `shell/`, fix whatever the CEF API disagrees with,
   commit `shell/cef.lock`.
3. Try Tobari today on Bazzite with `scripts/dev-run.sh` inside distrobox (see `docs/DEV.md`), then
   `tobari setup` for the real Vulkan llama-server and Qwen3-4B. Check actual VRAM and that the
   unload frees it (`nvtop` or `radeontop`).
4. Run `bench/run.py` on the desktop with Firefox, Zen, Brave, Chrome and Tobari, using
   `bench/pages.txt` (real sites) and `--discard`. Only these numbers count against the "at or below
   Brave" target.
5. Fill the Flatpak pins, build it, then run the probe against the Flatpak build.
6. Linear: only Phase 0 to 2 exist as KAO-62, KAO-63 and KAO-64. Creating Phase 3 to 5 was
   cancelled mid-call. Create them, or say if you'd rather track in HANDOFF only.

## Open risks

- **Japanese tofu on Chromium builds.** Root cause unknown. Both Chromium builds on Bazzite showed
  it. B inherits it if it's Chromium-wide.
- **The CEF shell has never compiled.** Expect API mismatches against whichever CEF version
  `cef.lock` pins. `--load-extension` should work on unbranded CEF; if it doesn't, load the
  extension through the extensions directory instead.
- **Split view** is two windows side by side. Wayland compositors ignore client window placement,
  so on KDE and GNOME Wayland the user has to tile them. Real split view needs either the shell
  (two browser views in one window) or Chromium's own split-view feature, once confirmed in the
  pinned CEF.
- **Small-model tool calls.** The agent protocol is one JSON line per step, and refs are numbered so
  a 4B model doesn't have to write selectors. Only a scripted fake model has been tested. Qwen3-4B
  may need prompt tuning.
- **History import** loses visit dates. `chrome.history.addUrl` can't set them. Fixing that needs
  the shell to write the profile's History database before first launch.
- **Tracker blocking** is about 170 domains, nowhere near uBlock Origin's lists. It's honest about
  that in settings. Shipping full lists means converting EasyList to DNR rules at build time.
- **Flatpak native messaging to the host** is impossible by design. The browser and the core must
  ship in the same Flatpak (which the manifest does).
- **Thai word breaking** in memory search uses character bigrams, not a dictionary. It finds
  substrings and doesn't rank by words.
- **The extension private key** used to derive the pinned ID was not kept. Unpacked loading only
  needs the public key in `manifest.json`. A Chrome Web Store listing would get its own ID; the
  native host manifest would then need both IDs.

## Resume

```bash
git clone https://github.com/kaorii-ako/tobari && cd tobari && git checkout claude/dreamy-albattani-pl8bw2
```

```bash
cargo test --manifest-path core/Cargo.toml && cargo build --manifest-path core/Cargo.toml && python3 core/tests/e2e.py
```

```bash
npm ci --prefix extension && npm run build --prefix extension && npm test --prefix extension
```

```bash
cd extension && xvfb-run -a node scripts/ui-e2e.mjs
```

v1 is under `v1-archive/` (core, extension, SECURITY.md, packaging notes). `TOBARI_PROMPT.md` was
not in this repo, so it was not archived; if it lives elsewhere, copy it into `v1-archive/`.
