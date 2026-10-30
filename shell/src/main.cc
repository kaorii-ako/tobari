#include <string>
#include <vector>

#include "app.h"
#include "crash.h"
#include "paths.h"

int main(int argc, char* argv[]) {
  CefMainArgs main_args(argc, argv);
  std::vector<std::string> urls;
  bool is_browser = true;
  for (int i = 1; i < argc; ++i) {
    std::string a(argv[i]);
    if (a.rfind("--type=", 0) == 0) is_browser = false;
    if (!a.empty() && a[0] != '-') urls.push_back(a);
  }
  CefRefPtr<tobari::App> app(new tobari::App(is_browser ? urls : std::vector<std::string>{}));
  int code = CefExecuteProcess(main_args, app, nullptr);
  if (code >= 0) return code;

  std::filesystem::create_directories(tobari::ProfileDir());
  tobari::HarvestCrashReports();

  CefSettings settings;
  CefString(&settings.root_cache_path) = tobari::ProfileDir().string();
  CefString(&settings.cache_path) = tobari::ProfileDir().string();
  settings.log_severity = LOGSEVERITY_WARNING;
  settings.persist_session_cookies = true;
  if (!CefInitialize(main_args, settings, app, nullptr)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
