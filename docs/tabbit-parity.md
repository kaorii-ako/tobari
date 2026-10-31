# Tabbit parity checklist

Source: tabbit.ai home page and the Tabbit CLI quick-start blog post, read 2026-10-30; home page and What's New (v1.19, 2026-10-23) re-read 2026-10-31.
Status values: **built** (with a test or a recorded run), **not built**, **different** (on purpose, with the reason).
This file changes only when a test or a real run backs the change. Screenshots are in docs/screens/.

## Layout

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Vertical tabs on the left, nav and address bar at the top of the sidebar | built | Nav and address bar run across the top of the card instead. browse-*.png |
| Page shown as a rounded card on a tinted background | different | Different: square corners, because CEF overlays can't clip to a radius (see docs/engine-decision.md). Tobari uses its own tokens and colours |
| AI panel on the right as its own card, resizable, one shortcut | built | Alt+J. Panel only; the assistant is Step 4. assistant-*.png |
| Workspaces | built | Switcher at the bottom of the sidebar |
| Split view | built | Alt+\\. split-*.png |
| Command bar | built | Alt+K. command-*.png |
| Compact mode (sidebar shows on hover) | built | Alt+S. compact-*.png |

## Context ("@ anything")

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Current page | not built | |
| All tabs | not built | |
| Screenshots | not built | |
| Highlights | not built | |
| Picked HTML element | not built | |
| Local files | not built | |
| PDFs | not built | |
| Bookmarks | not built | |
| "Tab graves" (closed tabs) | not built | Tobari reads recently closed tabs from history |

## Harness

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Skills, run with / or @ | not built | Folder with SKILL.md in ~/.config/tobari/skills |
| Prompt → Skill | not built | |
| 2000 site skills | different | Tobari ships 10 first-party skills. A catalogue of 2000 site skills is a content business, not browser code |
| Bilibili, danmaku and podcast skills | different | Site-specific. Users can add them as their own skills |
| Agent roles: Research, Operator, Writer, Analyst | not built | |
| Site MCPs | not built | Permission prompt per site and per call |
| Agent memory | not built | Plain Markdown in ~/.local/share/tobari/memory |
| Agent read, click, type, navigate | not built | Confirm before any change, per-site allowlist |
| CLI for outside agents (Codex, Claude Code), skill installed into ~/.agents/skills | not built | Tobari's CLI also opens URLs, lists tabs, runs skills headless and queries memory |

## Models

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Hosted frontier models (GPT, Claude, Gemini, Kimi, GLM, DeepSeek, Qwen…) | different | Bring your own key: Anthropic, Google, OpenAI-compatible, Ollama. No Tobari relay or account |
| Prompts routed through Tabbit's partner servers in Singapore or your region | different | Tobari sends prompts straight to the provider you pick, or keeps them on the device |
| Header shows the active model and where the prompt goes | not built | |
| Local model | different (Tobari only) | llama.cpp on Vulkan, Qwen3 4B Instruct Q4_K_M, downloaded only when asked, SHA-256 pinned |
| Free, Standard and Pro usage plans | different | No plans or quotas. Keys and local compute belong to the user |

## Tabs

| Tabbit feature | Status | Note |
| --- | --- | --- |
| AI tab grouping and clustering | not built | |
| Tab groups | not built | |
| Sleeping tabs | built | Hidden tabs sleep after 30 minutes; restored tabs start asleep |

## Import

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Import history, bookmarks, extensions, settings | not built | Chrome, Chromium, Brave, Edge, Vivaldi and Firefox, native and Flatpak installs, read-only |
| Import from Safari | different | Safari doesn't exist on Linux |

## Data, updates, crashes

| Tabbit feature | Status | Note |
| --- | --- | --- |
| History, bookmarks and chats encrypted on the device | not built | |
| Optional sync through cloud providers | not built | Off by default |
| Background updates | not built | AppImageUpdate or zsync |
| Crash reports | not built | Written locally, sent only after the user reads and approves them |
| SOC 2 Type I | different | Company certification, doesn't apply to a local-only app |

## Seen on Tabbit 2026-10-31, not in the original list

| Tabbit feature | Status | Note |
| --- | --- | --- |
| Search box at the top of the tab list | not built | The command bar searches open tabs |
| Tab groups with a colour dot and count in the sidebar | not built | |
| New tab page centred on a chat box | not built | Step 4 |
| Ask several models at once and compare | not built | |
| Chat mode and Agent mode, with a card explaining the switch | not built | Step 4 roles cover this |
| Screenshot tool with scrolling capture and annotations | not built | |
| Video subtitle transcription and translation (Bilibili, YouTube) | different | Needs a speech model; out of scope for 0.5.0 |
| Linux build (nav shows "Linux NEW") | — | The /linux link redirected to the home page, so what they ship wasn't checked |

## Tobari only (Tabbit has none of these)

| Feature | Status |
| --- | --- |
| Wayland, KDE and GNOME, AppImage | built (GNOME Wayland and headless cage only; KDE not run) |
| Works fully offline | not built |
| Network-layer blocking: EasyList, EasyPrivacy, uBO lists, per-site switch and count | built (host rules only; bench/privacy-test blocks_ads) |
| HTTPS-Only, third-party cookies blocked, WebRTC limited, device APIs blocked by default | built (bench/privacy-test 7/7, bench/https_test.sh 3/3) |
| !bangs resolved on the device | built (util_test) |
| Idle network capture showing nothing sent home | built (bench/idle_net.sh; idle: 0 hosts, also checked in CI) |
| No AI process until first use, model unloads when idle | not built |
| Built-in pages: about, blocking, bangs, AI, setup | about, blocking, bangs built; AI and setup not built |
