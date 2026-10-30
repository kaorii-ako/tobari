# Shell layout

What the CEF shell has to build. The extension page `window.html` is a working preview of
the same layout: open `chrome-extension://dbpaojilndlchffoodnamfgjccblnpoe/window.html?url=<page>`
(add `&split=<page>` for split view). Screenshots: `docs/screenshots/window-layout.png`,
`window-split.png`, and the `dark/` versions.

## Window

```
┌──────────┬──────────────────────────────┬─┬───────────────┐
│ sidebar  │ page card        (page card) │ │ assistant card│
│ 256 px   │ flex, 8 px gaps, radius 12   │6│ 300–560 px    │
│ chrome bg│                              │ │ radius 12     │
└──────────┴──────────────────────────────┴─┴───────────────┘
```

- Window background is `--chrome` (#e9e6df light, #0b0d10 dark). No title bar: the sidebar's
  top row carries back, forward and reload, so window controls go in the sidebar too
  (client-side decorations on Wayland).
- Sidebar: a `CefBrowserView` loading `sidepanel.html?mode=tabs&window=<id>`, transparent
  background.
- Page area: one `CefBrowserView` per visible page, in a horizontal box panel with an 8 px gap,
  12 px corner radius and a shadow. Split view puts two side by side with a draggable divider.
- Assistant: a `CefBrowserView` loading `sidepanel.html?mode=ask&window=<id>`, 6 px resize
  gutter, width stored per profile.
- Toggle the assistant with Alt+J. Toggling the sidebar (Ctrl+Shift+B, compact mode) leaves only
  the page card and a hover strip on the left edge.

## The open question to settle first

The extension uses `chrome.tabs` for everything (tab list, active tab, agent tools). That only
stays correct if the shell's page area is a real Chrome tab strip with its UI hidden:

- **Plan A:** the page area is a Chrome-style `CefBrowserView` with `CEF_CTT_NONE`. Chrome's own
  tab model keeps managing tabs, so `chrome.tabs` keeps working unchanged. Test with the pinned
  CEF: does Ctrl+T / `chrome.tabs.create` add a tab inside the same view, or open a new top-level
  window? If it stays in the view, take this plan.
- **Plan B:** the shell owns tabs (one `CefBrowserView` per tab, show the active one) and
  reports them to the extension through the core over native messaging. This means adding a
  `lib/browser.ts` adapter so the UI stops calling `chrome.tabs` directly. It's more work, but it
  is the only way to get true split view if Plan A's view can show just one tab.

Split view is the first feature after the shell compiles, so the test above decides it.
