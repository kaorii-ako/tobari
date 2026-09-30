#include "window.h"

#include <algorithm>
#include <memory>

#include "include/base/cef_logging.h"
#include "include/cef_app.h"
#include "include/cef_parser.h"
#include "include/views/cef_box_layout.h"
#include "include/views/cef_fill_layout.h"
#include "include/wrapper/cef_helpers.h"

namespace tobari {
namespace {

constexpr char kUiUrl[] = "tobari://ui/index.html";
constexpr char kNewTabUrl[] = "tobari://ui/newtab.html";

std::string JsonEscape(const std::string& value) {
  std::string out;
  out.reserve(value.size() + 8);
  for (const char c : value) {
    switch (c) {
      case '"': out += "\\\""; break;
      case '\\': out += "\\\\"; break;
      case '\n': out += "\\n"; break;
      case '\r': out += "\\r"; break;
      case '\t': out += "\\t"; break;
      default:
        if (static_cast<unsigned char>(c) < 0x20) {
          char buf[8];
          snprintf(buf, sizeof(buf), "\\u%04x", c);
          out += buf;
        } else {
          out += c;
        }
    }
  }
  return out;
}

class ContentViewDelegate : public CefBrowserViewDelegate {
 public:
  ContentViewDelegate() = default;

  cef_runtime_style_t GetBrowserRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

 private:
  IMPLEMENT_REFCOUNTING(ContentViewDelegate);
  DISALLOW_COPY_AND_ASSIGN(ContentViewDelegate);
};

class UiViewDelegate : public CefBrowserViewDelegate {
 public:
  UiViewDelegate() = default;

  cef_runtime_style_t GetBrowserRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

 private:
  IMPLEMENT_REFCOUNTING(UiViewDelegate);
  DISALLOW_COPY_AND_ASSIGN(UiViewDelegate);
};

}  // namespace

// ---------------------------------------------------------------- UI client

class UiClient : public CefClient,
                 public CefLifeSpanHandler,
                 public CefRequestHandler {
 public:
  explicit UiClient(CefRefPtr<BrowserWindow> owner) : owner_(owner) {
    CefMessageRouterConfig config;
    router_ = CefMessageRouterBrowserSide::Create(config);
    handler_ = std::make_unique<Handler>(owner);
    router_->AddHandler(handler_.get(), false);
  }

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    owner_->SetUiBrowser(browser);
  }

  bool OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                CefRefPtr<CefFrame> frame,
                                CefProcessId source_process,
                                CefRefPtr<CefProcessMessage> message) override {
    return router_->OnProcessMessageReceived(browser, frame, source_process,
                                             message);
  }

  void OnRenderProcessTerminated(CefRefPtr<CefBrowser> browser,
                                 TerminationStatus status,
                                 int error_code,
                                 const CefString& error_string) override {
    router_->OnRenderProcessTerminated(browser);
    LOG(ERROR) << "tobari: chrome UI renderer terminated (" << error_string.ToString()
               << "); reloading";
    owner_->ReloadUi();
  }

 private:
  class Handler : public CefMessageRouterBrowserSide::Handler {
   public:
    explicit Handler(CefRefPtr<BrowserWindow> owner) : owner_(owner) {}

    bool OnQuery(CefRefPtr<CefBrowser> browser,
                 CefRefPtr<CefFrame> frame,
                 int64_t query_id,
                 const CefString& request,
                 bool persistent,
                 CefRefPtr<Callback> callback) override {
      CefRefPtr<CefValue> parsed = CefParseJSON(
          request, JSON_PARSER_ALLOW_TRAILING_COMMAS);
      if (!parsed || parsed->GetType() != VTYPE_DICTIONARY) {
        return false;
      }
      CefRefPtr<CefDictionaryValue> dict = parsed->GetDictionary();
      const std::string type = dict->GetString("type").ToString();

      if (type == "ready") {
        owner_->OnTabStateChanged(0);
      } else if (type == "new_tab") {
        owner_->NewTab(dict->HasKey("url") ? dict->GetString("url").ToString()
                                           : kNewTabUrl);
      } else if (type == "close_tab") {
        owner_->CloseTab(dict->GetInt("id"));
      } else if (type == "select_tab") {
        owner_->SelectTab(dict->GetInt("id"));
      } else if (type == "navigate") {
        owner_->Navigate(dict->GetString("url").ToString());
      } else if (type == "back") {
        owner_->GoBack();
      } else if (type == "forward") {
        owner_->GoForward();
      } else if (type == "reload") {
        owner_->Reload();
      } else if (type == "panel") {
        owner_->SetPanelOpen(dict->GetBool("open"));
      } else if (type == "chrome_height") {
        owner_->SetChromeHeight(dict->GetInt("height"));
      } else if (type == "toggle_blocking") {
        owner_->ToggleBlocking();
      } else if (type == "ui_error") {
        LOG(ERROR) << "tobari ui: " << dict->GetString("message").ToString();
      } else {
        callback->Failure(1, "unknown request");
        return true;
      }

      callback->Success("{}");
      return true;
    }

   private:
    CefRefPtr<BrowserWindow> owner_;
  };

  CefRefPtr<BrowserWindow> owner_;
  CefRefPtr<CefMessageRouterBrowserSide> router_;
  std::unique_ptr<Handler> handler_;

  IMPLEMENT_REFCOUNTING(UiClient);
  DISALLOW_COPY_AND_ASSIGN(UiClient);
};

// ----------------------------------------------------------- content client

class ContentClient : public CefClient,
                      public CefLifeSpanHandler,
                      public CefLoadHandler,
                      public CefDisplayHandler,
                      public CefKeyboardHandler {
 public:
  ContentClient(CefRefPtr<BrowserWindow> owner, int tab_id)
      : owner_(owner), tab_id_(tab_id) {}

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefKeyboardHandler> GetKeyboardHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override {
    owner_->OnContentBrowserCreated(tab_id_, browser);
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    owner_->OnContentBrowserClosing(tab_id_);
  }

  void OnLoadingStateChange(CefRefPtr<CefBrowser> browser,
                            bool isLoading,
                            bool canGoBack,
                            bool canGoForward) override {
    owner_->SetTabLoading(tab_id_, isLoading, canGoBack, canGoForward);
  }

  void OnTitleChange(CefRefPtr<CefBrowser> browser,
                     const CefString& title) override {
    owner_->SetTabTitle(tab_id_, title.ToString());
  }

  void OnAddressChange(CefRefPtr<CefBrowser> browser,
                       CefRefPtr<CefFrame> frame,
                       const CefString& url) override {
    if (frame && frame->IsMain()) {
      owner_->SetTabUrl(tab_id_, url.ToString());
    }
  }

  bool OnPreKeyEvent(CefRefPtr<CefBrowser> browser,
                     const CefKeyEvent& event,
                     CefEventHandle os_event,
                     bool* is_keyboard_shortcut) override {
    if (event.type != KEYEVENT_RAWKEYDOWN) {
      return false;
    }
    const bool ctrl = (event.modifiers & EVENTFLAG_CONTROL_DOWN) != 0;
    const bool alt = (event.modifiers & EVENTFLAG_ALT_DOWN) != 0;

    if (ctrl && event.windows_key_code == 'T') {
      owner_->NewTab(kNewTabUrl);
      return true;
    }
    if (ctrl && event.windows_key_code == 'W') {
      owner_->CloseTab(tab_id_);
      return true;
    }
    if (ctrl && event.windows_key_code == 'R') {
      owner_->Reload();
      return true;
    }
    if (ctrl && event.windows_key_code == 'L') {
      owner_->OnTabStateChanged(-1);
      return true;
    }
    if (ctrl && event.windows_key_code == 'B') {
      owner_->SetPanelOpen(true);
      return true;
    }
    if (alt && event.windows_key_code == 0x25) {
      owner_->GoBack();
      return true;
    }
    if (alt && event.windows_key_code == 0x27) {
      owner_->GoForward();
      return true;
    }
    return false;
  }

 private:
  CefRefPtr<BrowserWindow> owner_;
  const int tab_id_;

  IMPLEMENT_REFCOUNTING(ContentClient);
  DISALLOW_COPY_AND_ASSIGN(ContentClient);
};

// ---------------------------------------------------------- window delegate

class WindowDelegate : public CefWindowDelegate {
 public:
  explicit WindowDelegate(CefRefPtr<BrowserWindow> owner) : owner_(owner) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    owner_->OnWindowReady(window);
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    owner_->OnWindowGone();
  }

  CefSize GetPreferredSize(CefRefPtr<CefView> view) override {
    return CefSize(1280, 820);
  }

  bool CanResize(CefRefPtr<CefWindow> window) override { return true; }
  bool CanClose(CefRefPtr<CefWindow> window) override { return true; }

  cef_runtime_style_t GetWindowRuntimeStyle() override {
    return CEF_RUNTIME_STYLE_ALLOY;
  }

 private:
  CefRefPtr<BrowserWindow> owner_;

  IMPLEMENT_REFCOUNTING(WindowDelegate);
  DISALLOW_COPY_AND_ASSIGN(WindowDelegate);
};

// ----------------------------------------------------------- BrowserWindow

BrowserWindow::BrowserWindow() = default;

void BrowserWindow::CreateNew() {
  CEF_REQUIRE_UI_THREAD();
  CefRefPtr<BrowserWindow> self(new BrowserWindow());
  CefWindow::CreateTopLevelWindow(new WindowDelegate(self));
}

void BrowserWindow::OnWindowReady(CefRefPtr<CefWindow> window) {
  window_ = window;
  window_->SetTitle("Tobari");

  CefBrowserSettings settings;
  settings.background_color = CefColorSetARGB(255, 11, 11, 15);

  ui_view_ = CefBrowserView::CreateBrowserView(
      new UiClient(this), kUiUrl, settings, nullptr, nullptr,
      new UiViewDelegate());

  chrome_height_delegate_ = new FixedHeightDelegate(kChromeHeight);
  ui_panel_ = CefPanel::CreatePanel(chrome_height_delegate_);
  ui_panel_->SetToFillLayout();
  ui_panel_->AddChildView(ui_view_);

  content_panel_ = CefPanel::CreatePanel(nullptr);
  content_panel_->SetToFillLayout();

  CefBoxLayoutSettings box;
  box.horizontal = false;
  box.default_flex = 0;
  box.cross_axis_alignment = CEF_AXIS_ALIGNMENT_STRETCH;
  CefRefPtr<CefBoxLayout> layout = window_->SetToBoxLayout(box);
  window_->AddChildView(ui_panel_);
  window_->AddChildView(content_panel_);
  layout->SetFlexForView(ui_panel_, 0);
  layout->SetFlexForView(content_panel_, 1);

  window_->CenterWindow(CefSize(1280, 820));
  window_->Show();

  NewTab(kNewTabUrl);
}

void BrowserWindow::OnWindowGone() {
  window_ = nullptr;
  ui_view_ = nullptr;
  ui_panel_ = nullptr;
  ui_browser_ = nullptr;
  content_panel_ = nullptr;
  tabs_.clear();
  CefQuitMessageLoop();
}

void BrowserWindow::SetUiBrowser(CefRefPtr<CefBrowser> browser) {
  ui_browser_ = browser;
  ui_ready_ = true;
  PushState();
}

Tab* BrowserWindow::FindTab(int id) {
  auto it = std::find_if(tabs_.begin(), tabs_.end(),
                         [id](const Tab& t) { return t.id == id; });
  return it == tabs_.end() ? nullptr : &(*it);
}

Tab* BrowserWindow::ActiveTab() { return FindTab(active_id_); }

void BrowserWindow::NewTab(const std::string& url) {
  CEF_REQUIRE_UI_THREAD();
  if (!content_panel_) {
    return;
  }

  Tab tab;
  tab.id = next_id_++;
  tab.url = url;

  CefBrowserSettings settings;
  settings.background_color = CefColorSetARGB(255, 11, 11, 15);

  tab.view = CefBrowserView::CreateBrowserView(
      new ContentClient(this, tab.id), url, settings, nullptr, nullptr,
      new ContentViewDelegate());

  content_panel_->AddChildView(tab.view);
  tabs_.push_back(tab);
  active_id_ = tab.id;
  ApplyVisibility();
  PushState();
}

void BrowserWindow::CloseTab(int id) {
  CEF_REQUIRE_UI_THREAD();
  Tab* tab = FindTab(id);
  if (!tab) {
    return;
  }
  if (tab->browser) {
    tab->browser->GetHost()->CloseBrowser(true);
  }
  if (tab->view && content_panel_) {
    content_panel_->RemoveChildView(tab->view);
  }
  const bool was_active = (active_id_ == id);
  tabs_.erase(std::remove_if(tabs_.begin(), tabs_.end(),
                             [id](const Tab& t) { return t.id == id; }),
              tabs_.end());

  if (tabs_.empty()) {
    if (window_) {
      window_->Close();
    }
    return;
  }
  if (was_active) {
    active_id_ = tabs_.back().id;
  }
  ApplyVisibility();
  PushState();
}

void BrowserWindow::SelectTab(int id) {
  if (!FindTab(id)) {
    return;
  }
  active_id_ = id;
  ApplyVisibility();
  PushState();
}

void BrowserWindow::ApplyVisibility() {
  for (Tab& tab : tabs_) {
    if (!tab.view) {
      continue;
    }
    const bool active = tab.id == active_id_;
    tab.view->SetVisible(active);
    if (active) {
      tab.view->RequestFocus();
    }
  }
  if (content_panel_) {
    content_panel_->InvalidateLayout();
  }
}

void BrowserWindow::Navigate(const std::string& url) {
  Tab* tab = ActiveTab();
  if (tab && tab->browser) {
    tab->browser->GetMainFrame()->LoadURL(url);
  } else {
    NewTab(url);
  }
}

void BrowserWindow::GoBack() {
  Tab* tab = ActiveTab();
  if (tab && tab->browser) tab->browser->GoBack();
}

void BrowserWindow::GoForward() {
  Tab* tab = ActiveTab();
  if (tab && tab->browser) tab->browser->GoForward();
}

void BrowserWindow::Reload() {
  Tab* tab = ActiveTab();
  if (tab && tab->browser) tab->browser->Reload();
}

void BrowserWindow::SetPanelOpen(bool open) { panel_open_ = open; }

void BrowserWindow::SetChromeHeight(int height) {
  if (!chrome_height_delegate_ || !window_) {
    return;
  }
  const int clamped = std::max(kChromeHeight, std::min(height, 640));
  chrome_height_delegate_->SetHeight(clamped);
  ui_panel_->InvalidateLayout();
  window_->Layout();
}

void BrowserWindow::OnContentBrowserCreated(int tab_id,
                                            CefRefPtr<CefBrowser> browser) {
  Tab* tab = FindTab(tab_id);
  if (tab) {
    tab->browser = browser;
  }
  PushState();
}

void BrowserWindow::OnContentBrowserClosing(int tab_id) {
  Tab* tab = FindTab(tab_id);
  if (tab) {
    tab->browser = nullptr;
  }
}

void BrowserWindow::OnTabStateChanged(int tab_id) {
  if (tab_id == -1 && ui_browser_) {
    ui_browser_->GetMainFrame()->ExecuteJavaScript(
        "window.tobari && window.tobari.focusOmnibox()", "", 0);
    ui_view_->RequestFocus();
    return;
  }
  PushState();
}

void BrowserWindow::SetTabTitle(int tab_id, const std::string& title) {
  Tab* tab = FindTab(tab_id);
  if (!tab) return;
  tab->title = title;
  if (tab->id == active_id_ && window_) {
    window_->SetTitle(title.empty() ? "Tobari" : (title + " — Tobari"));
  }
  PushState();
}

void BrowserWindow::SetTabUrl(int tab_id, const std::string& url) {
  Tab* tab = FindTab(tab_id);
  if (!tab) return;
  tab->url = url;
  PushState();
}

void BrowserWindow::SetTabLoading(int tab_id, bool loading, bool back,
                                  bool forward) {
  Tab* tab = FindTab(tab_id);
  if (!tab) return;
  tab->loading = loading;
  tab->can_go_back = back;
  tab->can_go_forward = forward;
  PushState();
}

void BrowserWindow::ToggleBlocking() {
  blocking_enabled_ = !blocking_enabled_;
  PushState();
}

void BrowserWindow::ReloadUi() {
  ui_ready_ = false;
  if (ui_browser_) {
    ui_browser_->GetMainFrame()->LoadURL(kUiUrl);
  }
}

void BrowserWindow::NoteBlockedRequest() {
  ++blocked_count_;
  PushState();
}

void BrowserWindow::PushState() {
  if (!ui_ready_ || !ui_browser_) {
    return;
  }

  std::string json = "{\"tabs\":[";
  for (size_t i = 0; i < tabs_.size(); ++i) {
    const Tab& tab = tabs_[i];
    if (i) json += ",";
    json += "{\"id\":" + std::to_string(tab.id) +
            ",\"url\":\"" + JsonEscape(tab.url) + "\"" +
            ",\"title\":\"" + JsonEscape(tab.title) + "\"" +
            ",\"loading\":" + (tab.loading ? "true" : "false") +
            ",\"canGoBack\":" + (tab.can_go_back ? "true" : "false") +
            ",\"canGoForward\":" + (tab.can_go_forward ? "true" : "false") + "}";
  }
  json += "],\"activeId\":" + std::to_string(active_id_) +
          ",\"blocked\":" + std::to_string(blocked_count_) +
          ",\"blockingEnabled\":" + (blocking_enabled_ ? "true" : "false") + "}";

  ui_browser_->GetMainFrame()->ExecuteJavaScript(
      "window.tobari && window.tobari.setState(" + json + ")", "", 0);
}

}  // namespace tobari
