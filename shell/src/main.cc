#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstring>
#include <filesystem>

#include "include/cef_app.h"
#include "ctl.h"
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
    if (!type.empty()) return;
    // No idle calls home (bench/idle_net.sh). Component updates come from Google; the Optimization Guide models
    // manifest installs "on demand" past that switch and has no off switch, so its update host doesn't resolve.
    cl->AppendSwitch("disable-component-update");
    cl->AppendSwitchWithValue("host-resolver-rules", "MAP update.googleapis.com ~NOTFOUND");
    // AI Mode eligibility polls www.google.com/async/folae; network time polls clients2.google.com.
    std::string off = "AimEnabled,AimServerEligibilityEnabled,AimEligibilityComponentExtension,NetworkTimeServiceQuerying";
    if (cl->HasSwitch("disable-features")) off = cl->GetSwitchValue("disable-features").ToString() + "," + off;
    cl->AppendSwitchWithValue("disable-features", off);
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

// Chromium prefs a fresh profile starts with, because profile setup downloads spellcheck dictionaries and
// host-installed external extensions before PrivacyStart can set them (bench/idle_net.sh first start).
static void BasePrefs(const std::string& data) {
  std::filesystem::create_directories(std::filesystem::path(data).parent_path());  // XDG_DATA_HOME or profiles/ may not exist yet
  for (auto d : {data, data + "/profile", data + "/profile/Default"}) mkdir(d.c_str(), 0700);
  WriteFile(data + "/profile/Default/Preferences",
            R"({"browser":{"enable_spellchecking":false},"extensions":{"block_external_extensions":true},)"
            R"("default_search_provider":{"enabled":false},"safebrowsing":{"enabled":false}})");
}

// Zygote children get a fresh stack canary after fork and then return through main, so main must not
// check one (Chromium marks its own main the same way).
__attribute__((no_stack_protector)) int main(int argc, char* argv[]) {
  // --profile=NAME runs that profile: its own data folder, process and window (Shell::OpenProfile).
  for (int i = 1; i < argc; ++i)
    if (!strncmp(argv[i], "--profile=", 10) && !SetProfile(argv[i] + 10)) {
      fprintf(stderr, "tobari: \"%s\" isn't a usable profile name.\n", argv[i] + 10);
      return 2;
    }
  if (int code = CtlClient(argc, argv); code >= 0) return code;
  // Copied now: Chromium later rewrites argv in place for the process title. Used to relaunch after a burn.
  std::vector<std::string> again;
  for (int i = 1; i < argc; ++i)
    if (!strncmp(argv[i], "--profile=", 10) || !strncmp(argv[i], "--ozone-platform=", 17)) again.push_back(argv[i]);
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
  if (access((data + "/profile/Default/Preferences").c_str(), F_OK) != 0) {
    Shell::first_run = true;
    BasePrefs(data);
  }
  if (!CefInitialize(args, s, app, nullptr)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  if (Shell::burn) {
    // Burn: every Chromium store (cookies, cache, site storage, permissions) lives under profile/, so it all goes.
    std::error_code ec;
    std::filesystem::remove_all(data + "/profile", ec);
    BasePrefs(data);
    Spawn(again);
  }
  return 0;
}
