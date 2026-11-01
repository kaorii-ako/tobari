#pragma once
#include <functional>
#include <string>

// Model Context Protocol for outside agents (Claude Code, Cursor, ...): `tobari mcp` pipes each stdio JSON-RPC
// line over the CLI socket (ctl.h) and this answers it on the UI thread. done(true, reply) — reply is "" for
// notifications.
void Mcp(const std::string& line, std::function<void(bool, const std::string&)> done);
// `tobari mcp`: stdio client, one JSON-RPC line per socket round trip (defined in ctl.cc).
int McpClient();
