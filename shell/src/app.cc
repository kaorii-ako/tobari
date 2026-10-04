#include "app.h"

#include <dirent.h>
#include <unistd.h>

#include <cctype>
#include <cstring>

#include <string>
#include <vector>

#include "bangs.h"
#include "blocking.h"
#include "chrome_client.h"
#include "defaults.h"
#include "filters_update.h"
#include "onboarding.h"
#include "shield.h"
#include "paths.h"
#include "include/cef_pack_strings.h"
#include "include/base/cef_callback.h"
#include "include/cef_command_ids.h"
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
  // Not --disable-background-networking: besides the services handled
  // individually here, it silently stops Web Store extensions from updating,
  // which leaves installed password managers and blockers stale.
  command_line->AppendSwitch("disable-component-update");
  command_line->AppendSwitch("disable-sync");

  // Measured with --log-net-log on an idle fresh profile: the component
  // updater, Chromium's account-cookie check (ListAccounts) and the network
  // time service all contact Google despite --disable-component-update and
  // sign-in being off. Point the first two at a closed local port so nothing
  // leaves the machine; this is Chromium's own endpoint configuration and does
  // not touch navigation in tabs. The extension updater has its own URL, so
  // Web Store extensions still update.
  command_line->AppendSwitchWithValue("component-updater", "url-source=http://127.0.0.1:9/");
  command_line->AppendSwitchWithValue("gaia-url", "http://127.0.0.1:9/");

  std::string disabled = command_line->GetSwitchValue("disable-features").ToString();
  for (const char* feature : {"NetworkTimeServiceQuerying"}) {
    if (disabled.find(feature) == std::string::npos) {
      if (!disabled.empty()) disabled += ",";
      disabled += feature;
    }
  }
  command_line->AppendSwitchWithValue("disable-features", disabled);

  // Only the extensions shipped next to the binary load unpacked. A directory
  // under the user's data dir would let any same-user process plant an
  // extension that runs on every launch without an install prompt.
  std::vector<std::string> dirs = ExtensionDirs(ExecutableDir() + "/extensions");
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

std::string CurrentDir() {
  char buf[4096];
  return getcwd(buf, sizeof(buf)) ? std::string(buf) : std::string("/");
}

std::string FileUrl(const std::string& path) {
  static const char kHex[] = "0123456789ABCDEF";
  std::string out = "file://";
  for (unsigned char ch : path) {
    if (isalnum(ch) || strchr("/-._~", ch)) {
      out += static_cast<char>(ch);
    } else {
      out += '%';
      out += kHex[ch >> 4];
      out += kHex[ch & 15];
    }
  }
  return out;
}

// The first argument that is not a switch is a URL or path handed to us by the
// desktop (default-browser handler, `tobari https://...`, or a file manager).
// Only web and file URLs are honored: anything else (chrome://, javascript:,
// data:) is something a link handler should never be able to open.
std::string UrlFromCommandLine(CefRefPtr<CefCommandLine> cl, const std::string& cwd) {
  std::vector<CefString> args;
  cl->GetArguments(args);
  for (const CefString& a : args) {
    std::string v = a.ToString();
    if (v.empty()) continue;
    if (v[0] == '/') return FileUrl(v);
    const size_t colon = v.find(':');
    if (colon != std::string::npos && v.find("://") == colon) {
      std::string scheme = v.substr(0, colon);
      for (char& ch : scheme) ch = static_cast<char>(tolower(static_cast<unsigned char>(ch)));
      if (scheme == "http" || scheme == "https" || scheme == "file") return v;
      return std::string();
    }
    const std::string local = (cwd.empty() ? std::string(".") : cwd) + "/" + v;
    if (Readable(local)) return FileUrl(local[0] == '/' ? local : CurrentDir() + "/" + v);
    if (v.find(' ') == std::string::npos && v.find('.') != std::string::npos &&
        colon == std::string::npos) {
      return "https://" + v;
    }
    return std::string();
  }
  return std::string();
}

}  // namespace

void App::OnContextInitialized() {
  LoadBangs();
  Blocking::Get().Load();
  RegisterShieldBridge();
  ChromeClient::CoverWorkerRequests();
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
  const std::string requested = UrlFromCommandLine(CefCommandLine::GetGlobalCommandLine(), std::string());
  // A profile's first launch opens the welcome flow instead of a blank tab;
  // a URL handed to Tobari on the command line still wins.
  const std::string start = Onboarded() ? kStartUrl : kWelcomeUrl;
  ChromeClient::Get()->OpenWindow(requested.empty() ? start : requested);
}

bool App::OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                      const CefString& current_directory) {
  const std::string url = UrlFromCommandLine(command_line, current_directory.ToString());
  if (url.empty()) {
    ChromeClient::Get()->OpenWindow(kStartUrl);
  } else {
    ChromeClient::Get()->OpenInLastWindow(url);
  }
  return true;
}

CefRefPtr<CefClient> App::GetDefaultClient() {
  return ChromeClient::Get();
}

}  // namespace tobari
