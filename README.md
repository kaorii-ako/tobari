# Tobari (帳)

**A browser that closes over the window.**

A privacy-first, AI-native Chromium browser for Linux and macOS. All
inference runs locally through llama.cpp on the user's machine. No cloud
inference, no accounts, no telemetry, ever.

Tobari does not claim to make you invisible. It gives you something you close
deliberately. No "untraceable", no "anonymous", no claim we cannot defend in
`SECURITY.md`.

## Status

Phase 1 in progress: Rust sidecar (`tobari-core`) + MV3 extension, installed
into the user's existing Chrome/Chromium/Brave on Linux. macOS is CI-built
only as a compile smoke test on `macos-14` — no `.dmg` is produced, because
there is no Mac to test on and no notarization account; treat macOS as a
build-from-source target (`docs/DEV-MACOS.md`, spec §7.5).

## Layout

```
core/            Rust sidecar: supervises llama-server, serves the native
                 messaging host (crates: tobari-core, tobari-ipc)
extension/       MV3 TypeScript extension: sidebar chat, summarize, Explain
shell/           Phase 2: CEF-based browser shell (not started)
patches/         Phase 3: patch set against Chromium stable (not started)
docs/            DEV-LINUX.md, DEV-MACOS.md, PACKAGING.md
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
| macOS Phase 1 | CI compile smoke on `macos-14` only, no `.dmg` artifact | No Mac to test on, no notarization account; a `.dmg` Gatekeeper blocks is not shippable (spec §7.5) |
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

- `docs/DEV-LINUX.md` — container setup, toolchain, llama.cpp build
- `docs/DEV-MACOS.md` — CI build, signing/notarization status
- `docs/PACKAGING.md` — AppImage and Flatpak constraints per phase
- `SECURITY.md` — threat model, prompt-injection design, tradeoffs
