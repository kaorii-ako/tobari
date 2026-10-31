#include "shell.h"

#include <sys/stat.h>
#include <unistd.h>

#include <algorithm>
#include <cstdio>
#include <ctime>
#include <fstream>
#include <sstream>

#include "include/base/cef_callback.h"
#include "include/cef_app.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/views/cef_window.h"
#include "include/wrapper/cef_closure_task.h"
#include "block.h"
#include "privacy.h"
#include "scheme.h"
#include "util.h"

namespace {

CefRefPtr<Shell> g_shell;
const int64_t kSleepAfter = 30 * 60;
const cef_color_t kBackground = 0xFFE8E7EE;  // --bg in light theme; shown until the UI paints
enum { kMenuNewTab = MENU_ID_USER_FIRST };

int64_t Now() { return time(nullptr); }

bool IsInternal(const std::string& url) { return url.rfind("tobari:", 0) == 0; }

std::string Json(CefRefPtr<CefValue> v) { return CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString(); }
std::string Json(CefRefPtr<CefDictionaryValue> d) {
  auto v = CefValue::Create();
  v->SetDictionary(d);
  return Json(v);
}
std::string Json(CefRefPtr<CefListValue> l) {
  auto v = CefValue::Create();
  v->SetList(l);
  return Json(v);
}

CefRect Rect(CefRefPtr<CefDictionaryValue> a, const char* key) {
  if (a->GetType(key) != VTYPE_LIST) return CefRect();
  auto l = a->GetList(key);
  return CefRect(l->GetInt(0), l->GetInt(1), l->GetInt(2), l->GetInt(3));
}


std::string ReadFile(const std::string& path) {
  std::ifstream f(path);
  std::stringstream s;
  s << f.rdbuf();
  return s.str();
}

std::string Lower(std::string s) {
  // shortcut: ASCII only, so history search is case-sensitive for other scripts; fine until it matters.
  for (char& c : s) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return s;
}

class ViewDelegate : public CefBrowserViewDelegate {
 public:
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  bool OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> view, CefRefPtr<CefBrowserView> popup,
                                 bool is_devtools) override {
    return !is_devtools && g_shell->OnPopupView(view, popup);
  }
  IMPLEMENT_REFCOUNTING(ViewDelegate);
};
CefRefPtr<ViewDelegate> g_view_delegate;

struct Key {
  int code;
  bool shift, ctrl, alt;
  const char* name;
};
const Key kKeys[] = {
    {'K', 0, 0, 1, "cmd"},       {'T', 0, 1, 0, "newtab"},    {'W', 0, 1, 0, "close"},
    {'L', 0, 1, 0, "address"},   {'J', 0, 0, 1, "ai"},        {'S', 0, 0, 1, "compact"},
    {0xDC, 0, 0, 1, "split"},    {0x09, 0, 1, 0, "next"},     {0x09, 1, 1, 0, "prev"},
    {'R', 0, 1, 0, "reload"},    {0x74, 0, 0, 0, "reload"},   {0x25, 0, 0, 1, "back"},
    {0x27, 0, 0, 1, "forward"},  {'F', 0, 1, 0, "find"},      {'I', 1, 1, 0, "devtools"},
    {0x7B, 0, 0, 0, "devtools"}, {'1', 0, 1, 0, "tab1"},      {'2', 0, 1, 0, "tab2"},
    {'3', 0, 1, 0, "tab3"},      {'4', 0, 1, 0, "tab4"},      {'5', 0, 1, 0, "tab5"},
    {'6', 0, 1, 0, "tab6"},      {'7', 0, 1, 0, "tab7"},      {'8', 0, 1, 0, "tab8"},
    {'9', 0, 1, 0, "tab9"},
};

class WindowDelegate : public CefWindowDelegate {
 public:
  void OnWindowCreated(CefRefPtr<CefWindow> w) override { g_shell->OnWindowCreated(w); }
  bool CanClose(CefRefPtr<CefWindow>) override { return g_shell->CanClose(); }
  bool IsFrameless(CefRefPtr<CefWindow>) override { return true; }
  CefSize GetPreferredSize(CefRefPtr<CefView>) override { return CefSize(1280, 820); }
  CefSize GetMinimumSize(CefRefPtr<CefView>) override { return CefSize(720, 480); }
  bool OnAccelerator(CefRefPtr<CefWindow>, int id) override {
    g_shell->OnAccelerator(id);
    return true;
  }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }
  bool GetLinuxWindowProperties(CefRefPtr<CefWindow>, CefLinuxWindowProperties& p) override {
    CefString(&p.wayland_app_id) = "tobari";
    CefString(&p.wm_class_class) = "Tobari";
    CefString(&p.wm_class_name) = "tobari";
    return true;
  }
  IMPLEMENT_REFCOUNTING(WindowDelegate);
};

}  // namespace

void Shell::Start(CefRefPtr<CefCommandLine> cl) {
  g_shell = new Shell;
  g_view_delegate = new ViewDelegate;
  CefRegisterSchemeHandlerFactory("tobari", "", NewSchemeFactory());
  PrivacyStart();
  g_shell->demo_ = cl->GetSwitchValue("tobari-demo").ToString();
  CefCommandLine::ArgumentList args;
  cl->GetArguments(args);
  for (auto& a : args) g_shell->start_urls_.push_back(FixupInput(a.ToString()));
  mkdir(DataDir().c_str(), 0700);
  CefWindow::CreateTopLevelWindow(new WindowDelegate);
}

Shell* Shell::Get() { return g_shell.get(); }

void Shell::OnWindowCreated(CefRefPtr<CefWindow> window) {
  window_ = window;
  CefBrowserSettings s;
  s.background_color = kBackground;
  frame_ = CefBrowserView::CreateBrowserView(this, "tobari://ui/" + (demo_.empty() ? "" : "#" + demo_), s,
                                             nullptr, nullptr, g_view_delegate);
  window->AddChildView(frame_);
  for (size_t i = 0; i < sizeof(kKeys) / sizeof(kKeys[0]); ++i)
    window->SetAccelerator(static_cast<int>(i), kKeys[i].code, kKeys[i].shift, kKeys[i].ctrl, kKeys[i].alt, true);
  window->SetTitle("Tobari");
  window->Show();
  LoadHistory();
  if (demo_.empty()) LoadSession();
  for (auto& u : start_urls_)
    if (!u.empty()) NewTab(u, ws_, true);
  CefPostDelayedTask(TID_UI, base::BindOnce(&Shell::Tick, CefRefPtr<Shell>(this)), 60000);
}

void Shell::Relaunch(CefRefPtr<CefCommandLine> cl) {
  if (!window_) return;
  CefCommandLine::ArgumentList args;
  cl->GetArguments(args);
  for (auto& a : args) {
    std::string u = FixupInput(a.ToString());
    if (!u.empty()) NewTab(u, ws_, true);
  }
  window_->Show();
  window_->Activate();
}

bool Shell::IsUi(CefRefPtr<CefBrowser> b) {
  if (!b || !frame_ || !frame_->GetBrowser()) return false;
  int id = frame_->GetBrowser()->GetIdentifier();
  // The command bar is the only popup the UI opens.
  return b->GetIdentifier() == id || b->GetHost()->GetOpenerIdentifier() == id;
}

Tab* Shell::Find(CefRefPtr<CefBrowser> b) {
  auto v = CefBrowserView::GetForBrowser(b);
  if (!v) return nullptr;
  for (auto& t : tabs_)
    if (t.view && t.view->IsSame(v)) return &t;
  return nullptr;
}

Tab* Shell::ById(int id) {
  for (auto& t : tabs_)
    if (t.id == id) return &t;
  return nullptr;
}

// The tab that browser commands act on: the focused side of a split, or the active tab.
Tab* Shell::Current() {
  if (focus_ && (focus_ == active_ || focus_ == split_)) return ById(focus_);
  return ById(active_);
}

int Shell::NewTab(const std::string& url, const std::string& ws, bool select, CefRefPtr<CefBrowserView> view) {
  Tab t;
  t.id = next_id_++;
  t.url = url;
  t.title = url;
  t.ws = ws;
  t.used = Now();
  t.view = view;
  if (view) t.ov = window_->AddOverlayView(view, CEF_DOCKING_MODE_CUSTOM, true);
  // New tabs go after the active tab, the way most browsers place them.
  auto at = std::find_if(tabs_.begin(), tabs_.end(), [&](const Tab& x) { return x.id == active_; });
  tabs_.insert(at == tabs_.end() ? at : at + 1, t);
  int id = t.id;
  if (select) Select(id);
  if (cmd_open_) RaiseCmd();
  Layout();
  Changed();
  return id;
}

void Shell::Wake(Tab& t) {
  if (!t.view) {
    CefBrowserSettings s;
    t.internal_ok = IsInternal(t.url);
    t.view = CefBrowserView::CreateBrowserView(this, t.url, s, nullptr, nullptr, g_view_delegate);
  }
  if (!t.ov) {
    t.ov = window_->AddOverlayView(t.view, CEF_DOCKING_MODE_CUSTOM, true);
    t.ov->SetVisible(false);
    if (cmd_open_) RaiseCmd();
  }
}

void Shell::Sleep(Tab& t) {
  if (!t.view) return;
  if (t.ov) t.ov->Destroy();
  if (auto b = t.view->GetBrowser()) b->GetHost()->CloseBrowser(true);
  t.ov = nullptr;
  t.view = nullptr;
  t.loading = false;
  Changed();
}

// Drops the tab entry; the caller has closed or is closing its browser.
void Shell::Forget(int id) {
  auto it = std::find_if(tabs_.begin(), tabs_.end(), [&](const Tab& x) { return x.id == id; });
  if (it == tabs_.end()) return;
  std::string ws = it->ws;
  if (it->ov) it->ov->Destroy();
  tabs_.erase(it);
  if (split_ == id) split_ = 0;
  if (active_ == id) ShowWorkspace(ws);
  Layout();
  Changed();
}

void Shell::Close(int id) {
  Tab* t = ById(id);
  if (!t) return;
  Sleep(*t);
  Forget(id);
}

void Shell::Select(int id) {
  Tab* t = ById(id);
  if (!t) return;
  if (Tab* old = ById(active_)) old->used = Now();
  if (split_ == id) split_ = active_;
  active_ = id;
  focus_ = id;
  t->used = Now();
  ws_ = t->ws;
  Wake(*t);
  if (Tab* s = ById(split_)) Wake(*s);
  Layout();
  if (!cmd_open_) t->view->RequestFocus();
  Changed();
}

// Shows the most recently used tab of a workspace, or no tab if it is empty.
void Shell::ShowWorkspace(const std::string& ws) {
  ws_ = ws;
  active_ = split_ = 0;
  Tab* next = nullptr;
  for (auto& t : tabs_)
    if (t.ws == ws && (!next || t.used > next->used)) next = &t;
  if (next) Select(next->id);
  Layout();
  Changed();
}

void Shell::Go(Tab& t, const std::string& url) {
  if (url.empty()) return;
  t.internal_ok = IsInternal(url);
  t.url = url;
  if (t.view && t.view->GetBrowser())
    t.view->GetBrowser()->GetMainFrame()->LoadURL(url);
  else
    Select(t.id);
  Changed();
}

void Shell::Layout() {
  for (auto& t : tabs_) {
    if (!t.ov) continue;
    bool main = t.id == active_ && !main_rect_.IsEmpty();
    bool side = t.id == split_ && !split_rect_.IsEmpty();
    if (main || side) t.ov->SetBounds(main ? main_rect_ : split_rect_);
    t.ov->SetVisible(main || side);
  }
  if (cmd_ov_) {
    if (cmd_open_) cmd_ov_->SetBounds(cmd_rect_);
    cmd_ov_->SetVisible(cmd_open_);
  }
}

// Overlays stack in the order they were added, so re-adding the command bar puts it on top.
void Shell::RaiseCmd() {
  if (!cmd_ov_) return;
  cmd_ov_->Destroy();
  cmd_ov_ = window_->AddOverlayView(cmd_, CEF_DOCKING_MODE_CUSTOM, true);
}

void Shell::ShowCmd(bool show) {
  if (!cmd_) return;
  if (show && !cmd_open_) RaiseCmd();
  cmd_open_ = show;
  Layout();
  if (show) {
    cmd_->RequestFocus();
  } else if (Tab* t = Current(); t && t->view) {
    t->view->RequestFocus();
  } else {
    frame_->RequestFocus();
  }
}

void Shell::Changed() {
  if (!push_queued_) {
    push_queued_ = true;
    CefPostTask(TID_UI, base::BindOnce(&Shell::Push, CefRefPtr<Shell>(this)));
  }
  if (!save_queued_) {
    save_queued_ = true;
    CefPostDelayedTask(TID_UI, base::BindOnce(&Shell::SaveSession, CefRefPtr<Shell>(this)), 2000);
  }
}

void Shell::Push() {
  push_queued_ = false;
  if (!ui_ready_) return;  // ui.js calls "ready" once T exists
  auto list = CefListValue::Create();
  for (size_t i = 0; i < tabs_.size(); ++i) {
    const Tab& t = tabs_[i];
    auto d = CefDictionaryValue::Create();
    d->SetInt("id", t.id);
    d->SetString("url", t.url);
    d->SetString("title", t.title);
    d->SetString("icon", t.icon);
    d->SetString("ws", t.ws);
    d->SetBool("loading", t.loading);
    d->SetBool("back", t.back);
    d->SetBool("forward", t.fwd);
    d->SetBool("sleeping", !t.view);
    d->SetInt("blocked", t.blocked);
    std::string host = UrlHost(t.url);
    d->SetBool("shield", !host.empty() && SiteProtected(Site(host)));
    list->SetDictionary(i, d);
  }
  auto s = CefDictionaryValue::Create();
  s->SetList("tabs", list);
  s->SetInt("active", active_);
  s->SetInt("split", split_);
  s->SetInt("focus", Current() ? Current()->id : 0);
  s->SetString("ws", ws_);
  s->SetString("ui", ui_blob_);
  s->SetBool("maximized", window_ && window_->IsMaximized());
  Js("T.state(" + Json(s) + ")");
}

void Shell::Js(const std::string& code) {
  if (frame_ && frame_->GetBrowser()) frame_->GetBrowser()->GetMainFrame()->ExecuteJavaScript(code, "", 0);
}

void Shell::Toast(const std::string& text) {
  auto v = CefValue::Create();
  v->SetString(text);
  Js("T.toast(" + Json(v) + ")");
}

void Shell::OnAccelerator(int id) { Js(std::string("T.key('") + kKeys[id].name + "')"); }

std::string Shell::Api(CefRefPtr<CefBrowser> caller, const std::string& cmd, CefRefPtr<CefDictionaryValue> a) {
  // scheme.cc lets built-in pages call only their own "<host>." commands.
  if (!IsUi(caller) && cmd.rfind("blocking.", 0) && cmd.rfind("bangs.", 0) && cmd.rfind("https.", 0)) return "";
  auto S = [&](const char* k) { return a->GetString(k).ToString(); };
  Tab* cur = a->HasKey("id") ? ById(a->GetInt("id")) : Current();
  CefRefPtr<CefBrowserHost> host = cur && cur->view && cur->view->GetBrowser() ? cur->view->GetBrowser()->GetHost() : nullptr;

  if (cmd == "ready") {
    ui_ready_ = true;
    Push();
  } else if (cmd == "layout") {
    main_rect_ = Rect(a, "main");
    split_rect_ = Rect(a, "split");
    cmd_rect_ = Rect(a, "cmd");
    Layout();
  } else if (cmd == "tab.new") {
    return "{\"id\":" + std::to_string(NewTab(FixupInput(S("url")), ws_, !a->GetBool("background"))) + "}";
  } else if (cmd == "tab.close" && cur) {
    Close(cur->id);
  } else if (cmd == "tab.select" && cur) {
    Select(cur->id);
  } else if (cmd == "tab.split") {
    Tab* other = ById(a->GetInt("with"));
    split_ = other && other->id != active_ ? other->id : 0;
    if (other) Wake(*other);
    Layout();
    Changed();
  } else if (cmd == "tab.move" && cur) {
    // Moves the tab in front of "before", or to the end when "before" is missing.
    Tab t = std::move(*cur);
    tabs_.erase(tabs_.begin() + (cur - tabs_.data()));
    auto at = std::find_if(tabs_.begin(), tabs_.end(), [&](const Tab& x) { return x.id == a->GetInt("before"); });
    tabs_.insert(at, std::move(t));
    Changed();
  } else if (cmd == "tab.ws" && cur) {
    cur->ws = S("ws");
    if (cur->id == active_ || cur->id == split_) ShowWorkspace(ws_);
    Changed();
  } else if (cmd == "tab.sleep" && cur && cur->id != active_ && cur->id != split_) {
    Sleep(*cur);
  } else if (cmd == "ws") {
    ShowWorkspace(S("ws"));
  } else if (cmd == "go" && cur) {
    Go(*cur, FixupInput(S("text")));
  } else if (cmd == "nav" && host) {
    std::string op = S("op");
    if (op == "back") host->GetBrowser()->GoBack();
    if (op == "forward") host->GetBrowser()->GoForward();
    if (op == "reload") host->GetBrowser()->Reload();
    if (op == "stop") host->GetBrowser()->StopLoad();
  } else if (cmd == "find" && host) {
    host->Find(S("text"), !a->GetBool("back"), false, a->GetBool("next"));
  } else if (cmd == "find.stop" && host) {
    host->StopFinding(true);
  } else if (cmd == "cmd") {
    ShowCmd(a->GetBool("open"));
  } else if (cmd == "focus") {
    if (S("on") == "frame")
      frame_->RequestFocus();
    else if (cur && cur->view)
      cur->view->RequestFocus();
  } else if (cmd == "theme") {
    // Pages follow the Tobari theme through prefers-color-scheme.
    auto m = S("mode");
    CefRequestContext::GetGlobalContext()->SetChromeColorScheme(
        m == "light" ? CEF_COLOR_VARIANT_LIGHT : m == "dark" ? CEF_COLOR_VARIANT_DARK : CEF_COLOR_VARIANT_SYSTEM, 0);
  } else if (cmd == "ui.save") {
    ui_blob_ = S("blob");
    Changed();
  } else if (cmd == "history") {
    return SearchHistory(S("q"));
  } else if (cmd == "win") {
    std::string op = S("op");
    if (op == "min") window_->Minimize();
    if (op == "max") window_->IsMaximized() ? window_->Restore() : window_->Maximize();
    if (op == "close") window_->Close();
    Changed();
  } else if (cmd == "devtools" && host) {
    CefWindowInfo wi;
    CefBrowserSettings bs;
    host->ShowDevTools(wi, nullptr, bs, CefPoint());
  } else if (cmd == "shield" && cur) {
    std::string h = UrlHost(cur->url);
    if (h.empty()) return "{}";
    SetSiteProtected(Site(h), a->GetBool("on"));
    if (cur->view && cur->view->GetBrowser()) cur->view->GetBrowser()->Reload();
    Changed();
  } else if (cmd == "blocking.status") {
    return PrivacyStatus();
  } else if (cmd == "blocking.site") {
    SetSiteProtected(S("site"), a->GetBool("on"));
    Changed();
  } else if (cmd == "blocking.safebrowsing") {
    SetSafeBrowsing(a->GetBool("on"));
  } else if (cmd == "bangs.list") {
    auto l = CefListValue::Create();
    for (const Bang& b : Bangs()) {
      auto d = CefDictionaryValue::Create();
      d->SetString("key", b.key);
      d->SetString("name", b.name);
      d->SetString("url", b.url);
      l->SetDictionary(l->GetSize(), d);
    }
    return Json(l);
  } else if (cmd == "https.allow") {
    // From tobari://https/ after an upgraded navigation failed: the user chose plain http for this host.
    std::string url = S("url");
    if (url.rfind("http://", 0) != 0 || UrlHost(url).empty()) return "{\"error\":\"not an http URL\"}";
    AllowHttp(UrlHost(url));
    caller->GetMainFrame()->LoadURL(url);
  } else {
    return "{\"error\":\"unknown command or no tab\"}";
  }
  return "{}";
}

void Shell::SaveSession() {
  save_queued_ = false;
  auto list = CefListValue::Create();
  int active = -1;
  for (auto& t : tabs_) {
    if (t.url.empty()) continue;
    auto d = CefDictionaryValue::Create();
    d->SetString("url", t.url);
    d->SetString("title", t.title);
    d->SetString("icon", t.icon);
    d->SetString("ws", t.ws);
    if (t.id == active_) active = static_cast<int>(list->GetSize());
    list->SetDictionary(list->GetSize(), d);
  }
  auto s = CefDictionaryValue::Create();
  s->SetList("tabs", list);
  s->SetInt("active", active);
  s->SetString("ui", ui_blob_);
  // shortcut: plain JSON; it moves into the encrypted store together with history before 0.5.0.
  WriteFile(DataDir() + "/session.json", Json(s));
}

void Shell::LoadSession() {
  auto v = CefParseJSON(ReadFile(DataDir() + "/session.json"), JSON_PARSER_RFC);
  if (!v || v->GetType() != VTYPE_DICTIONARY) return;
  auto s = v->GetDictionary();
  ui_blob_ = s->GetString("ui").ToString();
  if (ui_blob_.empty()) ui_blob_ = "{}";
  auto list = s->GetList("tabs");
  int active = s->GetInt("active");
  for (size_t i = 0; list && i < list->GetSize(); ++i) {
    auto d = list->GetDictionary(i);
    Tab t;
    t.id = next_id_++;
    t.url = d->GetString("url");
    t.title = d->GetString("title");
    t.icon = d->GetString("icon");
    t.ws = d->GetString("ws");
    t.used = Now() - static_cast<int64_t>(list->GetSize() - i);
    tabs_.push_back(t);
    if (static_cast<int>(i) == active) active_ = t.id;
  }
  // Every restored tab sleeps until it is shown, so a big session costs nothing at startup.
  if (Tab* t = ById(active_)) {
    active_ = 0;
    Select(t->id);
  }
  Changed();
}

void Shell::LoadHistory() {
  std::ifstream f(DataDir() + "/history.jsonl");
  std::string line;
  while (std::getline(f, line)) {
    auto v = CefParseJSON(line, JSON_PARSER_RFC);
    if (!v || v->GetType() != VTYPE_DICTIONARY) continue;
    auto d = v->GetDictionary();
    std::string url = d->GetString("u");
    auto it = visit_index_.find(url);
    if (it == visit_index_.end()) {
      visit_index_[url] = history_.size();
      history_.push_back(Visit{url, "", 0, 0});
      it = visit_index_.find(url);
    }
    Visit& h = history_[it->second];
    h.title = d->GetString("t");
    h.last = static_cast<int64_t>(d->GetDouble("s"));
    h.count++;
  }
}

void Shell::Visited(const Tab& t) {
  if (t.url.rfind("http://", 0) != 0 && t.url.rfind("https://", 0) != 0) return;
  auto it = visit_index_.find(t.url);
  if (it == visit_index_.end()) {
    visit_index_[t.url] = history_.size();
    history_.push_back(Visit{t.url, "", 0, 0});
    it = visit_index_.find(t.url);
  }
  Visit& h = history_[it->second];
  h.title = t.title;
  h.last = Now();
  h.count++;
  auto d = CefDictionaryValue::Create();
  d->SetString("u", t.url);
  d->SetString("t", t.title);
  d->SetDouble("s", static_cast<double>(h.last));
  // shortcut: plain JSON lines; encrypted at rest before 0.5.0 (see HANDOFF.md).
  std::ofstream f(DataDir() + "/history.jsonl", std::ios::app);
  f << Json(d) << "\n";
  chmod((DataDir() + "/history.jsonl").c_str(), 0600);
}

std::string Shell::SearchHistory(const std::string& q) {
  std::vector<std::string> terms;
  std::istringstream in(Lower(q));
  for (std::string w; in >> w;) terms.push_back(w);
  std::vector<const Visit*> hits;
  for (auto& h : history_) {
    std::string hay = Lower(h.url + " " + h.title);
    bool all = true;
    for (auto& w : terms) all = all && hay.find(w) != std::string::npos;
    if (all) hits.push_back(&h);
  }
  // Visit count first, then recency: the pages people return to rank above one-off visits.
  std::sort(hits.begin(), hits.end(), [](const Visit* a, const Visit* b) {
    return a->count != b->count ? a->count > b->count : a->last > b->last;
  });
  auto list = CefListValue::Create();
  for (size_t i = 0; i < hits.size() && i < 8; ++i) {
    auto d = CefDictionaryValue::Create();
    d->SetString("url", hits[i]->url);
    d->SetString("title", hits[i]->title);
    list->SetDictionary(i, d);
  }
  return Json(list);
}

void Shell::Tick() {
  // shortcut: a tab playing audio also sleeps after 30 minutes hidden; check audio state once CEF exposes it here.
  for (auto& t : tabs_)
    if (t.view && t.id != active_ && t.id != split_ && !t.loading && Now() - t.used > kSleepAfter) Sleep(t);
  PrivacyUpdate();
  CefPostDelayedTask(TID_UI, base::BindOnce(&Shell::Tick, CefRefPtr<Shell>(this)), 60000);
}

bool Shell::CanClose() {
  if (!closing_) {
    closing_ = true;
    SaveSession();
    for (auto& t : tabs_)
      if (t.view && t.view->GetBrowser()) t.view->GetBrowser()->GetHost()->CloseBrowser(true);
    if (cmd_ && cmd_->GetBrowser()) cmd_->GetBrowser()->GetHost()->CloseBrowser(true);
  }
  return frame_->GetBrowser()->GetHost()->TryCloseBrowser();
}

bool Shell::OnPopupView(CefRefPtr<CefBrowserView> opener, CefRefPtr<CefBrowserView> popup) {
  if (opener->IsSame(frame_)) {
    cmd_ = popup;
    cmd_ov_ = window_->AddOverlayView(popup, CEF_DOCKING_MODE_CUSTOM, true);
    cmd_ov_->SetVisible(false);
    return true;
  }
  std::string ws = ws_;
  for (auto& t : tabs_)
    if (t.view && t.view->IsSame(opener)) ws = t.ws;
  NewTab("", ws, popup_disposition_ != CEF_WOD_NEW_BACKGROUND_TAB, popup);
  return true;
}

bool Shell::OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame>, int, const CefString& target_url,
                          const CefString& target_frame_name, CefLifeSpanHandler::WindowOpenDisposition disposition, bool user_gesture,
                          const CefPopupFeatures&, CefWindowInfo&, CefRefPtr<CefClient>&,
                          CefBrowserSettings& settings, CefRefPtr<CefDictionaryValue>&, bool*) {
  if (IsUi(browser)) {
    settings.background_color = kBackground;
    return target_frame_name != "cmd" || cmd_;  // the UI opens exactly one popup: the command bar
  }
  if (IsInternal(target_url)) return true;  // web pages can't open built-in pages
  // Chromium's popup blocker is off (it also blocked the UI's command bar), so this is the blocker.
  if (!user_gesture) {
    Toast("Blocked a pop-up from " + browser->GetMainFrame()->GetURL().ToString());
    return true;
  }
  popup_disposition_ = disposition;
  return false;
}

void Shell::OnBeforeClose(CefRefPtr<CefBrowser> b) {
  // A page that closes itself (window.close()) removes its tab.
  if (!closing_)
    if (Tab* t = Find(b)) {
      t->view = nullptr;
      Forget(t->id);
    }
  if (--open_ == 0) CefQuitMessageLoop();
}

void Shell::OnAddressChange(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, const CefString& url) {
  if (f->IsMain() && url.ToString().rfind("tobari:", 0) != 0) LeftInternal(b->GetIdentifier());
  if (Tab* t = Find(b); t && f->IsMain()) {
    t->url = url;
    Changed();
  }
}

// UI errors go to stderr so they show up when running from a terminal; web page consoles stay quiet.
bool Shell::OnConsoleMessage(CefRefPtr<CefBrowser> b, cef_log_severity_t level, const CefString& message,
                             const CefString& source, int line) {
  if (IsUi(b) && level >= LOGSEVERITY_WARNING)
    fprintf(stderr, "ui: %s (%s:%d)\n", message.ToString().c_str(), source.ToString().c_str(), line);
  return false;
}

void Shell::OnTitleChange(CefRefPtr<CefBrowser> b, const CefString& title) {
  if (Tab* t = Find(b)) {
    t->title = title;
    Changed();
  }
}

void Shell::OnFaviconURLChange(CefRefPtr<CefBrowser> b, const std::vector<CefString>& urls) {
  if (Tab* t = Find(b)) {
    t->icon = urls.empty() ? "" : urls[0].ToString();
    Changed();
  }
}

void Shell::Blocked(int browser_id) {
  for (auto& t : tabs_)
    if (t.view && t.view->GetBrowser() && t.view->GetBrowser()->GetIdentifier() == browser_id) {
      ++t.blocked;
      Changed();
    }
}

void Shell::OnLoadStart(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, TransitionType) {
  if (Tab* t = Find(b); t && f->IsMain()) t->blocked = 0;
}

void Shell::OnLoadError(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, ErrorCode code, const CefString&,
                        const CefString& failed) {
  std::string url = failed;
  Tab* t = Find(b);
  if (!t || !f->IsMain() || code == ERR_ABORTED || url.rfind("https://", 0) != 0) return;
  // HTTPS-Only: the page was asked for over http and its https upgrade failed, so explain and offer http.
  if (WasUpgraded(UrlHost(url))) {
    t->internal_ok = true;
    f->LoadURL("tobari://https/#http://" + url.substr(8));
  }
}

CefRefPtr<CefResourceRequestHandler> Shell::GetResourceRequestHandler(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>,
                                                                      CefRefPtr<CefRequest>, bool, bool,
                                                                      const CefString&, bool&) {
  return PrivacyHandler();
}

void Shell::OnLoadingStateChange(CefRefPtr<CefBrowser> b, bool loading, bool back, bool fwd) {
  Tab* t = Find(b);
  if (!t) return;
  if (t->loading && !loading) Visited(*t);
  t->loading = loading;
  t->back = back;
  t->fwd = fwd;
  Changed();
}

bool Shell::OnBeforeBrowse(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, CefRefPtr<CefRequest> r, bool,
                           bool) {
  std::string url = r->GetURL();
  bool internal = IsInternal(url);
  // The UI never leaves tobari://ui/.
  if (IsUi(b)) return !(url.rfind("tobari://ui/", 0) == 0 || url == "about:blank");
  if (!internal) return false;
  Tab* t = Find(b);
  if (t && t->internal_ok) {
    t->internal_ok = false;
    return false;
  }
  // Built-in pages may link to each other; web pages may not link to them.
  return !IsInternal(f->GetURL());
}

bool Shell::OnBeforeDownload(CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem>, const CefString& name,
                             CefRefPtr<CefBeforeDownloadCallback> cb) {
  std::string dir = DownloadDir();
  mkdir(dir.c_str(), 0755);
  cb->Continue(FreeName(dir, name, [](const std::string& p) { return access(p.c_str(), F_OK) == 0; }), false);
  return true;
}

void Shell::OnDownloadUpdated(CefRefPtr<CefBrowser>, CefRefPtr<CefDownloadItem> item, CefRefPtr<CefDownloadItemCallback>) {
  std::string path = item->GetFullPath();
  if (path.empty()) return;
  auto d = CefDictionaryValue::Create();
  d->SetInt("id", static_cast<int>(item->GetId()));
  d->SetString("name", path.substr(path.find_last_of('/') + 1));
  d->SetInt("percent", item->GetPercentComplete());
  d->SetBool("done", item->IsComplete());
  d->SetBool("failed", item->IsCanceled() || item->IsInterrupted());
  Js("T.download(" + Json(d) + ")");
}

void Shell::OnBeforeContextMenu(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame>, CefRefPtr<CefContextMenuParams> p,
                                CefRefPtr<CefMenuModel> model) {
  if (IsUi(b)) {
    if (!(p->GetTypeFlags() & CM_TYPEFLAG_EDITABLE)) model->Clear();  // keep cut/copy/paste in text fields
    return;
  }
  if (!p->GetLinkUrl().empty()) {
    model->InsertItemAt(0, kMenuNewTab, "Open link in new tab");
    model->InsertSeparatorAt(1);
  }
}

bool Shell::OnContextMenuCommand(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame>, CefRefPtr<CefContextMenuParams> p,
                                 int id, EventFlags) {
  if (id != kMenuNewTab) return false;
  Tab* t = Find(b);
  NewTab(p->GetLinkUrl(), t ? t->ws : ws_, false);
  return true;
}

void Shell::OnFindResult(CefRefPtr<CefBrowser>, int, int count, const CefRect&, int active, bool) {
  Js("T.found(" + std::to_string(count) + "," + std::to_string(active) + ")");
}

void Shell::OnGotFocus(CefRefPtr<CefBrowser> b) {
  if (Tab* t = Find(b); t && t->id != focus_) {
    focus_ = t->id;
    Changed();
  }
}

bool Shell::OnShowPermissionPrompt(CefRefPtr<CefBrowser>, uint64_t, const CefString& origin, uint32_t,
                                   CefRefPtr<CefPermissionPromptCallback> cb) {
  // Device APIs stay blocked: every request is refused and the user is told. A per-site prompt can come later.
  cb->Continue(CEF_PERMISSION_RESULT_DENY);
  Toast("Blocked a permission request from " + origin.ToString());
  return true;
}

bool Shell::OnRequestMediaAccessPermission(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, const CefString& origin,
                                           uint32_t, CefRefPtr<CefMediaAccessCallback> cb) {
  cb->Cancel();
  Toast("Blocked camera or microphone access for " + origin.ToString());
  return true;
}

void Shell::OnDraggableRegionsChanged(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame>,
                                      const std::vector<CefDraggableRegion>& regions) {
  if (frame_ && frame_->GetBrowser() && b->IsSame(frame_->GetBrowser())) window_->SetDraggableRegions(regions);
}
