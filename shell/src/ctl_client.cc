// The client half of the CLI. No CEF here: tobari-cli (the Windows console helper) is built from this file,
// util.cc and platform.cc alone.
#include <cstdio>
#include <iostream>
#include <string>

#include "ctl.h"
#include "platform.h"
#include "util.h"

// In the data dir (private to this user), because Chromium's process singleton is per profile too.
std::string CtlPath() { return DataDir() + "/ctl.sock"; }

namespace {

// One request to the running browser. Returns 1 ok, 0 error reply, -1 not running; body gets the reply text.
int Ask(std::string cmd, std::string arg, std::string& body) {
  for (char& ch : arg)
    if (ch == '\n' || ch == '\t') ch = ' ';
  Sock s = SockConnect(CtlPath());
  if (s == kNoSock) return -1;
  SockSendAll(s, cmd + "\t" + arg + "\n");
  std::string out;
  char buf[65536];
  for (long n; (n = SockRecv(s, buf, sizeof buf)) > 0;) out.append(buf, n);
  SockClose(s);
  size_t nl = out.find('\n');
  body = nl == std::string::npos ? out : out.substr(nl + 1);
  return out.rfind("ok\n", 0) == 0;
}

int McpClient() {
  std::string line, body;
  while (std::getline(std::cin, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    if (line.empty()) continue;
    if (Ask("mcp", line, body) < 0) {
      fprintf(stderr, "tobari: the browser isn't running.\n");
      return 1;
    }
    if (!body.empty()) printf("%s\n", body.c_str()), fflush(stdout);
  }
  return 0;
}

}  // namespace

int CtlClient(std::vector<std::string> a) {
  // `tobari --profile=NAME tabs` talks to that profile; main has already applied the switch.
  // a: the arguments after the program name.
  if (!a.empty() && a[0].rfind("--profile=", 0) == 0) a.erase(a.begin());
  if (a.empty()) return -1;
  const std::string& cmd = a[0];
  if (cmd == "mcp") return McpClient();
  if (cmd != "tabs" && cmd != "open" && cmd != "text" && cmd != "close" && cmd != "profile" && cmd != "reopen" &&
      cmd != "burn")
    return -1;
  std::string arg = a.size() > 1 ? a[1] : "";
  if ((cmd == "open" || cmd == "close" || cmd == "profile") && arg.empty()) {
    fprintf(stderr, "usage: tobari [--profile=NAME] tabs | open URL | text [ID] | close ID | reopen | burn | profile NAME | mcp\n");
    return 2;
  }
  std::string body;
  int ok = Ask(cmd, arg, body);
  if (ok < 0) {
    fprintf(stderr, "tobari: the browser isn't running.\n");
    return 1;
  }
  fprintf(ok ? stdout : stderr, "%s%s", body.c_str(), body.empty() || body.back() == '\n' ? "" : "\n");
  return ok ? 0 : 1;
}
