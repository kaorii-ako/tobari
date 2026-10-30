# Tobari 帳

A web browser for Linux with an assistant that runs on your own GPU.

Tobari's assistant reads the page you're on, your open tabs, PDFs and files, and answers with
a local model (Qwen3 4B Instruct on llama.cpp, Vulkan). Prompts stay on your computer unless you
add a cloud provider with your own API key, and the header of every chat says which one is in use.
There is no Tobari server anywhere in between.

<p>
<img src="docs/screenshots/panel-answer.png" width="280" alt="Panel answering about a page in Japanese and Thai">
<img src="docs/screenshots/panel-confirm.png" width="280" alt="The assistant asking before it clicks">
<img src="docs/screenshots/panel-blocked.png" width="280" alt="A prompt injection on the page being blocked">
</p>

## What works now

- Vertical tabs with tab groups, workspaces, tab search, and tabs that go to sleep when idle.
- Command bar (Alt+K): switch tabs, run commands and skills, search, or ask.
- Ask panel (Alt+J). Type `@` to add the current tab, all tabs, selected text, a picked element, a
  screenshot, bookmarks, history, memory notes, files or PDFs. Type `/` to run a skill.
- An agent that can read, click, type, navigate, extract tables and save files. Every step that
  changes something shows a preview and waits for your OK. You can allow routine steps per site;
  buying, sending, deleting and site tools always ask.
- Prompt injection defense in two stages. Page content is wrapped as untrusted data and can never
  trigger a tool on its own. Each proposed step is then checked against your request: rules block
  password fields, non-http URLs and steps that would leak page data to another site, and an
  optional second model pass reviews the rest.
- Four roles (Research, Operator, Writer, Analyst) and 10 built-in skills. A skill is a folder with
  a `SKILL.md` in `~/.config/tobari/skills`, and any prompt can be saved as one.
- Memory is plain Markdown in `~/.local/share/tobari/memory`: searchable (Japanese and Thai
  included), exportable, never uploaded.
- Providers: local llama.cpp, Ollama, any OpenAI-compatible endpoint, Anthropic, Google. Keys go in
  GNOME Keyring or KWallet. Model files are checked against a pinned SHA-256 before loading.
- The model starts when you ask something and unloads after 5 idle minutes to free VRAM.
- Import from Chrome, Chromium, Brave, Edge, Vivaldi, Firefox and Zen, Flatpak installs included.
- Sites can offer tools to the assistant (MCP); Tobari asks before connecting and before every call.
- Third-party tracker blocking, local crash reports that are only sent if you choose to.
- `tobari` CLI: `open`, `tabs`, `sleep`, `chat`, `skill run --url`, `memory search`, `models`,
  `providers`, `import`.

## Status

Engine: CEF in Chrome style (see `docs/engine-decision.md`). The shell code in `shell/` has not
been compiled yet; until it is, run Tobari as Chromium with the Tobari extension
(`scripts/dev-run.sh`, see `docs/DEV.md`). Japanese and Thai rendering on Bazzite is still an open
risk until `phase0/probe.sh` runs on the target machines. `HANDOFF.md` has the full list.

## Layout

```
core/       tobari: CLI, native messaging host, llama.cpp sidecar, providers, guard, skills, memory, import
extension/  the UI: side panel, new tab, command bar, settings; also the agent loop
skills/     the 10 first-party skills
shell/      CEF Chrome-style browser shell (C++)
bench/      memory benchmark harness (PSS over the whole process tree)
phase0/     Japanese/Thai font probe for the engine decision
packaging/  Flatpak manifest (draft), AppImage script, desktop entry
docs/       engine decision, benchmark results, dev guide, screenshots
v1-archive/ the previous Tobari, kept for reference
```

## Security

`SECURITY.md` in `v1-archive/` still describes the sidecar model, which v2 keeps: llama-server binds
127.0.0.1 only with a fresh 32-byte token from the OS CSPRNG, the token never leaves the core, and the
extension talks to the core over native messaging, never over localhost HTTP. v2 adds a private
control socket (`$XDG_RUNTIME_DIR/tobari/control.sock`, mode 0700, peer UID checked) for the CLI.
