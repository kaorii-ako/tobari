#include "app.h"

#include <dirent.h>

#include <string>
#include <vector>

#include "bangs.h"
#include "blocking.h"
#include "chrome_client.h"
#include "defaults.h"
#include "filters_update.h"
#include "shield.h"
#include "paths.h"
#include "include/cef_pack_strings.h"
#include "include/base/cef_callback.h"
#include "include/cef_command_line.h"
#include "include/wrapper/cef_closure_task.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"

namespace tobari {

namespace {

constexpr char kStartUrl[] = "chrome://newtab/";

std::vector<std::string> ExtensionDirs(const std::string& root) {
  std::vector<std::string> out;
  DIR* dir = opendir(root.c_str());
  if (!dir) return out;
  while (dirent* entry = readdir(dir)) {
    const std::string name = entry->d_name;
    if (name.empty() || name[0] == '.') continue;
    const std::string path = root + "/" + name;
    if (Readable(path + "/manifest.json")) out.push_back(path);
  }
  closedir(dir);
  return out;
}

}  // namespace

void App::OnBeforeCommandLineProcessing(const CefString& process_type,
                                        CefRefPtr<CefCommandLine> command_line) {
  if (!process_type.empty()) return;

  if (!command_line->HasSwitch("ozone-platform")) {
    command_line->AppendSwitchWithValue("ozone-platform", "wayland");
  }

  if (!command_line->HasSwitch("class")) {
    command_line->AppendSwitchWithValue("class", "dev.tobari.Browser");
  }

  command_line->AppendSwitch("disable-breakpad");
  command_line->AppendSwitch("disable-crash-reporter");
  command_line->AppendSwitch("disable-domain-reliability");
  command_line->AppendSwitch("no-pings");
  command_line->AppendSwitch("disable-background-networking");
  command_line->AppendSwitch("disable-component-update");
  command_line->AppendSwitch("disable-sync");

  std::vector<std::string> dirs = ExtensionDirs(ExecutableDir() + "/extensions");
  for (const std::string& d : ExtensionDirs(ExtensionsDir())) dirs.push_back(d);
  if (command_line->HasSwitch("load-extension")) {
    dirs.push_back(command_line->GetSwitchValue("load-extension").ToString());
  }
  if (!dirs.empty()) {
    std::string joined;
    for (const std::string& d : dirs) {
      if (!joined.empty()) joined += ",";
      joined += d;
    }
    command_line->AppendSwitchWithValue("load-extension", joined);
  }
}

bool App::GetLocalizedString(int string_id, CefString& string) {
  switch (string_id) {
    case IDS_PRODUCT_NAME:
    case IDS_SHORT_PRODUCT_NAME:
      string = "Tobari";
      return true;
    case IDS_BROWSER_WINDOW_TITLE_FORMAT:
      string = "$1 - Tobari";
      return true;
    default:
      return false;
  }
}

namespace {

// The first argument that is not a switch is a URL or path handed to us by the
// desktop (default-browser handler, `tobari https://...`, or a file manager).
std::string StartUrlFromCommandLine() {
  CefRefPtr<CefCommandLine> cl = CefCommandLine::GetGlobalCommandLine();
  std::vector<CefString> args;
  cl->GetArguments(args);
  for (const CefString& a : args) {
    std::string v = a.ToString();
    if (v.empty()) continue;
    if (v[0] == '/') return "file://" + v;
    return v;
  }
  return std::string();
}

}  // namespace

void App::OnContextInitialized() {
  LoadBangs();
  Blocking::Get().Load();
  RegisterShieldBridge();
  ApplyFirstRunDefaults();
  CefPostDelayedTask(TID_UI, base::BindOnce([] { FilterUpdater::Get().Start(false); }), 60 * 1000);
  FilterUpdater::Get().ScheduleBackgroundChecks();
  const char* dump = getenv("TOBARI_DUMP_PREFS");
  if (dump && *dump) {
    CefRefPtr<CefDictionaryValue> prefs =
        CefRequestContext::GetGlobalContext()->GetAllPreferences(true);
    CefRefPtr<CefValue> v = CefValue::Create();
    v->SetDictionary(prefs);
    WriteFileAtomic(dump, CefWriteJSON(v, JSON_WRITER_PRETTY_PRINT).ToString());
  }
  const std::string requested = StartUrlFromCommandLine();
  ChromeClient::Get()->OpenWindow(requested.empty() ? kStartUrl : requested);
}

CefRefPtr<CefClient> App::GetDefaultClient() {
  return ChromeClient::Get();
}

}  // namespace tobari
