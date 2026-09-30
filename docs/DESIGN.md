# Tobari — visual system

Normative. Supersedes the `shell/DESIGN.md` that exists at commit `7fc1749`,
which described a direction that was never built and which the shipped chrome
contradicts on nearly every point.

## Point of view

Tobari feels like a precision instrument at rest: matte, dimensionally flat,
information held at exact distances, nothing competing for attention while you
read a page. It refuses to feel like software that wants to be used — no
gradient as identity, no glass, no bounce, no floating card, no element that
draws the eye without carrying information.

The name is the curtain drawn at nightfall. The chrome is the curtain rail:
you should stop noticing it within a day.

## Typography

**IBM Plex Sans** for interface text, **IBM Plex Mono** for machine data.
Both OFL, both bundled as latin `woff2` subsets in `shell/ui/fonts/` — the
browser makes no network request to render its own interface.

Plex was drawn as an engineering typeface. Its squared terminals, low stroke
contrast and slightly mechanical rhythm read as instrumentation. Inter and the
system humanist faces read as consumer-friendly, which is the opposite of the
register this product wants, and Inter in particular is the default that makes
an interface look like every other interface.

Mono is not decorative here — it marks anything the machine produced rather
than anything a person wrote: URLs, schemes, bang tokens, counters, key hints,
readout values. Typeface carries meaning.

### Scale

Tight at chrome sizes where a pixel is visible, opening toward a 1.2 ratio at
display sizes.

| token | px | use |
|---|---|---|
| `--fs-100` | 10.5 | micro caps labels, counters |
| `--fs-200` | 11.5 | tab titles, secondary |
| `--fs-300` | 12.5 | interface default |
| `--fs-400` | 13.5 | emphasis, new-tab input |
| `--fs-500` | 15 | — |
| `--fs-600` | 17 | — |
| `--fs-700` | 21 | — |
| `--fs-800` | 28 | — |
| `--fs-900` | 38 | new-tab wordmark |

Line height `--lh-tight` 1.2 / `--lh-base` 1.45 / `--lh-loose` 1.62.
Tracking `--track-tight` -0.011em for sans, `--track-normal` 0 for mono,
`--track-caps` 0.09em for micro caps.

## Colour

Monochrome chrome, one signal. The interface is a neutral ink ramp; colour
appears only where it means something. The identity comes from typography,
density and restraint — not from a brand hue smeared across surfaces.

The single accent is a muted vermilion (朱色), used at exactly three places:
the focus ring, the active-tab hairline, and a live block counter. It is never
a background, never a gradient, never decoration.

| token | night | daybreak | role |
|---|---|---|---|
| `--ink-000` | `#0a0a0c` | `#faf9f7` | window base |
| `--ink-050` | `#0f0f12` | `#f2f1ee` | chrome |
| `--ink-100` | `#141418` | `#ffffff` | surface, overlays |
| `--ink-200` | `#1b1b20` | `#eceae6` | raised, active tab |
| `--ink-300` | `#23232a` | `#e2e0db` | hover |
| `--line-hair` | `#1e1e25` | `#e4e1db` | internal division |
| `--line-firm` | `#2b2b34` | `#d3cfc7` | overlay edge |
| `--fg-0` | `#f2f2f5` | `#17171a` | primary text |
| `--fg-1` | `#b9b9c4` | `#43434b` | secondary text |
| `--fg-2` | `#8f8f9c` | `#61616b` | tertiary text |
| `--fg-3` | `#6a6a77` | `#80808b` | non-informational only |
| `--signal` | `#ff6b3d` | `#b23410` | focus, active, live count |
| `--secure` | `#7fb894` | `#2f6b4a` | https |
| `--warn` | `#d9a441` | `#8a6212` | http |
| `--danger` | `#e0574f` | `#b3302a` | destructive |

### Measured contrast

Worst case for each informational token against **every** backdrop it can sit
on (`--ink-000/050/100/200`), computed in `scripts/contrast.py`:

| token | night | daybreak |
|---|---|---|
| `--fg-0` | 15.35:1 | 14.89:1 |
| `--fg-1` | 8.82:1 | 8.16:1 |
| `--fg-2` | 5.37:1 | 5.10:1 |
| `--signal` | 6.06:1 | 5.15:1 |
| `--secure` | 7.50:1 | 5.26:1 |
| `--warn` | 7.63:1 | 4.56:1 |
| `--danger` | 4.61:1 | 5.18:1 |

Every one clears WCAG AA for normal text in both themes. `--fg-3` sits at
3.22:1 / 3.25:1 and is therefore restricted to borders, icon strokes and
decorative glyphs — it never carries information.

## Space, radius, border, elevation

Spacing is a 2/4/6/8/12/16/20/24/32/40/56 ramp (`--sp-1` … `--sp-12`).

Radii are deliberately small: `--r-xs` 2, `--r-sm` 3, `--r-md` 5, `--r-lg` 8,
`--r-full`. Instruments have tight corners; `rounded-2xl` is the tell of the
generic look this system rejects.

Borders are a single hairline (`--bw` 1px). There is exactly **one** elevation
(`--shadow-overlay`), used only by surfaces that float above the page —
the omnibox dropdown and the menu. Nothing else casts a shadow.

## Motion

Durations and easings are tokens; no animation in the shell uses a literal.

| token | ms | use |
|---|---|---|
| `--dur-1` | 90 | state change, hover |
| `--dur-2` | 160 | enter/exit of small elements |
| `--dur-3` | 240 | panel |
| `--dur-4` | 420 | curtain, wordmark |

Easings: `--ease-out`, `--ease-in`, `--ease-inout`, `--ease-snap`. There is no
spring and no overshoot anywhere. An instrument does not bounce; the previous
chrome used `cubic-bezier(0.34, 1.56, 0.64, 1)`, which is where a lot of its
consumer-app feel came from.

Under `prefers-reduced-motion`, every duration token becomes `0ms` and the
JavaScript takes the instant branch — state changes, never slower motion.

### Enforced performance rules

- GSAP animates `transform` and `opacity` only. The previous chrome animated
  `flex-basis`, `min-width` and `padding` on tab open/close — layout thrash on
  a shared flex container, on every tab event. Tabs now fade and scale; width
  resolves in one reflow.
- **The GSAP ticker is put to sleep when no tween is active.** GSAP holds a
  `requestAnimationFrame` loop open by default, which is a continuous render
  loop in the chrome. `motion.js` calls `gsap.ticker.sleep()` once the global
  timeline is empty and `wake()` before any animation. Measured: idle CPU fell
  from 8.00% to 0.50% of one core.
- Every repeating tween is registered and killed on unmount. Tab spinners are
  keyed per tab and cleared on re-render; nothing survives on a detached node.
- Repeating tweens pause on window blur.

## The chrome is the window

The window is frameless (`CefWindowDelegate::IsFrameless`). There is no
separate OS title bar above the chrome — the tab strip *is* the title bar, with
minimise / maximise / close at its right edge and a drag zone between them and
the new-tab button.

CEF does not fire `OnDraggableRegionsChanged` for a Views `CefBrowserView`, so
the `-webkit-app-region` CSS path is inert here. The header for `IsFrameless`
says the intended path is for the client to call
`CefWindow::SetDraggableRegions()` directly, so the UI computes its own
regions — the whole chrome as draggable, minus a non-draggable rect per
interactive cluster — and pushes them over the existing IPC on load, resize,
state change and whenever an overlay opens or closes. The CSS is kept as well,
harmless, in case CEF wires the callback later.

## Density

The chrome is **72px**: a 30px tab strip and a 34px toolbar. The previous
build was 84px, below an OS title bar that no longer exists. Counting the
title bar it replaces, the window gives back roughly 40px of page height.

It earns the rest of its height by never needing a second row: the omnibox
carries scheme state, bang state and the block counter inline, and the side
panel is the only surface that can grow. When the omnibox dropdown opens the
chrome grows to fit it and returns to 72px when it closes.

## Surfaces are separate browser views

The chrome is a 72px browser view at the top of the window; the side panel is a
**second** browser view docked to the right of the content area, not part of the
chrome document. The first build put the panel inside the chrome document, where
`position: fixed` clipped it to the 72px strip — an HTML surface cannot paint
outside the browser view that hosts it.

The window layout is therefore a vertical box of [chrome, body], where body is a
horizontal box of [content, panel]. The panel wrapper is a fixed-width panel
(320px) toggled with `SetVisible`, so a closed panel costs no layout and no
paint.

The omnibox dropdown has the same constraint and takes the other available
answer: it stays in the chrome document and the chrome grows to fit it, then
returns to 72px. That is acceptable for a transient overlay and wrong for a
persistent panel, which is why they differ.

## Blocking

`adblock-rust` (the `adblock` crate, the engine Brave ships) is compiled as a
Rust `staticlib` in `blocker/` and linked into the C++ binary through a small C
ABI. Cargo is driven from CMake, so the whole thing builds with one
`cmake --build`.

It runs in `CefResourceRequestHandler::OnBeforeResourceLoad` and returns
`RV_CANCEL`, which cancels the request *before* it loads. For a third-party
subframe that means the renderer process is never created — that is where the
memory saving comes from, not from the bytes not transferred. Main-frame
navigations are never blocked, and `tobari://`, `data:`, `blob:` and `about:`
are skipped.

Lists: EasyList, EasyPrivacy and uBlock Origin's `filters` and `privacy` —
**141,987 rules**. They load from `$XDG_DATA_HOME/tobari/filters/` if present,
else from the copy staged beside the binary. `scripts/update-filters.sh`
refreshes them and writes `SHA256SUMS`; updates are plain GETs carrying no
identifier.

The shield in the omnibox shows the live count for the current page and toggles
blocking per host; the count resets when the host changes. Measured cost of the
resident engine: **+5 MB PSS**.

## New-tab page

The only surface where Lenis and Vanta are permitted, and the only place the
design is allowed to be expressive.

It is deliberately not a centred hero: an asymmetric two-column fold, the 帳
glyph as a quiet 6%-opacity mark, the wordmark revealed per-character, a mono
command line, and an instrument readout (`bangs / engine / telemetry`). Below
the fold is the full bang index as a dense hairline-ruled two-column list —
an index page, not a grid of cards.

`react-bits` components were used as the starting point for three effects —
split-text reveal, decrypt/scramble text, magnetic hover — and reimplemented
against these tokens without React. Rationale in the README.

### Measured cost

| configuration | PSS | idle CPU |
|---|---|---|
| defaults, no blocker | 373.3 MB | 0.50% of one core |
| defaults + adblock engine resident | 378.2 MB | 0.30% of one core |
| Lenis on | — | 4.80% of one core |
| Vanta on, visible | 401.3 MB | 4.00% of one core |
| Vanta on, suspended | 403.8 MB | 1.10% of one core |

Both are **off by default** because both cost measurable idle CPU. Vanta
lazy-loads three.js only when enabled, so 615 KB never enters the page
otherwise, and is destroyed outright on blur or tab-hide rather than paused,
because Vanta exposes no frame-rate cap.

## Accessibility

- Every interactive element has a designed focus state: a 2px `--signal`
  outline at 2px offset via `:focus-visible`. The previous chrome had none and
  actively removed the ring from the omnibox with `outline: none`.
- The tab strip is a real `role="tablist"` of `<button role="tab">` with roving
  tabindex; `←`/`→` move between tabs and `Delete` closes the focused one.
- The omnibox is a `role="combobox"` wired to the dropdown with
  `aria-expanded` and `aria-activedescendant`.
- Contrast is measured, not asserted; see the table above.
- Motion never carries information on its own — every animated state also has
  a static representation (`aria-selected`, `aria-pressed`, text, colour).
