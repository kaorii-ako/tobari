# DEV-MACOS — CI-built only

There is no Mac on the dev side. macOS builds are produced by GitHub
Actions `macos-14` runners (arm64, matching the supported minimum of
macOS 13 Ventura on Apple Silicon) and cannot be interactively debugged.

## Phase 1 status: build-from-source target

Phase 1 ships Linux only. The macOS-specific surface (process-group kill
on `SIGTERM`/`SIGINT`, `~/Library/...` paths, manifest install paths,
Metal backend selection) is kept minimal and is covered by CI compilation,
not by runtime testing.

## Signing and notarization

Distribution as a `.dmg` that users can double-click requires notarization,
which requires a paid Apple Developer account ($99/yr). That account does
not currently exist. Consequences, stated plainly:

- CI produces a **compile smoke test only** on `macos-14`; it builds the
  sidecar and runs `--version`. It does not produce a `.dmg` artifact,
  because nothing in that artifact has ever run on a Mac.
- Without notarization, Gatekeeper blocks the app on first launch and
  users need `xattr -d` incantations. That is not a shippable form.
- Until a notarization path exists, macOS is a **build-from-source
  target**. The README will say so rather than shipping a `.dmg` that
  looks broken.

Revisit in Phase 2: either the account exists and `.dmg` becomes a real
target, or macOS stays build-from-source.
