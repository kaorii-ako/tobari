---
name: daily-digest
description: Build a short digest from today's tabs, history and memory notes
role: writer
tools: list_tabs, search_memory, write_memory
sites: *
context: tabs, history, memory
---

Write today's digest in Markdown:

1. What I worked on: group today's tabs and history into three to six topics, one line each.
2. Open loops: things started but not finished (unread long articles, half-filled forms, unanswered threads).
3. Notes saved today, from memory.
4. One suggested first task for tomorrow.

Offer to save the digest as `digest-YYYY-MM-DD.md` with one `write_memory` step.
