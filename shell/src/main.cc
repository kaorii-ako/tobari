#include <cstdio>
#include <cstring>
#include <filesystem>

#include "include/cef_app.h"
#ifdef _WIN32
#include <windows.h>
#include "include/cef_sandbox_win.h"
#endif
#include "ctl.h"
#include "platform.h"
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
  std::error_code ec;
  std::filesystem::create_directories(std::filesystem::path(data).parent_path(), ec);  // the data root may not exist yet
  for (auto d : {data, data + "/profile", data + "/profile/Default"}) MakeDir(d);
  WriteFile(data + "/profile/Default/Preferences",
            R"({"browser":{"enable_spellchecking":false},"extensions":{"block_external_extensions":true},)"
            R"("default_search_provider":{"enabled":false},"safebrowsing":{"enabled":false}})");
}

// Burn wipes the Chromium profile at the next start, before CEF opens it: by then the old browser's helper
// processes are gone (Windows keeps files locked while they live), and a retry covers the stragglers.
static void FinishBurn(const std::string& data) {
  std::string mark = data + "/burn-pending";
  if (!std::filesystem::exists(mark)) return;
  std::error_code ec;
  for (int i = 0; i < 50; ++i) {
    std::filesystem::remove_all(data + "/profile", ec);
    if (!std::filesystem::exists(data + "/profile")) break;
    SleepMs(200);
  }
  if (std::filesystem::exists(data + "/profile")) {
    Shell::burn_failed = true;  // the marker stays, so the next start tries again
    return;
  }
  std::filesystem::remove(mark, ec);
  BasePrefs(data);  // a burned profile isn't a first run: no welcome page
}

// Browser and helper processes both come through here. args are UTF-8, without argv[0].
static int Run(const std::vector<std::string>& args, const CefMainArgs& main_args, void* sandbox_info) {
  // --profile=NAME runs that profile: its own data folder, process and window (Shell::OpenProfile).
  for (auto& a : args)
    if (a.rfind("--profile=", 0) == 0 && !SetProfile(a.substr(10))) {
      fprintf(stderr, "tobari: \"%s\" isn't a usable profile name.\n", a.c_str() + 10);
      return 2;
    }
  // To relaunch after a burn.
  std::vector<std::string> again;
  for (auto& a : args)
    if (a.rfind("--profile=", 0) == 0 || a.rfind("--ozone-platform=", 0) == 0) again.push_back(a);
  CefRefPtr<App> app = new App;
  int code = CefExecuteProcess(main_args, app, sandbox_info);
  if (code >= 0) return code;
  CefSettings s;
  std::string data = DataDir();
  CefString(&s.root_cache_path) = data + "/profile";
  CefString(&s.cache_path) = data + "/profile";
  CefString(&s.log_file) = data + "/cef.log";
  s.log_severity = LOGSEVERITY_WARNING;
  s.persist_session_cookies = true;
  s.background_color = 0xFFE8E7EE;
  FinishBurn(data);
  if (!std::filesystem::exists(data + "/profile/Default/Preferences")) {
    Shell::first_run = true;
    BasePrefs(data);
  }
  if (!CefInitialize(main_args, s, app, sandbox_info)) return CefGetExitCode();
  CefRunMessageLoop();
  CefShutdown();
  if (Shell::burn) Spawn(again);
  return 0;
}

#ifdef _WIN32
// tobari.exe is CEF's bootstrap.exe renamed; it checks the signature policy, sets up the sandbox and calls
// this in tobari.dll. The CLI is the separate console program tobari-cli.exe (cli_main.cc).
extern "C" CEF_BOOTSTRAP_EXPORT int RunWinMain(HINSTANCE instance, LPWSTR, int, void* sandbox_info,
                                               cef_version_info_t*) {
  auto args = Utf8Args(0, nullptr);
  if (!args.empty()) args.erase(args.begin());
  return Run(args, CefMainArgs(instance), sandbox_info);
}
#else
// Zygote children get a fresh stack canary after fork and then return through main, so main must not
// check one (Chromium marks its own main the same way).
__attribute__((no_stack_protector)) int main(int argc, char* argv[]) {
  std::vector<std::string> args(argv + 1, argv + argc);  // copied: Chromium later rewrites argv for the title
  for (auto& a : args)
    if (a.rfind("--profile=", 0) == 0 && !SetProfile(a.substr(10))) {
      fprintf(stderr, "tobari: \"%s\" isn't a usable profile name.\n", a.c_str() + 10);
      return 2;
    }
  if (int code = CtlClient(args); code >= 0) return code;
  return Run(args, CefMainArgs(argc, argv), nullptr);
}
#endif
