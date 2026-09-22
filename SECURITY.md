# Tobari security model

Tobari does not claim to make you invisible. It gives you something you
close deliberately. This document states what Phase 1 guarantees, what it
does not, and where performance and packaging trade against security.

## Guarantees in Phase 1

Local-only inference. The default model runs through llama-server on the
user's own machine. There is no cloud endpoint, no fallback, no account,
no telemetry. If the model cannot load, the feature reports unavailable.

Loopback-only server. llama-server is started with host 127.0.0.1. It
never binds 0.0.0.0. Verify with `ss -tlnp` while the sidecar runs: only
127.0.0.1 entries may belong to us.

Per-launch bearer token. A 32-byte CSPRNG token is generated at every
launch and passed to llama-server as its API key. The extension learns it
only over the native-messaging stdio channel. It is never written to disk
in a page-reachable location, never placed in an environment variable
visible to renderers, never logged.

Pinned native-messaging origin. The manifest's allowed_origins contains
exactly our extension ID. No wildcards.

No page-context localhost fetch. The extension never calls fetch against
127.0.0.1 from any page, content script, or side panel. All model traffic
leaves the extension through chrome.runtime.connectNative to tobari-core,
which proxies to llama-server with the bearer token over loopback.

Verified models. GGUF files are checked with SHA-256 against the pinned
manifest before first use and before every load. A mismatch is a hard
failure: the file is deleted or refused, never loaded with a warning.

No secrets to the model. The actor pass never receives cookies, autofill
data, or password-manager contents.

## Prompt injection architecture

Page content is untrusted input and is handled structurally.

Two-stage split. An extractor pass reads page content with no tool access
and emits JSON against a fixed schema of origin, title, and claims. The
actor pass sees only that structured output, never raw page text.

Origin-scoped capabilities. Work scoped to origin A cannot read tabs,
cookies, or storage belonging to origin B.

Explicit confirmation. Every state-changing action (submit, send, delete,
purchase, cross-origin navigation) requires human confirmation showing the
literal action, not a paraphrase.

## What Tobari does not promise

Not invisibility. Tracker blocking is not fingerprinting resistance. We do
not claim untraceability or anonymity.

Not page-content safety. A malicious page can still try to inject
instructions into summarized or explained text. The two-stage split narrows
that channel; it does not close it. Treat model output about a page as
untrusted.

Not sandboxing in Phase 1. The sidecar runs as the user's own process and
the AppImage runs outside any sandbox so it can reach the user's existing
browser installs. That reach is the point of Phase 1, and it means a
compromised sidecar has the user's privileges. Phase 2 moves the sidecar
inside the Flatpak for exactly this reason.

## Tradeoffs stated plainly

GPU memory. The full default model stays resident in VRAM so browser RAM
is untouched. On machines where it does not fit, we reduce GPU layers and
say so in the UI instead of silently paging or crashing.

CPU fallback. With no usable GPU the sidecar still runs on CPU and says so
visibly. It will be slow. That warning is a requirement, not polish.

Packaging. Phase 1 bundles no Vulkan loader, Mesa, libdrm, or ICD files.
A bundled loader against host drivers can silently fall back to CPU,
destroying the memory story without telling anyone. We link the host stack
and fail loudly when no ICD is present.
