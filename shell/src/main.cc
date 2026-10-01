#include "include/cef_app.h"
#include "include/cef_command_line.h"

#include "app.h"
#include "defaults.h"
#include "paths.h"

#include <string>

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
  CefRefPtr<tobari::App> app(new tobari::App);

  const int exit_code = CefExecuteProcess(main_args, app.get(), nullptr);
  if (exit_code >= 0) {
    return exit_code;
  }

  tobari::SeedNewProfile();

  CefSettings settings;
  settings.no_sandbox = false;
  const char* log_env = getenv("TOBARI_LOG");
  settings.log_severity = (log_env && std::string(log_env) == "info") ? LOGSEVERITY_INFO
                                                                     : LOGSEVERITY_WARNING;
  CefString(&settings.root_cache_path) = tobari::ProfileDir();

  CefInitialize(main_args, settings, app.get(), nullptr);
  CefRunMessageLoop();
  CefShutdown();

  return 0;
}
