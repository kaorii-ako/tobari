#include "privacy.h"

#include <sys/stat.h>

#include <atomic>
#include <climits>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <map>
#include <memory>
#include <mutex>
#include <set>
#include <sstream>
#include <vector>

#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/cef_urlrequest.h"
#include "include/wrapper/cef_closure_task.h"
#include "block.h"
#include "shell.h"
#include "util.h"

namespace {

struct List {
  const char *name, *file, *url;
};
const List kLists[] = {
    {"EasyList", "easylist.txt", "https://easylist.to/easylist/easylist.txt"},
    {"EasyPrivacy", "easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"},
    {"uBlock filters", "ubo-filters.txt", "https://ublockorigin.github.io/uAssets/filters/filters.txt"},
    {"uBlock privacy", "ubo-privacy.txt", "https://ublockorigin.github.io/uAssets/filters/privacy.txt"},
};
const int64_t kWeek = 7 * 24 * 3600, kRetry = 3600;
const size_t kMaxList = 32 << 20;

// Read on the IO thread, written on the UI and file threads.
std::mutex g_mu;
std::shared_ptr<const Filter> g_filter = std::make_shared<Filter>();
std::set<std::string> g_off, g_http_ok, g_upgraded;
std::map<std::string, size_t> g_rules;
std::atomic<int64_t> g_blocked{0};

// UI thread only.
std::map<std::string, int64_t> g_tried;
std::vector<CefRefPtr<CefURLRequest>> g_pending;

std::string ListPath(const List& l) { return DataDir() + "/lists/" + l.file; }

int64_t Mtime(const std::string& path) {
  struct stat st;
  return stat(path.c_str(), &st) == 0 ? st.st_mtime : 0;
}

std::string ReadAll(const std::string& path) {
  std::ifstream f(path, std::ios::binary);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

// Hosts that can't have a certificate, so HTTPS-Only leaves them alone.
bool Local(const std::string& h) {
  auto ends = [&](const std::string& s) { return h.size() >= s.size() && h.compare(h.size() - s.size(), s.size(), s) == 0; };
  if (h == "localhost" || ends(".localhost") || ends(".local") || ends(".internal") || h[0] == '[') return true;
  return h.find_first_not_of("0123456789.") == std::string::npos;
}

void LoadLists() {
  auto f = std::make_shared<Filter>();
  std::map<std::string, size_t> rules;
  for (const List& l : kLists) rules[l.file] = f->Add(ReadAll(ListPath(l)));
  std::lock_guard lock(g_mu);
  g_filter = f;
  g_rules = rules;
}

void SaveOff() {
  auto off = CefListValue::Create();
  for (auto& s : g_off) off->SetString(off->GetSize(), s);
  auto d = CefDictionaryValue::Create();
  d->SetList("off", off);
  auto v = CefValue::Create();
  v->SetDictionary(d);
  WriteFile(DataDir() + "/privacy.json", CefWriteJSON(v, JSON_WRITER_DEFAULT));
}

void Blocked(int browser_id) {
  if (Shell* s = Shell::Get()) s->Blocked(browser_id);
}

class Fetch : public CefURLRequestClient {
 public:
  explicit Fetch(const List& l) : list_(l) {}

  void OnRequestComplete(CefRefPtr<CefURLRequest> r) override {
    auto res = r->GetResponse();
    // Only a complete 200 that parses into rules replaces the list on disk.
    if (r->GetRequestStatus() == UR_SUCCESS && res && res->GetStatus() == 200 && data_.size() <= kMaxList &&
        Filter().Add(data_) > 0) {
      mkdir((DataDir() + "/lists").c_str(), 0700);
      WriteFile(ListPath(list_), data_);
      CefPostTask(TID_FILE_USER_VISIBLE, base::BindOnce(&LoadLists));
    } else {
      fprintf(stderr, "tobari: filter list update failed: %s\n", list_.url);
    }
    std::erase_if(g_pending, [&](auto& p) { return p.get() == r.get(); });
  }
  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadData(CefRefPtr<CefURLRequest>, const void* data, size_t n) override {
    if (data_.size() <= kMaxList) data_.append(static_cast<const char*>(data), n);
  }
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  const List& list_;
  std::string data_;
  IMPLEMENT_REFCOUNTING(Fetch);
};

class Handler : public CefResourceRequestHandler {
 public:
  ReturnValue OnBeforeResourceLoad(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> req,
                                   CefRefPtr<CefCallback>) override {
    std::string url = req->GetURL();
    std::string host = UrlHost(url);
    if (host.empty()) return RV_CONTINUE;
    if (req->GetResourceType() == RT_MAIN_FRAME) {
      // HTTPS-Only: try https first; Shell::OnLoadError offers http if that fails.
      if (std::string up = Upgrade(url); !up.empty()) req->SetURL(up);
      return RV_CONTINUE;  // the page the user asked for is never blocked
    }
    std::string site = UrlHost(req->GetFirstPartyForCookies());
    if (site.empty()) site = host;
    std::shared_ptr<const Filter> f;
    {
      std::lock_guard lock(g_mu);
      if (g_off.count(Site(site))) return RV_CONTINUE;
      f = g_filter;
    }
    if (!f->Blocks(host, site)) return RV_CONTINUE;
    ++g_blocked;
    if (b) CefPostTask(TID_UI, base::BindOnce(&::Blocked, b->GetIdentifier()));
    return RV_CANCEL;
  }

  // Redirects skip OnBeforeResourceLoad. A site that sends https back to http loops until
  // ERR_TOO_MANY_REDIRECTS, which lands on the HTTPS-Only page like any other failed upgrade.
  void OnResourceRedirect(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, CefRefPtr<CefRequest> req,
                          CefRefPtr<CefResponse>, CefString& new_url) override {
    if (req->GetResourceType() != RT_MAIN_FRAME) return;
    if (std::string up = Upgrade(new_url); !up.empty()) new_url = up;
  }

 private:
  // The https form of a main-frame http URL, or "" to leave it alone.
  static std::string Upgrade(const std::string& url) {
    std::string host = UrlHost(url);
    if (url.rfind("http://", 0) != 0 || host.empty() || Local(host)) return "";
    std::lock_guard lock(g_mu);
    if (g_http_ok.count(host)) return "";
    g_upgraded.insert(host);
    return "https://" + url.substr(7);
  }
  IMPLEMENT_REFCOUNTING(Handler);
};

void Pref(const char* name, CefRefPtr<CefValue> v) {
  CefString err;
  if (!CefRequestContext::GetGlobalContext()->SetPreference(name, v, err))
    fprintf(stderr, "tobari: can't set %s: %s\n", name, err.ToString().c_str());
}

}  // namespace

void PrivacyStart() {
  auto v = CefParseJSON(ReadAll(DataDir() + "/privacy.json"), JSON_PARSER_RFC);
  if (v && v->GetType() == VTYPE_DICTIONARY && v->GetDictionary()->GetType("off") == VTYPE_LIST) {
    auto off = v->GetDictionary()->GetList("off");
    std::lock_guard lock(g_mu);
    for (size_t i = 0; i < off->GetSize(); ++i) g_off.insert(off->GetString(i));
  }
  auto mode = CefValue::Create();
  mode->SetInt(1);  // content_settings::CookieControlsMode::kBlockThirdParty
  Pref("profile.cookie_controls_mode", mode);
  auto webrtc = CefValue::Create();
  webrtc->SetString("disable_non_proxied_udp");  // no direct UDP, so no local or public IP leaks
  Pref("webrtc.ip_handling_policy", webrtc);
  CefPostTask(TID_FILE_USER_VISIBLE, base::BindOnce(&LoadLists));
  PrivacyUpdate();
}

void PrivacyUpdate() {
  int64_t now = time(nullptr);
  for (const List& l : kLists) {
    if (now - Mtime(ListPath(l)) < kWeek || now - g_tried[l.file] < kRetry) continue;
    g_tried[l.file] = now;
    auto req = CefRequest::Create();
    req->SetURL(l.url);
    req->SetMethod("GET");
    g_pending.push_back(CefURLRequest::Create(req, new Fetch(l), nullptr));
  }
}

CefRefPtr<CefResourceRequestHandler> PrivacyHandler() {
  static CefRefPtr<CefResourceRequestHandler> h = new Handler;
  return h;
}

bool SiteProtected(const std::string& site) {
  std::lock_guard lock(g_mu);
  return !g_off.count(site);
}

void SetSiteProtected(const std::string& site, bool on) {
  std::lock_guard lock(g_mu);
  if (on) g_off.erase(site);
  else if (!site.empty()) g_off.insert(site);
  SaveOff();
}

bool WasUpgraded(const std::string& host) {
  std::lock_guard lock(g_mu);
  return g_upgraded.erase(host) > 0;
}

void AllowHttp(const std::string& host) {
  std::lock_guard lock(g_mu);
  g_http_ok.insert(host);
}

std::string PrivacyStatus() {
  auto lists = CefListValue::Create();
  std::lock_guard lock(g_mu);
  for (const List& l : kLists) {
    auto d = CefDictionaryValue::Create();
    d->SetString("name", l.name);
    d->SetString("url", l.url);
    d->SetInt("rules", static_cast<int>(g_rules[l.file]));
    d->SetDouble("updated", static_cast<double>(Mtime(ListPath(l))));
    lists->SetDictionary(lists->GetSize(), d);
  }
  auto off = CefListValue::Create();
  for (auto& s : g_off) off->SetString(off->GetSize(), s);
  auto d = CefDictionaryValue::Create();
  d->SetList("lists", lists);
  d->SetList("off", off);
  d->SetDouble("blocked", static_cast<double>(g_blocked.load()));
  auto v = CefValue::Create();
  v->SetDictionary(d);
  return CefWriteJSON(v, JSON_WRITER_DEFAULT);
}
