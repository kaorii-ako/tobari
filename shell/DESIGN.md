# Tobari shell — visual direction proposal (Phase 2, decision required)

Dark-first, dense, low-chrome. This is a **proposal with reasoning**, not an
implemented theme — no theme system lands before this direction is agreed
(spec §5).

## Direction: "night curtain"

- One dark surface scale derived from the extension panel (`#101014`
  background, `#191920` raised, `#2b2b35` active). No light theme in Phase 2;
  a light theme doubles contrast QA for zero Phase 2 users.
- Chrome occupies a single 36px top strip: back/forward/reload, omnibox,
  panel toggle. Tabs render as a left rail of favicon + close on hover,
  collapsing to icons below 120px — dense by default, matching the "low
  chrome" goal without a separate compact mode to maintain.
- The AI panel is first-class UI (right side, resizable 280–480px), not an
  overlay: same `tobari-ipc` protocol, same sidecar, same extractor→actor
  pipeline as the Phase 1 extension. No second implementation.
- Accent is a single desaturated indigo (`#7aa2f7`, already in the panel
  CSS) used only for focus rings and the active tab marker. One accent
  means one contrast ratio to verify.

## Why this direction

1. It reuses the Phase 1 panel's proven palette instead of inventing a
   second brand surface (spec §3: do not split the brand).
2. Left-rail tabs scale to 30+ tabs where a top strip overflows; overflow
   menus are where tab state gets lost.
3. A single accent keeps WAYLAND fractional-scaling QA tractable: focus
   visibility is tested once, not per-theme.

## Open questions (answer before implementing)

1. Tab rail left (proposal) vs classic top strip?
2. Omnibox: inline autocomplete from history/bookmarks in Phase 2, or plain
   input with navigation only?
3. Panel default: open on launch or closed until toggled?

## Non-goals for the direction

No theme marketplace, no user CSS, no per-site theming. Those are Phase 3+
at the earliest and each is a fingerprinting surface.
