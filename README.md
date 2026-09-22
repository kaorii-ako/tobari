# Tobari (帳)

**A browser that closes over the window.**

A privacy-first Chromium browser for Linux and macOS. Less RAM than stock
Chrome at equal tab count, nothing sent home, and honest about where the
savings come from and what they cost.

Tobari does not claim to make you invisible. It gives you something you close
deliberately. No "untraceable", no "anonymous", no claim we cannot defend in
`SECURITY.md`.

## Status

**Phase 1 has not started.** The browser shell does not exist yet.

The current open question is whether CEF can run the Chrome extensions users
actually need (a password manager, a userscript manager) while still allowing
a custom UI. That decides the shell architecture, so it is being tested before
any shell code is written.

A complete local-AI sidecar and MV3 extension were built under an earlier
brief that ordered the phases the other way around. That work is verified and
kept on the **`phase-3-ai`** branch; it returns in Phase 3. `main` carries no
AI code, by design.

`docs/VALIDATION.md` records **no go/pivot/stop decision**. It holds a Phase 1
waiver from the previous brief, which does not cover a browser competing with
Brave and ungoogled-chromium for the months before Phase 3.

## Phases

| Phase | What | Gate |
|---|---|---|
| 1 | Browser shell on CEF with built-in `adblock-rust` blocking | Daily driver for a week on Wayland; Flatpak; extensions work; RAM measured vs Chrome |
| 2 | Chromium patch set | **Conditional** — only if Phase 1 numbers show a named limit CEF cannot pass |
| 3 | Local AI assistant in the side panel | Browser is a stable daily driver |

## Layout

```
shell/      Phase 1: CEF browser shell (not started)
patches/    Phase 2: patch set against Chromium stable (conditional)
docs/       VALIDATION, DEV-LINUX, DEV-MACOS, PACKAGING, RELEASING
site/       Static marketing site for Netlify — no trackers (not started)
SECURITY.md Threat model and every security tradeoff, stated plainly
```

## Platforms

Linux and macOS. Windows is permanently out of scope.

macOS is **deferred until after Phase 1**: there is no Mac to test on and no
paid Apple Developer account, so a `.dmg` would be Gatekeeper-blocked. Treat
macOS as a build-from-source target. See `docs/DEV-MACOS.md`.

## Build

Linux builds happen inside a distrobox container. Start at
`docs/DEV-LINUX.md` step one. Nothing is ever layered onto the Bazzite host.

## Docs needing rewrite for the new phase order

`docs/PACKAGING.md`, `docs/RELEASING.md` and `docs/DEV-MACOS.md` were written
when Phase 1 shipped an AppImage carrying an AI sidecar. Flatpak is now the
primary format and the payload is a browser. `SECURITY.md` still describes the
Phase 3 prompt-injection design.
