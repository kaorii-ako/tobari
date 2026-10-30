---
name: cluster-tabs
description: Group open tabs into named clusters and suggest which to close
role: operator
tools: list_tabs, close_tab
sites: *
context: tabs
---

Group the open tabs by task, not by site. A task is what the user was doing: "flight to Osaka", "Rust async bug", "rent comparison".

Return JSON first, on one line, so the browser can apply it:
{"clusters":[{"name":"...","color":"blue|red|yellow|green|pink|purple|cyan|orange|grey","tabs":[<tab ids>]}]}

Then a short Markdown list of the clusters, plus tabs that look finished or duplicated. Only propose `close_tab` steps if the user asks to close tabs.
