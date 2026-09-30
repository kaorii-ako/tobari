# Tobari (帳)

**A browser that closes over the window.**

A privacy-first Chromium browser for Linux and macOS. Less RAM than stock
Chrome at equal tab count, nothing sent home, and honest about where the
savings come from and what they cost.

Tobari does not claim to make you invisible. It gives you something you close
deliberately. No "untraceable", no "anonymous", no claim we cannot defend in
`SECURITY.md`.

## Status

**Phase 1 in progress.** The browser shell runs: a CEF 154 window with its own
chrome (tab strip, omnibox, side panel, menu, settings), a new-tab page, and
locally-resolved DuckDuckGo-style `!bangs`. The Chromium sandbox stays on.

Built and measured on Bazzite / Wayland, 2026-09-30:

| | |
|---|---|
| Chrome UI | vanilla ES modules + GSAP, no framework, no bundler |
| UI payload | 245 KB total incl. bundled fonts (three.js lazy, opt-in only) |
| Idle CPU | 0.50% of one core, GSAP ticker asleep |
| Idle memory | 373 MB PSS across 11 processes |
| Contrast | every informational token clears WCAG AA in both themes |

Not yet done in Phase 1: `adblock-rust` network blocking (the shield counter is
wired end to end but not yet fed by a real engine), bookmarks/history/reading
persistence, and the RAM benchmark against stock Chrome that decides whether
Phase 2 happens.

**Known constraint, from CEF's own headers:** an Alloy-style window can host
only Alloy-style browser views, and a Chrome-style window can host *at most one*
Chrome-style browser view. Tobari uses Alloy style to get a custom UI with real
multi-tab, which means Chrome extension support is not available in this
configuration. That is the open architectural question for Phase 1 acceptance.

## Phases

| Phase | What | Gate |
|---|---|---|
| 1 | Browser shell on CEF with built-in `adblock-rust` blocking | Daily driver for a week on Wayland; Flatpak; extensions work; RAM measured vs Chrome |
| 2 | Chromium patch set | **Conditional** — only if Phase 1 numbers show a named limit CEF cannot pass |
| 3 | Local AI assistant in the side panel | Browser is a stable daily driver |

## Layout

```
shell/      Phase 1: CEF browser shell — src/ (C++), ui/ (chrome + new tab)
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

`docs/DESIGN.md` is the normative visual system. `docs/PACKAGING.md`,
`docs/RELEASING.md` and `docs/DEV-MACOS.md` were written
when Phase 1 shipped an AppImage carrying an AI sidecar. Flatpak is now the
primary format and the payload is a browser. `SECURITY.md` still describes the
Phase 3 prompt-injection design.
