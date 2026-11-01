# Product Hunt listing (draft, not posted)

Claims here are limited to what the repo's tests show. Add RAM/speed numbers only from `bench/` output.

**Name:** Tobari

**Tagline (60 max):** A private browser your AI agents can drive

**Description (260 max):** A private browser for Linux and Windows. Built-in MCP server so Claude Code or Cursor
can read, click and screenshot your tabs. Assistant on your own model, a command bar that answers, annotate,
and Burn to wipe a session. No account, no telemetry.

**Topics:** Web App, Privacy, Artificial Intelligence, Developer Tools, Open Source

**First comment (maker):**
I wanted a browser that was private by default and still did the useful AI things. So Tobari:
- Runs the assistant on your own model (Ollama, llama.cpp, LM Studio) or your own key. Nothing is sent until you ask.
- Lets agents drive it: `tobari mcp` exposes tabs, read, click, fill and screenshot over MCP. Every agent action shows a toast.
- Asks across tabs: tick "All tabs" and question up to 8 pages at once.
- Has a command bar: Alt K for commands, tabs, history, bangs (`!gh`, `!wth`), `12*(3+4)`, `5 km in mi`.
- Screenshots and annotates: pen, box, arrow, pixelate-to-hide, then save or copy.
- Burns a session: hold one button to wipe cookies, cache, site data and history (bookmarks and settings stay).
- Undo close: a closed tab comes back from the toast or Ctrl Shift T.
- Copy clean link strips tracking parameters (utm_, fbclid, ...).
- Profiles with separate logins, tracker blocking, HTTPS-only mode.
Linux: signed AppImage. Windows: portable zip, unsigned for now, so SmartScreen will warn. macOS: not yet.
What would you want an agent to do in your browser?

**Gallery (1270x760):** docs/producthunt/gallery.html, rendered by `bash docs/producthunt/render.sh` into
docs/producthunt/out/gallery-1..6.png: 1 hero; 2 MCP; 3 command bar; 4 ask tabs; 5 annotate; 6 Burn.
