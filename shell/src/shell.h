// The browser window: one frame view (tobari://ui/, the sidebar, top bar and panels) with page
// tabs and the command bar placed on top of it as overlays.
#pragma once

#include <map>
#include <string>
#include <vector>

#include <functional>

#include "include/cef_client.h"
#include "include/cef_command_line.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"

struct Tab {
  int id = 0;
  CefRefPtr<CefBrowserView> view;  // null while the tab sleeps
  CefRefPtr<CefOverlayController> ov;
  std::string url, title, icon, ws;
  bool loading = false, back = false, fwd = false;
  bool internal_ok = false;  // the next navigation to tobari:// came from Tobari itself
  int64_t used = 0;          // when the tab was last shown, in seconds
  int blocked = 0;           // requests blocked since the last main-frame load
};

struct Visit {
  std::string url, title;
  int64_t last = 0;
  int count = 0;
  bool bookmark = false;
};

class Shell : public CefClient,
              public CefLifeSpanHandler,
              public CefDisplayHandler,
              public CefLoadHandler,
              public CefRequestHandler,
              public CefDownloadHandler,
              public CefContextMenuHandler,
              public CefFindHandler,
              public CefFocusHandler,
              public CefPermissionHandler,
              public CefDragHandler {
 public:
  static void Start(CefRefPtr<CefCommandLine> cl);
  static Shell* Get();

  // Called from the tobari:// scheme handler on the UI thread. Returns the JSON reply.
  std::string Api(CefRefPtr<CefBrowser> caller, const std::string& cmd, CefRefPtr<CefDictionaryValue> arg);
  bool IsUi(CefRefPtr<CefBrowser> b);
  void Relaunch(CefRefPtr<CefCommandLine> cl);
  // One CLI request (ctl.h). done(ok, body) runs on the UI thread, maybe later.
  void Ctl(const std::string& cmd, const std::string& arg, std::function<void(bool, const std::string&)> done);
  // The privacy handler blocked a request for this browser.
  void Blocked(int browser_id);

  // Window delegate calls.
  void OnWindowCreated(CefRefPtr<CefWindow> window);
  bool CanClose();
  void OnAccelerator(int id);
  bool OnPopupView(CefRefPtr<CefBrowserView> opener, CefRefPtr<CefBrowserView> popup);

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefLoadHandler> GetLoadHandler() override { return this; }
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefDownloadHandler> GetDownloadHandler() override { return this; }
  CefRefPtr<CefContextMenuHandler> GetContextMenuHandler() override { return this; }
  CefRefPtr<CefFindHandler> GetFindHandler() override { return this; }
  CefRefPtr<CefFocusHandler> GetFocusHandler() override { return this; }
  CefRefPtr<CefPermissionHandler> GetPermissionHandler() override { return this; }
  CefRefPtr<CefDragHandler> GetDragHandler() override { return this; }

  bool OnBeforePopup(CefRefPtr<CefBrowser> browser, CefRefPtr<CefFrame> frame, int popup_id,
                     const CefString& target_url, const CefString& target_frame_name,
                     CefLifeSpanHandler::WindowOpenDisposition disposition, bool user_gesture, const CefPopupFeatures& features,
                     CefWindowInfo& info, CefRefPtr<CefClient>& client, CefBrowserSettings& settings,
                     CefRefPtr<CefDictionaryValue>& extra, bool* no_js_access) override;
  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override { ++open_; }
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  void OnAddressChange(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, const CefString& url) override;
  void OnTitleChange(CefRefPtr<CefBrowser> b, const CefString& title) override;
  void OnFaviconURLChange(CefRefPtr<CefBrowser> b, const std::vector<CefString>& urls) override;
  bool OnConsoleMessage(CefRefPtr<CefBrowser> b, cef_log_severity_t level, const CefString& message,
                        const CefString& source, int line) override;
  void OnLoadingStateChange(CefRefPtr<CefBrowser> b, bool loading, bool back, bool fwd) override;
  void OnLoadStart(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, TransitionType type) override;
  void OnLoadError(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, ErrorCode code, const CefString& text,
                   const CefString& url) override;

  bool OnBeforeBrowse(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, CefRefPtr<CefRequest> r,
                      bool user_gesture, bool is_redirect) override;
  // Runs on the IO thread.
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f,
                                                                 CefRefPtr<CefRequest> r, bool is_navigation,
                                                                 bool is_download, const CefString& initiator,
                                                                 bool& disable_default) override;

  bool OnBeforeDownload(CefRefPtr<CefBrowser> b, CefRefPtr<CefDownloadItem> item, const CefString& name,
                        CefRefPtr<CefBeforeDownloadCallback> cb) override;
  void OnDownloadUpdated(CefRefPtr<CefBrowser> b, CefRefPtr<CefDownloadItem> item,
                         CefRefPtr<CefDownloadItemCallback> cb) override;

  void OnBeforeContextMenu(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, CefRefPtr<CefContextMenuParams> p,
                           CefRefPtr<CefMenuModel> model) override;
  bool OnContextMenuCommand(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, CefRefPtr<CefContextMenuParams> p,
                            int id, EventFlags flags) override;

  void OnFindResult(CefRefPtr<CefBrowser> b, int id, int count, const CefRect& sel, int active,
                    bool final_update) override;
  void OnGotFocus(CefRefPtr<CefBrowser> b) override;

  bool OnShowPermissionPrompt(CefRefPtr<CefBrowser> b, uint64_t id, const CefString& origin, uint32_t perms,
                              CefRefPtr<CefPermissionPromptCallback> cb) override;
  bool OnRequestMediaAccessPermission(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, const CefString& origin,
                                      uint32_t perms, CefRefPtr<CefMediaAccessCallback> cb) override;

  void OnDraggableRegionsChanged(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f,
                                 const std::vector<CefDraggableRegion>& regions) override;

 private:
  Tab* Find(CefRefPtr<CefBrowser> b);
  Tab* ById(int id);
  int NewTab(const std::string& url, const std::string& ws, bool select, CefRefPtr<CefBrowserView> view = nullptr);
  Tab* Current();
  void Forget(int id);
  void LoadHistory();
  void Wake(Tab& t);
  void Sleep(Tab& t);
  void Close(int id);
  void RaiseCmd();
  void Select(int id);
  void ShowWorkspace(const std::string& ws);
  void Go(Tab& t, const std::string& url);
  void Layout();
  void ShowCmd(bool show);
  void Changed();
  void Push();
  void Js(const std::string& code);
  void Toast(const std::string& text);
  void SaveSession();
  void LoadSession();
  void Visited(const Tab& t);
  // Applies one history.jsonl record {u, t, s, n?, b?} to history_ (n visits, b bookmarked).
  void Merge(CefRefPtr<CefDictionaryValue> d);
  // Appends records to history.jsonl (mode 0600).
  void AppendHistory(const std::string& lines);
  std::string SearchHistory(const std::string& q);
  void Tick();

  CefRefPtr<CefWindow> window_;
  CefRefPtr<CefBrowserView> frame_, cmd_;
  CefRefPtr<CefOverlayController> cmd_ov_;
  std::vector<Tab> tabs_;
  std::vector<Visit> history_;
  std::map<std::string, size_t> visit_index_;
  std::string ui_blob_ = "{}", demo_, ws_ = "main";
  std::vector<std::string> start_urls_;
  int active_ = 0, split_ = 0, focus_ = 0, next_id_ = 1, open_ = 0;
  int popup_disposition_ = 0;
  CefRect main_rect_, split_rect_, cmd_rect_;
  bool cmd_open_ = false, ui_ready_ = false, push_queued_ = false, save_queued_ = false, closing_ = false;

  IMPLEMENT_REFCOUNTING(Shell);
};
