# Product Hunt listing (draft, not posted)

Claims here are limited to what the repo's tests show. Add RAM/speed numbers only from `bench/` output.

**Name:** Tobari

**Tagline (60 max):** A private browser your AI agents can drive

**Description (260 max):** Tobari is a fast, private Linux browser with an assistant that runs on your own model, a
command bar that does maths and bangs, and a built-in MCP server so Claude Code or Cursor can read, click and
screenshot your tabs. No account. No telemetry. Thai and Japanese render correctly.

**Topics:** Web App, Privacy, Artificial Intelligence, Developer Tools, Open Source

**First comment (maker):**
I wanted a browser that was private by default and still did the useful AI things. So Tobari:
- Runs the assistant on your own model (Ollama, llama.cpp, LM Studio) or your own key. Nothing is sent until you ask.
- Lets agents drive it: `tobari mcp` exposes tabs, read, click, fill and screenshot over MCP. Every agent action shows a toast.
- Asks across tabs: tick "All tabs" and question up to 8 pages at once.
- Has a command bar: Alt K for commands, tabs, history, bangs (`!gh`, `!wth`), `12*(3+4)`, `5 km in mi`.
- Screenshots and annotates: pen, box, arrow, pixelate-to-hide, then save or copy.
- Profiles with separate logins, tracker blocking, HTTPS-only mode.
Linux AppImage today (signed). Windows and macOS are not ready; I will not ship them untested.
What would you want an agent to do in your browser?

**Gallery (1270x760):** 1 hero with command bar; 2 agent driving a page via MCP; 3 ask across tabs; 4 annotate; 5 privacy panel.
