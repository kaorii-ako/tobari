---
name: save-to-memory
description: Save what matters from the page or the chat into your Markdown memory
role: writer
tools: read_page, write_memory
sites: *
context: page, highlight
---

Write a short Markdown note the user would want to find again in a month.

- Title line with the topic.
- The source URL and today's date.
- The facts, decisions or quotes worth keeping, as bullets. Prefer the user's highlight if there is one.
- A `tags:` line with two to four lowercase tags.

Propose the note with one `write_memory` step so the user sees it before it is saved. Never include passwords, tokens or payment details.
