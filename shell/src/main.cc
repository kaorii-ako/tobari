#include "include/cef_app.h"
#include "include/cef_command_line.h"

#include "app.h"

#include <string>

namespace {

std::string DataPath(const char* suffix) {
  const char* xdg = getenv("XDG_DATA_HOME");
  std::string base;
  if (xdg && *xdg) {
    base = std::string(xdg) + "/tobari";
  } else {
    const char* home = getenv("HOME");
    base = std::string(home ? home : ".") + "/.local/share/tobari";
  }
  return base + suffix;
}

}  // namespace

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
  CefRefPtr<tobari::App> app(new tobari::App);

  const int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

  CefSettings settings;
  settings.no_sandbox = false;
  const char* log_env = getenv("TOBARI_LOG");
  settings.log_severity = (log_env && std::string(log_env) == "info") ? LOGSEVERITY_INFO
                                                                     : LOGSEVERITY_WARNING;
  CefString(&settings.root_cache_path) = DataPath("/profiles/default");

  CefInitialize(main_args, settings, app.get(), nullptr);
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
