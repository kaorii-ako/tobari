# Tobari — visual system

Normative for every surface Tobari draws. Supersedes earlier versions of this
file, including the custom-chrome design described at commit `e605c0e`.

## Point of view

Tobari feels like a precision instrument at rest: matte, dimensionally flat,
information held at exact distances, nothing competing for attention while you
read a page. It refuses to feel like software that wants to be used — no
gradient as identity, no glass, no bounce, no floating card, no element that
draws the eye without carrying information.

The name is the curtain drawn at nightfall. The browser chrome is the curtain
rail: you should stop noticing it within a day.

## Where the design lives

Tobari's window is Chromium's own: tab strip in the title bar, omnibox,
extension toolbar. That was not the first plan. The first builds drew their own
chrome in HTML, and it looked the way this document wanted. It could not have
extensions, and that turned out to be a hard limit of CEF rather than a missing
feature:

- An Alloy-style window can host only Alloy-style browser views, which have no
  Chrome extension system.
- A Chrome-style window can host at most one Chrome-style browser view **for its
  lifetime**. Measured on CEF 154: after the first, every further one is refused
  with `Cannot add multiple Chrome style BrowserViews`, even once the first has
  been detached. Swapping one view per tab in and out of a window is not
  possible.

Custom HTML chrome, real multi-tab and Chrome extensions cannot coexist in CEF.
Extensions — password managers above all — decide whether a browser can be used
every day, so the custom chrome went. The system below now applies to the
surfaces Tobari still owns, and to Chromium's chrome through the one channel
Chromium exposes for it, its palette.

| surface | how the system reaches it |
|---|---|
| Browser chrome | Chromium palette set on first run: dark, grayscale |
| New-tab page | Bundled extension overriding `chrome://newtab`, built from these tokens |
| Blocking popup | Bundled toolbar extension, built from these tokens |
| App icon | Drawn from the same ink, foreground and signal |
| tobari.dev | Built from these tokens |

### Browser chrome

Chromium's theme engine generates its whole palette from a seed. The obvious
seed — the vermilion signal with the "neutral" variant — produced a warm brown
toolbar that fought the cool ink of the new-tab page. **Grayscale** keeps the
chrome monochrome, which is what this system asks for anyway: the signal colour
belongs in content, not in the frame.

Chromium on Linux otherwise follows the GTK theme, which would override any
palette with the desktop's, so first run selects Chromium's own. Those keys are
written into the profile's `Preferences` before CEF starts: the theme service
applies them only to windows created after it reloads, and setting them through
the API alone left the first window half light.

Chromium's own branding is replaced where CEF allows it: the product name and
window-title format are overridden (`Name - Tobari`), the window class is
`dev.tobari.Browser`, and the avatar button, the new-tab footer and every menu
item or page action that fronts a Google service are hidden.

## Typography

**IBM Plex Sans** for interface text, **IBM Plex Mono** for machine data. Both
OFL, bundled as latin `woff2` subsets — nothing Tobari draws makes a network
request for a font.

Plex was drawn as an engineering typeface; its squared terminals and low stroke
contrast read as instrumentation. Mono marks anything the machine produced
rather than anything a person wrote: URLs, bang tokens, counters, readouts.

| token | px | use |
|---|---|---|
| `--fs-100` | 10.5 | micro caps labels, counters |
| `--fs-200` | 11.5 | secondary |
| `--fs-300` | 12.5 | interface default |
| `--fs-400` | 13.5 | emphasis, new-tab input |
| `--fs-500` | 15 | popup host name |
| `--fs-900` | 38 | wordmark, popup count |

Line height `--lh-tight` 1.2 / `--lh-base` 1.45 / `--lh-loose` 1.62.

## Colour

A neutral ink ramp and one signal. Colour appears only where it means
something. The accent is a muted vermilion (朱色) used for focus rings, the
blocking switch, the badge and a few single marks — never a background, never a
gradient.

| token | night | daybreak | role |
|---|---|---|---|
| `--ink-000` | `#0a0a0c` | `#faf9f7` | base |
| `--ink-100` | `#141418` | `#ffffff` | surface |
| `--ink-200` | `#1b1b20` | `#eceae6` | raised |
| `--fg-0` | `#f2f2f5` | `#17171a` | primary text |
| `--fg-1` | `#b9b9c4` | `#43434b` | secondary |
| `--fg-2` | `#8f8f9c` | `#61616b` | tertiary |
| `--fg-3` | `#6a6a77` | `#80808b` | non-informational only |
| `--signal` | `#ff6b3d` | `#b23410` | focus, active, live count |

### Measured contrast

Worst case for each informational token against every backdrop it can sit on,
from `scripts/contrast.py`:

| token | night | daybreak |
|---|---|---|
| `--fg-0` | 15.35:1 | 14.89:1 |
| `--fg-1` | 8.82:1 | 8.16:1 |
| `--fg-2` | 5.37:1 | 5.10:1 |
| `--signal` | 6.06:1 | 5.15:1 |

All clear WCAG AA for normal text in both themes. `--fg-3` (3.22:1 / 3.25:1)
never carries information.

## Space, radius, elevation, motion

Spacing `--sp-1`…`--sp-12` on a 2/4/6/8/12/16/20/24/32/40/56 ramp. Radii are
small (`2/3/5/8px`); `rounded-2xl` is the tell of the generic look this rejects.
One hairline border, one elevation, used only by surfaces that float.

| token | ms | use |
|---|---|---|
| `--dur-1` | 90 | state change |
| `--dur-2` | 160 | small enter/exit |
| `--dur-3` | 240 | larger surfaces |
| `--dur-4` | 420 | wordmark reveal |

No spring, no overshoot. Under `prefers-reduced-motion` every duration becomes
`0ms` and scripts take the instant branch.

**Animation never runs while idle.** GSAP holds a `requestAnimationFrame` loop
open even with no tweens; `motion.js` sleeps its ticker whenever the timeline is
empty. Measured on the earlier shell: idle CPU fell from 8.00% to 0.50% of one
core. GSAP animates `transform` and `opacity` only.

## New-tab page

The one surface allowed to be expressive. An asymmetric fold, not a centred
hero: the 帳 glyph as a quiet mark, the wordmark revealed per character, a mono
command line that resolves bangs locally, and a readout (`bangs / engine /
telemetry`). Below the fold, the full bang index as a hairline-ruled list.

Smooth scrolling (Lenis) and the animated background (Vanta) are both **off by
default** because both cost measurable idle CPU — 4.3% and 3.5% of a core on
the earlier shell. Vanta lazy-loads three.js only when enabled and is destroyed,
not paused, on blur. `react-bits` effects (split text, scramble, magnetic hover)
are reimplemented with GSAP against these tokens rather than shipping React.

## Blocking popup

A readout, not a dashboard: the site, a large mono count of requests blocked on
this page, a switch for the site, and a three-column strip of session total,
rule count and list age. The toolbar badge carries the same count in the signal
colour so the popup rarely needs opening.

## App icon

The ink square, 帳 in Noto Serif CJK, and one vermilion hairline above it — the
mark the original tab strip used for the active tab, read here as the curtain
rail. Below 48px a serif hairline dissolves into grey, so 16–48px are drawn
separately from a heavier sans glyph at a larger size rather than downscaled.
`shell/icons/render-icon.py` renders every size.

## Correction

An earlier version of this file and of commit `5ec156e` stated that CEF does not
fire `OnDraggableRegionsChanged` for a Views browser view. That was wrong. The
logging used to check it never printed; once replaced, the callback fired as
documented. The conclusion has no bearing on the current build, which has no
custom title bar, but it was published as fact and is corrected here.
