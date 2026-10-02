#pragma once

#include <chrono>
#include <map>
#include <mutex>
#include <string>

#include "include/cef_client.h"
#include "include/cef_command_handler.h"
#include "include/cef_request_handler.h"
#include "include/cef_resource_request_handler.h"

namespace tobari {

class ChromeClient : public CefClient,
                     public CefLifeSpanHandler,
                     public CefFocusHandler,
                     public CefRequestHandler,
                     public CefResourceRequestHandler,
                     public CefCommandHandler {
 public:
  static CefRefPtr<ChromeClient> Get();

  void OpenWindow(const std::string& url);

  // Routes worker requests (which have no browser) through this client's
  // resource handler. Call once on the UI thread after context init.
  static void CoverWorkerRequests();

  // Opens |url| as a foreground tab in the most recently focused window, or in
  // a new window if none is open.
  void OpenInLastWindow(const std::string& url);

  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefFocusHandler> GetFocusHandler() override { return this; }

  void OnGotFocus(CefRefPtr<CefBrowser> browser) override;
  CefRefPtr<CefRequestHandler> GetRequestHandler() override { return this; }
  CefRefPtr<CefCommandHandler> GetCommandHandler() override { return this; }

  void OnAfterCreated(CefRefPtr<CefBrowser> browser) override;
  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override;

  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,
      bool is_navigation,
      bool is_download,
      const CefString& request_initiator,
      bool& disable_default_handling) override {
    return this;
  }

  ReturnValue OnBeforeResourceLoad(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefFrame> frame,
                                   CefRefPtr<CefRequest> request,
                                   CefRefPtr<CefCallback> callback) override;

  bool OnChromeCommand(CefRefPtr<CefBrowser> browser,
                       int command_id,
                       cef_window_open_disposition_t disposition) override;
  bool IsChromeAppMenuItemVisible(CefRefPtr<CefBrowser> browser, int command_id) override;
  bool IsChromePageActionIconVisible(cef_chrome_page_action_icon_type_t icon_type) override;
  bool IsChromeToolbarButtonVisible(cef_chrome_toolbar_button_type_t button_type) override;

  int BlockedForUrl(const std::string& url);
  int BlockedTotal();

 private:
  ChromeClient() = default;

  struct Page {
    std::string document;
    int blocked = 0;
  };

  std::mutex mutex_;
  std::map<int, Page> pages_;
  int blocked_total_ = 0;
  int open_browsers_ = 0;
  CefRefPtr<CefBrowser> last_focused_;
  std::string pending_tab_url_;
  std::chrono::steady_clock::time_point pending_since_;

  IMPLEMENT_REFCOUNTING(ChromeClient);
};

}  // namespace tobari
