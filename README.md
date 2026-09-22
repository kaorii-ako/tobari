# Tobari (帳)

**A browser that closes over the window.**

A privacy-first, AI-native Chromium browser for Linux and macOS. All
inference runs locally through llama.cpp on the user's machine. No cloud
inference, no accounts, no telemetry, ever.

Tobari does not claim to make you invisible. It gives you something you close
deliberately. No "untraceable", no "anonymous", no claim we cannot defend in
`SECURITY.md`.

## Status

Phase 1 on Linux: Rust sidecar (`tobari-core`) + MV3 extension, installed into
the user's existing Chrome/Chromium/Brave — native installs and Flatpak
installs both.

macOS is **deferred to Phase 2** (`docs/DEV-MACOS.md`). The `macos-14` CI
compile smoke stays so the code does not rot; no `.dmg` is produced, because
there is no Mac to test on and no notarization account. Treat macOS as a
build-from-source target.

`docs/VALIDATION.md` has **no go/pivot/stop decision recorded**. The developer
waived that gate for Phase 1 on 2026-09-22; the waiver does not extend to
Phase 2, and the file says so.

Phase 1 runs end to end on Linux as of 2026-09-22: native messaging → sidecar
→ `llama-server` on Vulkan → streamed answer, with the loopback binding, token
rejection and prompt-injection split measured rather than asserted. Results
are in `SECURITY.md`; repro with `python3 scripts/acceptance-drive.py`.

## Layout

```
core/            Rust sidecar: supervises llama-server, serves the native
                 messaging host (crates: tobari-core, tobari-ipc)
extension/       MV3 TypeScript extension: sidebar chat, summarize, Explain
shell/           Phase 2: CEF-based browser shell (not started)
patches/         Phase 3: patch set against Chromium stable (not started)
docs/            VALIDATION.md, DEV-LINUX.md, DEV-MACOS.md, PACKAGING.md,
                 RELEASING.md
site/            Static marketing site for Netlify — no trackers, no cookies
core/models.toml Pinned model manifest (SHA-256, licences)
SECURITY.md      Threat model and every security tradeoff, stated plainly
```

## Build

Linux builds happen inside a distrobox container. Start at
`docs/DEV-LINUX.md` step one. Nothing is ever layered onto the Bazzite host.

```sh
packaging/build-llama-server.sh   # pinned llama.cpp, Vulkan, in-container
./scripts/dev-run.sh              # sidecar + extension + native messaging manifests
packaging/build-appimage.sh       # AppImage (static type2 runtime) + tarball
```

## Locked decisions

| Question | Decision | Why |
|---|---|---|
| macOS | **Deferred to Phase 2.** CI compile smoke on `macos-14` stays; no `.dmg`, no new macOS-conditional code | No Mac to test on, no notarization account; a `.dmg` Gatekeeper blocks is not shippable (spec §12.5). Full reasoning in `docs/DEV-MACOS.md` |
| Flatpak browsers (Chrome/Chromium/Brave) | Supported: manifest into `~/.var/app/<id>/config/...`, host reached via a `flatpak-spawn --host` shim, missing permission detected and reported | A Flatpak browser cannot exec a host binary; without this the sidecar is unreachable on any Flatpak-only desktop (`docs/PACKAGING.md`) |
| App framework (sigma-eclipse-llm uses Tauri) | No Tauri | On Linux Tauri is WebKitGTK, not Chromium; we would not ship the engine we claim |
| Brand split ("Eclipse" style second brand) | No; the model is just Tobari | A second brand exists to license separately; we have nothing to license separately |
| llama.cpp source | Pin tag `b11053` (ggml-org), build from source in-container | Source builds carry no redistribution risk and pin/upgrade on our schedule |
| Extension ID for `allowed_origins` | Fixed public key embedded in `extension/manifest.json`, deterministic ID across installs | Pin the manifest to the exact ID with no wildcards and no per-install key churn |
| Model catalog | 3 curated Apache-2.0 tiers (0.6B small / 4B-Instruct-2507 Q4_K_M default / 30B-A3B-Instruct-2507 large), SHA-256 pinned | Pre-chosen list, hardware-based recommendation, exact sizes and hashes verified via HF tree API 2026-09-20 |
| BYO HF models | Hash on first download, re-verify on every load, labelled "unverified" in UI | Strongest option; BYO files cannot be pre-pinned by us |
| First-run download | Explicit consent prompt showing exact byte size | Never silent auto-download |
| Hardware recommendation | Vulkan VRAM detect (AMD) / `nvidia-smi` (NVIDIA) / Metal (macOS); map to tier; reduce `--n-gpu-layers` and report the split if over VRAM | Never silently OOM the GPU; CPU fallback is stated in the UI, not silent |
| License | MIT | Changeable before first release |

Reference material (prior art, not dependencies): sigmabrowser.com product
surface, Ai-Swat/sigma-eclipse-llm (llama-server supervision pattern).

## Docs

- `docs/VALIDATION.md` — Stage 0 gate (waived for Phase 1; decision not yet recorded)
- `docs/DEV-LINUX.md` — container setup, toolchain, llama.cpp build
- `docs/DEV-MACOS.md` — CI build, signing/notarization status
- `docs/PACKAGING.md` — AppImage and Flatpak constraints per phase
- `docs/RELEASING.md` — minisign signing, checksums, GitHub Releases, Flathub
- `SECURITY.md` — threat model, prompt-injection design, tradeoffs
