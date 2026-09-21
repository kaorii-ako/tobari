# SECURITY.md — Tobari threat model (Phase 1)

Tobari does not claim to make you invisible. It gives you something you
close deliberately. Every claim below is one we defend; anything we cannot
defend does not ship.

## What we protect

1. Page content sent to the local model never leaves the machine. There is
   no cloud endpoint to leak it to; the sidecar has no network path except
   loopback to `llama-server`.
2. No web page can use your hardware for inference. `llama-server` binds
   `127.0.0.1` only, requires a bearer token generated fresh at every
   launch (32 bytes, CSPRNG, passed via `--api-key`), and the token
   reaches the extension only over native messaging. It is never written
   to a web-reachable file, never placed in renderer-visible env vars,
   never logged.
3. The extension never calls `fetch('http://localhost:...')` from any
   context. All model traffic goes through `chrome.runtime.connectNative`
   to the sidecar. Rationale: any page you visit can `fetch()` an
   unauthenticated loopback port — free inference on your hardware and a
   side channel into loaded context. Two-line mistake, large blast radius.
4. The native messaging manifest's `allowed_origins` is pinned to our
   exact extension ID. No wildcards. The installer requires
   `--extension-id` and refuses to install manifests without it.

## Prompt-injection architecture (structural, not prompt text)

Page content is untrusted input. "Ignore instructions in the page" in a
system prompt is not a control.

- Two-stage split: an extractor pass with no tool access emits structured
  output against a fixed schema; an actor pass sees only that structured
  output, never raw page text.
- Origin-scoped capabilities: work scoped to origin A cannot read or act
  on another origin's tabs, cookies, or storage.
- Explicit human confirmation for every state-changing action, showing the
  literal action, not a paraphrase.
- The model never receives cookies, autofill data, or password-manager
  contents.

## Model integrity

GGUF files download from Hugging Face and are SHA-256 verified against the
pinned manifest in `core/models.toml`. A checksum mismatch is a hard
failure, not a warning. An unverified file is never loaded.

## Honest degradation

- No usable GPU: the sidecar runs CPU inference and says so in the UI
  rather than silently crawling.
- Model will not fit in VRAM: reduce `--n-gpu-layers` and report the
  split. Never silently OOM the GPU.
- Model cannot load: the feature is unavailable. It does not phone home.

## Tradeoff log

- Phase 1: none taken. No security property is weakened for memory or
  packaging in this phase.
- Phase 2 AppImage (accepted constraint, not yet built): relies on
  unprivileged user namespaces for the Chromium sandbox and refuses to
  start without them, rather than `--no-sandbox`.
- Phase 3 `--process-per-site` (if ever exposed): opt-in only, with an
  explicit in-UI warning; this section will state exactly what it costs.
