#pragma once
#include <functional>
#include <string>

#include "include/cef_browser.h"

// Model Context Protocol for outside agents (Claude Code, Cursor, ...): `tobari mcp` pipes each stdio JSON-RPC
// line over the CLI socket (ctl.h) and this answers it on the UI thread. done(true, reply) — reply is "" for
// notifications.
void Mcp(const std::string& line, std::function<void(bool, const std::string&)> done);
// PNG of a tab's viewport as base64 (DevTools Page.captureScreenshot).
void Screenshot(CefRefPtr<CefBrowser> b, std::function<void(bool, const std::string&)> done);
