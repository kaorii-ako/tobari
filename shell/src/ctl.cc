#include "ctl.h"

#include <string>
#include <thread>

#include "include/base/cef_callback.h"
#include "include/wrapper/cef_closure_task.h"
#include "platform.h"
#include "shell.h"

namespace {

void Handle(Sock c, std::string cmd, std::string arg) {
  Shell* s = Shell::Get();
  auto reply = [c](bool ok, const std::string& body) {
    SockSendAll(c, (ok ? "ok\n" : "error\n") + body);
    SockClose(c);
  };
  if (!s) return reply(false, "Tobari is still starting.");
  s->Ctl(cmd, arg, reply);
}

}  // namespace

void CtlServe() {
  Sock s = SockListen(CtlPath());
  if (s == kNoSock) return;
  std::thread([s] {
    for (;;) {
      Sock c = SockAccept(s);
      if (c == kNoSock) return;
      SockTimeout(c, 5);
      std::string line;
      char buf[4096];
      long n;
      while (line.find('\n') == std::string::npos && line.size() < 65536 && (n = SockRecv(c, buf, sizeof buf)) > 0)
        line.append(buf, n);
      size_t nl = line.find('\n'), tab = line.find('\t');
      if (nl == std::string::npos || tab > nl) {
        SockSendAll(c, "error\nBad request.");
        SockClose(c);
        continue;
      }
      CefPostTask(TID_UI, base::BindOnce(&Handle, c, line.substr(0, tab), line.substr(tab + 1, nl - tab - 1)));
    }
  }).detach();
}
