#include "include/cef_app.h"
#include "shell.h"
#include "util.h"

namespace {

class App : public CefApp, public CefBrowserProcessHandler {
 public:
  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> r) override {
    r->AddCustomScheme("tobari", CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
                                     CEF_SCHEME_OPTION_CORS_ENABLED | CEF_SCHEME_OPTION_FETCH_ENABLED);
  }
  void OnBeforeCommandLineProcessing(const CefString& type, CefRefPtr<CefCommandLine> cl) override {
    // Shell::OnBeforePopup blocks pop-ups without a user gesture instead, so the UI can open its command bar.
    if (type.empty()) cl->AppendSwitch("disable-popup-blocking");
  }
  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnContextInitialized() override { Shell::Start(CefCommandLine::GetGlobalCommandLine()); }
  bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> cl, const CefString&) override {
    if (Shell::Get()) Shell::Get()->Relaunch(cl);
    return true;
  }
  IMPLEMENT_REFCOUNTING(App);
};

}  // namespace

// Zygote children get a fresh stack canary after fork and then return through main, so main must not
// check one (Chromium marks its own main the same way).
__attribute__((no_stack_protector)) int main(int argc, char* argv[]) {
  CefMainArgs args(argc, argv);
  CefRefPtr<App> app = new App;
  int code = CefExecuteProcess(args, app, nullptr);
  if (code >= 0) return code;
  CefSettings s;
  std::string data = DataDir();
  CefString(&s.root_cache_path) = data + "/profile";
  CefString(&s.cache_path) = data + "/profile";
  CefString(&s.log_file) = data + "/cef.log";
  s.log_severity = LOGSEVERITY_WARNING;
  s.persist_session_cookies = true;
  s.background_color = 0xFFE8E7EE;
  if (!CefInitialize(args, s, app, nullptr)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  return 0;
}
