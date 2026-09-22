# DEV-MACOS — deferred to Phase 2

## Decision (locked)

**macOS is deferred to Phase 2. It is not a Phase 1 target.**

What that means concretely, so the deferral is a boundary and not a mood:

- The `macos-14` CI compile smoke **stays**. It is cheap and it stops the
  macOS code paths from bit-rotting silently. Losing compilation is how a
  deferred platform becomes a dead platform.
- **No new macOS-conditional code is written** until the deferral lifts.
  Existing `#[cfg(target_os = "macos")]` blocks are maintained where they
  already exist; new ones are not added to land a Phase 1 feature.
- **No `.dmg` is produced or attached to a release** (`docs/RELEASING.md`).
- macOS is documented as a **build-from-source target** in the README.

Why defer rather than drop: Phase 1 ships a sidecar that has to install
itself into somebody else's browser. On Linux that is already the hardest
part of the phase — it is where the Flatpak native-messaging problem lives
(`docs/PACKAGING.md`). Doing that integration blind, on a platform with no
test machine, buys nothing shippable. Phase 2 ships a browser we control end
to end, where macOS is a build target rather than an integration problem, and
that is the cheaper place to re-enter.

The deferral lifts when **both** hold: a Mac exists for interactive testing,
and a paid Apple Developer account exists for notarization. One without the
other is not enough — see "Signing and notarization" below.

## Why there is no Mac in the loop

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
