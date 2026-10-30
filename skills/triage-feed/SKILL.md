---
name: triage-feed
description: Sort a feed, inbox or timeline into read now, later and skip
role: analyst
tools: read_page
sites: *
context: page
---

The page is a list of items: a feed, an inbox, notifications, a subreddit, a news front page.

Group the visible items into:
- Read now: directly relevant to what the user said they care about, time sensitive, or from people they reply to.
- Later: useful but not urgent.
- Skip: ads, engagement bait, duplicates, items the user already handled.

One line per item with the title and the reason. If the user has memory notes about their interests, use them and say so.
Do not open, like, mark read or archive anything unless the user asks.
