# Tobari 帳

A browser that closes over the window.

Privacy-first, AI-native Chromium browser for Linux and macOS. Local-only
inference through llama.cpp. No cloud, no accounts, no telemetry, ever.

Tobari does not claim to make you invisible. It gives you something you
close deliberately.

## Phase 1: AI core + extension

Runs end-to-end on Linux inside stock Chrome, Chromium, or Brave. No
browser of our own yet. That is Phase 2.

```
core/        tobari-core sidecar (Rust): supervises llama-server,
             downloads verified GGUF models, serves a native
             messaging host over stdio
extension/   MV3 sidebar chat (TypeScript): page extraction,
             chat-with-page, summarize, explain, rewrite, translate
packaging/   AppImage assembly, native-host installer
docs/        DEV-LINUX.md, PACKAGING.md
```

## Quick start (Linux)

```sh
docs/DEV-LINUX.md      # step one: container setup, required on Bazzite
cargo build --release -p tobari-core
./target/release/tobari-core install
./target/release/tobari-core download
```

Then load `extension/` unpacked in Chrome, Chromium, or Brave and open
the Tobari sidebar.

## Security

See `SECURITY.md`. The short version: llama-server binds to 127.0.0.1
only, a fresh 32-byte bearer token is generated every launch, the token
travels to the extension over native messaging only, and the extension
never fetches localhost from any page context. Any page that could reach
the model endpoint unauthenticated would be a critical bug.

## Platforms

Linux first. macOS builds come from CI only and distribution needs a
paid Apple Developer account for notarization, which does not exist yet.
Windows is out of scope permanently.
