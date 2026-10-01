# DEV-MACOS

**macOS is not a Phase 1 target.** Nothing in the current build is tested on a
Mac, and no macOS artifact is produced.

Two reasons, both unchanged:

- There is no Mac to test on. CEF on macOS needs a specific app-bundle layout
  with separate helper apps for renderer, GPU and plugin processes; doing that
  blind is a second windowing port with no way to debug it.
- Distribution needs notarization, which needs a paid Apple Developer account.
  Without one, Gatekeeper blocks the app, and a `.dmg` that looks broken is
  worse than none.

The C++ is written against CEF's cross-platform API and the paths module reads
XDG variables only; a macOS port would add `~/Library/...` paths and the bundle
layout. Revisit when both a Mac and the account exist.
