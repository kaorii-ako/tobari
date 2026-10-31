#include "ctl.h"

#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <unistd.h>

#include <cerrno>
#include <cstdio>
#include <cstdlib>
#include <cstring>
#include <string>
#include <thread>

#include "include/base/cef_callback.h"
#include "include/wrapper/cef_closure_task.h"
#include "shell.h"
#include "util.h"

namespace {

// In the data dir (mode 0700), because Chromium's process singleton is per profile too.
std::string Path() { return DataDir() + "/ctl.sock"; }

bool Address(sockaddr_un& a) {
  std::string p = Path();
  a = {};
  a.sun_family = AF_UNIX;
  if (p.size() >= sizeof a.sun_path) return false;
  memcpy(a.sun_path, p.c_str(), p.size() + 1);
  return true;
}

void SendAll(int fd, const std::string& s) {
  for (size_t at = 0; at < s.size();) {
    ssize_t n = send(fd, s.data() + at, s.size() - at, MSG_NOSIGNAL);
    if (n <= 0 && errno != EINTR) return;
    if (n > 0) at += n;
  }
}

void Handle(int c, std::string cmd, std::string arg) {
  Shell* s = Shell::Get();
  auto reply = [c](bool ok, const std::string& body) {
    SendAll(c, (ok ? "ok\n" : "error\n") + body);
    close(c);
  };
  if (!s) return reply(false, "Tobari is still starting.");
  s->Ctl(cmd, arg, reply);
}

}  // namespace

void CtlServe() {
  sockaddr_un a;
  int s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (s < 0 || !Address(a)) return;
  // A socket left by a crash. Chromium's process singleton already makes this the only running browser.
  unlink(a.sun_path);
  if (bind(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || chmod(a.sun_path, 0600) != 0 || listen(s, 8) != 0) {
    close(s);
    return;
  }
  std::thread([s] {
    for (;;) {
      int c = accept4(s, nullptr, nullptr, SOCK_CLOEXEC);
      if (c < 0) {
        if (errno == EINTR || errno == ECONNABORTED) continue;
        return;
      }
      timeval tv{5, 0};
      setsockopt(c, SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
      std::string line;
      char buf[4096];
      ssize_t n;
      while (line.find('\n') == std::string::npos && line.size() < 65536 && (n = read(c, buf, sizeof buf)) > 0)
        line.append(buf, n);
      size_t nl = line.find('\n'), tab = line.find('\t');
      if (nl == std::string::npos || tab > nl) {
        SendAll(c, "error\nBad request.");
        close(c);
        continue;
      }
      CefPostTask(TID_UI, base::BindOnce(&Handle, c, line.substr(0, tab), line.substr(tab + 1, nl - tab - 1)));
    }
  }).detach();
}

int CtlClient(int argc, char* argv[]) {
  // `tobari --profile=NAME tabs` talks to that profile; main has already applied the switch.
  if (argc > 1 && !strncmp(argv[1], "--profile=", 10)) ++argv, --argc;
  if (argc < 2) return -1;
  std::string cmd = argv[1];
  if (cmd != "tabs" && cmd != "open" && cmd != "text" && cmd != "close" && cmd != "profile") return -1;
  std::string arg = argc > 2 ? argv[2] : "";
  if ((cmd == "open" || cmd == "close" || cmd == "profile") && arg.empty()) {
    fprintf(stderr, "usage: tobari [--profile=NAME] tabs | open URL | text [ID] | close ID | profile NAME\n");
    return 2;
  }
  for (char& ch : arg)
    if (ch == '\n' || ch == '\t') ch = ' ';
  sockaddr_un a;
  int s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (s < 0 || !Address(a) || connect(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) {
    fprintf(stderr, "tobari: the browser isn't running.\n");
    return 1;
  }
  SendAll(s, cmd + "\t" + arg + "\n");
  std::string out;
  char buf[65536];
  for (ssize_t n; (n = read(s, buf, sizeof buf)) > 0;) out.append(buf, n);
  close(s);
  size_t nl = out.find('\n');
  bool ok = out.rfind("ok\n", 0) == 0;
  std::string body = nl == std::string::npos ? out : out.substr(nl + 1);
  fprintf(ok ? stdout : stderr, "%s%s", body.c_str(), body.empty() || body.back() == '\n' ? "" : "\n");
  return ok ? 0 : 1;
}
