// tobari-cli.exe (Windows): the console half of `tobari tabs | open | text | close | reopen | burn | profile | mcp`.
// tobari.exe is a GUI program, so a terminal or an agent host reading stdio talks to this one instead.
#include <cstdio>
#include <string>
#include <vector>

#include "src/ctl.h"
#include "src/platform.h"
#include "src/util.h"

int main(int argc, char* argv[]) {
  auto args = Utf8Args(argc, argv);
  if (!args.empty()) args.erase(args.begin());
  for (auto& a : args)
    if (a.rfind("--profile=", 0) == 0 && !SetProfile(a.substr(10))) {
      fprintf(stderr, "tobari: \"%s\" isn't a usable profile name.\n", a.c_str() + 10);
      return 2;
    }
  int code = CtlClient(args);
  if (code < 0) {
    fprintf(stderr, "usage: tobari-cli [--profile=NAME] tabs | open URL | text [ID] | close ID | reopen | burn | profile NAME | mcp\n");
    return 2;
  }
  return code;
}
