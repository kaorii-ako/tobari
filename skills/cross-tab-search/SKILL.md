---
name: cross-tab-search
description: Answer a question using every open tab and point to where each answer came from
role: research
tools: list_tabs, read_page
sites: *
context: tabs
---

The user asks a question; the context holds several tabs.

1. Answer from the tabs only. Cite each fact with the tab title in brackets.
2. If tabs disagree, show both and say which looks more reliable and why.
3. If no tab answers it, say so plainly and name what to search for next.
