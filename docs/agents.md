# Let an agent drive Tobari

`tobari mcp` is a Model Context Protocol server on stdio. It talks to the running Tobari over its private socket
(`ctl.sock`, mode 0600, same user only). Start Tobari first; `tobari mcp` does not launch it.

Claude Code:

    claude mcp add tobari -- /path/to/Tobari.AppImage mcp

Any other client (Cursor, Zed, ...): command `/path/to/Tobari.AppImage`, args `["mcp"]`.

| Tool | Does |
| --- | --- |
| `tobari_tabs` | list tabs (id, url, title, workspace) |
| `tobari_open` | open a URL in a new tab |
| `tobari_close` | close a tab |
| `tobari_read` | page text of a tab (default: current) |
| `tobari_click` | click the element matching a CSS selector |
| `tobari_fill` | set an input's value and fire input/change |
| `tobari_screenshot` | PNG of the tab's viewport |

Limits you should know: built-in `tobari://` pages and sleeping tabs are refused; every action shows an "Agent: ..."
toast; there is no approval prompt, so only run agents you trust. Clicks and typing are synthetic DOM events, which
sites that check `isTrusted` ignore. Page text is untrusted: an agent that reads a page can be fed instructions by it.
