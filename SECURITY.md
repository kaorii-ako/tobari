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

## How to verify these claims yourself

Every claim above is checkable from a shell. Run these while the panel is
answering a question.

**1. Nothing is listening outside loopback**

```sh
ss -tlnp | grep llama-server
```

The address column must read `127.0.0.1:<port>` and nothing else. A line
showing `0.0.0.0` or `[::]` for `llama-server` is a bug we ship a fix for,
not a configuration choice.

**2. An unauthenticated request is rejected**

```sh
PORT=$(ss -tlnp | sed -n 's/.*127\.0\.0\.1:\([0-9]\+\).*llama-server.*/\1/p' | head -1)
curl -s -o /dev/null -w '%{http_code}\n' "http://127.0.0.1:$PORT/v1/models"
```

Expect `401`. A `200` means any page you visit can use your GPU.

**3. The token is not on disk or in the environment**

```sh
grep -rF "$(cat ~/.local/state/tobari/logs/llama-server.log 2>/dev/null | grep -o 'api-key[^ ]*' | head -1)" ~/.config/tobari 2>/dev/null
```

must find nothing, and `llama-server`'s environment
(`tr '\0' '\n' < /proc/$(pgrep -f llama-server | head -1)/environ`) must not
contain the token. It is passed as `--api-key` on the command line and is
visible in `/proc/<pid>/cmdline` to processes running as your user — that is
the documented, accepted boundary: same-user processes already have your
secrets. No *web* context can read it.

**4. Manifests are pinned to one extension ID**

```sh
grep -h allowed_origins -A1 ~/.config/*/NativeMessagingHosts/dev.tobari.core.json
```

must show exactly `chrome-extension://82e4bde19a6dc64c34b92da4c9c7ec21/`,
with no wildcard. The ID is `SHA-256(SPKI-DER)` of the public key embedded in
`extension/manifest.json`, so it is identical on every install and cannot be
swapped by editing a JSON file at runtime.

**5. The model file is the pinned one**

```sh
sha256sum ~/.local/share/tobari/models/Qwen3-4B-Instruct-2507-Q4_K_M.gguf
```

must equal the `sha256` for that entry in `core/models.toml`. If it does not,
the sidecar refuses to load it and deletes the file rather than warning.

**6. Nothing phones home**

```sh
sudo ss -tnp | grep -E 'tobari-core|llama-server'
```

shows only loopback. Run the whole acceptance flow with the network
interface down; the sidecar makes no outbound connection except the Hugging
Face download you explicitly asked for, which is the only time it touches the
network at all.


- Phase 1: none taken. No security property is weakened for memory or
  packaging in this phase.
- Phase 2 AppImage (accepted constraint, not yet built): relies on
  unprivileged user namespaces for the Chromium sandbox and refuses to
  start without them, rather than `--no-sandbox`.
- Phase 3 `--process-per-site` (if ever exposed): opt-in only, with an
  explicit in-UI warning; this section will state exactly what it costs.
