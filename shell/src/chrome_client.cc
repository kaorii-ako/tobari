#include "chrome_client.h"

#include <chrono>
#include <cstdio>

#include "bangs.h"
#include "blocking.h"
#include "include/cef_app.h"
#include "include/cef_browser.h"
#include "include/cef_command_ids.h"
#include "include/cef_request_context.h"
#include "shield.h"
#include "welcome_window.h"

namespace tobari {
namespace {

std::string AdblockTypeFor(CefRequest::ResourceType type) {
  switch (type) {
    case RT_MAIN_FRAME: return "document";
    case RT_SUB_FRAME: return "subdocument";
    case RT_STYLESHEET: return "stylesheet";
    case RT_SCRIPT: return "script";
    case RT_IMAGE: return "image";
    case RT_FONT_RESOURCE: return "font";
    case RT_XHR: return "xmlhttprequest";
    case RT_MEDIA: return "media";
    case RT_PING: return "ping";
    case RT_CSP_REPORT: return "csp_report";
    case RT_OBJECT: return "object";
    case RT_WORKER:
    case RT_SHARED_WORKER:
    case RT_SERVICE_WORKER: return "script";
    case RT_FAVICON: return "image";
    default: return "other";
  }
}

bool Exempt(const std::string& url) {
  static const char* const kPrefixes[] = {
      "tobari:", "chrome:", "chrome-extension:", "chrome-untrusted:", "devtools:",
      "data:", "blob:", "about:", "file:",
  };
  for (const char* p : kPrefixes) {
    if (url.rfind(p, 0) == 0) return true;
  }
  return false;
}

// Commands that exist only to reach a Google service, or Google's own
// product surfaces. Tobari has no account system and no backend, so these are
// suppressed rather than left as dead menu items.
bool IsGoogleServiceCommand(int id) {
  switch (id) {
    case IDC_SHOW_SIGNIN:
    case IDC_SHOW_SIGNIN_WHEN_PAUSED:
    case IDC_SHOW_SYNC_SETTINGS:
    case IDC_TURN_ON_SYNC:
    case IDC_SHOW_SYNC_PASSPHRASE_DIALOG:
    case IDC_SHOW_AVATAR_MENU:
    case IDC_SEND_TAB_TO_SELF:
    case IDC_SHOW_TRANSLATE:
    case IDC_FEEDBACK:
    case IDC_HELP_PAGE_VIA_KEYBOARD:
    case IDC_HELP_PAGE_VIA_MENU:
    case IDC_CHROME_TIPS:
    case IDC_CHROME_WHATS_NEW:
    case IDC_SHOW_GOOGLE_LENS_SHORTCUT:
    case IDC_ORGANIZE_TABS:
      return true;
    default:
      return id >= 53300 && id <= 53399;
  }
}

}  // namespace

CefRefPtr<ChromeClient> ChromeClient::Get() {
  static CefRefPtr<ChromeClient> instance(new ChromeClient());
  return instance;
}

// Requests made by service and shared workers have no browser, so CEF never
// asks a client about them; it asks a request context handler instead. This
// context shares the global profile's storage and exists only to route those
// requests through the same blocker as everything else.
class WorkerRequests : public CefRequestContextHandler {
 public:
  CefRefPtr<CefResourceRequestHandler> GetResourceRequestHandler(
      CefRefPtr<CefBrowser> browser,
      CefRefPtr<CefFrame> frame,
      CefRefPtr<CefRequest> request,
      bool is_navigation,
      bool is_download,
      const CefString& request_initiator,
      bool& disable_default_handling) override {
    return ChromeClient::Get();
  }

 private:
  IMPLEMENT_REFCOUNTING(WorkerRequests);
};

void ChromeClient::CoverWorkerRequests() {
  static CefRefPtr<CefRequestContext> context = CefRequestContext::CreateContext(
      CefRequestContext::GetGlobalContext(), new WorkerRequests());
}

void ChromeClient::OpenWindow(const std::string& url) {
  CefWindowInfo info;
  info.runtime_style = CEF_RUNTIME_STYLE_CHROME;
  CefBrowserSettings settings;
  CefBrowserHost::CreateBrowser(info, this, url, settings, nullptr, nullptr);
}

void ChromeClient::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  std::string pending;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    ++open_browsers_;
    browsers_[browser->GetIdentifier()] = browser;
    if (!last_focused_) last_focused_ = browser;
    // Only the tab IDC_NEW_TAB just made may take a queued launch URL: never a
    // page-opened popup, and never anything after the request has gone stale.
    const bool fresh = std::chrono::steady_clock::now() - pending_since_ < std::chrono::seconds(5);
    if (fresh && !browser->IsPopup()) {
      pending.swap(pending_tab_url_);
    } else if (!fresh) {
      pending_tab_url_.clear();
    }
  }
  if (!pending.empty()) browser->GetMainFrame()->LoadURL(pending);
}

void ChromeClient::OnGotFocus(CefRefPtr<CefBrowser> browser) {
  std::lock_guard<std::mutex> lock(mutex_);
  last_focused_ = browser;
}

void ChromeClient::OpenInLastWindow(const std::string& url) {
  CefRefPtr<CefBrowser> target;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    target = last_focused_;
  }
  if (!target || !target->GetHost()->CanExecuteChromeCommand(IDC_NEW_TAB)) {
    OpenWindow(url);
    return;
  }
  {
    std::lock_guard<std::mutex> lock(mutex_);
    pending_tab_url_ = url;
    pending_since_ = std::chrono::steady_clock::now();
  }
  target->GetHost()->ExecuteChromeCommand(IDC_NEW_TAB, CEF_WOD_NEW_FOREGROUND_TAB);
}

void ChromeClient::CloseAllBrowsers(bool force) {
  std::vector<CefRefPtr<CefBrowser>> all;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    for (const auto& entry : browsers_) all.push_back(entry.second);
  }
  if (all.empty()) {
    CefQuitMessageLoop();
    return;
  }
  for (const auto& browser : all) browser->GetHost()->CloseBrowser(force);
}

void ChromeClient::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  bool quit = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    pages_.erase(browser->GetIdentifier());
    browsers_.erase(browser->GetIdentifier());
    if (last_focused_ && last_focused_->IsSame(browser)) last_focused_ = nullptr;
    quit = --open_browsers_ <= 0;
  }
  if (quit) {
    // The setup window is not a browser window of this client; close it too,
    // and end the loop once it has gone.
    CloseWelcomeWindow(true);
  }
}

CefResourceRequestHandler::ReturnValue ChromeClient::OnBeforeResourceLoad(
    CefRefPtr<CefBrowser> browser,
    CefRefPtr<CefFrame> frame,
    CefRefPtr<CefRequest> request,
    CefRefPtr<CefCallback> callback) {
  const std::string url = request->GetURL().ToString();
  const CefRequest::ResourceType type = request->GetResourceType();

  if (type == RT_MAIN_FRAME) {
    std::string target;
    if (ResolveBangSearch(url, &target)) {
      request->SetURL(target);
    }
    if (browser) {
      std::lock_guard<std::mutex> lock(mutex_);
      pages_[browser->GetIdentifier()] = Page{request->GetURL().ToString(), 0};
    }
    return RV_CONTINUE;
  }

  // The bridge answers only the toolbar extension. Anyone else gets the same
  // network error an unknown host would, so pages cannot use it to tell
  // Tobari apart from other Chromium browsers.
  if (url.rfind("https://tobari.internal/", 0) == 0) {
    return BridgeRequestAllowed(frame, request) ? RV_CONTINUE : RV_CANCEL;
  }

  if (Exempt(url)) return RV_CONTINUE;

  Blocking& blocking = Blocking::Get();
  if (!blocking.Ready()) return RV_CONTINUE;

  std::string document;
  if (browser && browser->GetMainFrame()) {
    document = browser->GetMainFrame()->GetURL().ToString();
  } else {
    // A worker request: the site it runs for is its first party.
    document = request->GetFirstPartyForCookies().ToString();
  }
  // Requests extensions make for themselves are theirs to make, as in Chrome
  // where one extension cannot filter another's traffic.
  if (document.rfind("chrome-extension:", 0) == 0) return RV_CONTINUE;
  const std::string host = HostOf(document);
  if (!host.empty() && blocking.HostDisabled(host)) return RV_CONTINUE;

  if (blocking.ShouldBlock(url, document, AdblockTypeFor(type), request->GetMethod().ToString())) {
    std::lock_guard<std::mutex> lock(mutex_);
    if (browser) {
      Page& page = pages_[browser->GetIdentifier()];
      page.document = document;
      ++page.blocked;
    }
    ++blocked_total_;
    return RV_CANCEL;
  }
  return RV_CONTINUE;
}

bool ChromeClient::OnChromeCommand(CefRefPtr<CefBrowser> browser,
                                   int command_id,
                                   cef_window_open_disposition_t disposition) {
  return IsGoogleServiceCommand(command_id);
}

bool ChromeClient::IsChromeAppMenuItemVisible(CefRefPtr<CefBrowser> browser, int command_id) {
  return !IsGoogleServiceCommand(command_id);
}

bool ChromeClient::IsChromePageActionIconVisible(cef_chrome_page_action_icon_type_t icon_type) {
  switch (icon_type) {
    case CEF_CPAIT_TRANSLATE:
    case CEF_CPAIT_PRICE_TRACKING:
    case CEF_CPAIT_PRICE_INSIGHTS:
    case CEF_CPAIT_PRODUCT_SPECIFICATIONS:
    case CEF_CPAIT_DISCOUNTS:
    case CEF_CPAIT_LENS_OVERLAY:
    case CEF_CPAIT_LENS_OVERLAY_HOMEWORK:
    case CEF_CPAIT_AI_MODE:
    case CEF_CPAIT_GLIC:
    case CEF_CPAIT_INDIGO:
    case CEF_CPAIT_OPTIMIZATION_GUIDE:
    case CEF_CPAIT_COLLABORATION_MESSAGING:
    case CEF_CPAIT_SHARING_HUB:
    case CEF_CPAIT_CLICK_TO_CALL:
    case CEF_CPAIT_SMS_REMOTE_FETCHER:
    case CEF_CPAIT_PAYMENTS_OFFER_NOTIFICATION:
    case CEF_CPAIT_VIRTUAL_CARD_ENROLL:
    case CEF_CPAIT_VIRTUAL_CARD_INFORMATION:
    case CEF_CPAIT_LOCAL_CARD_MIGRATION:
    case CEF_CPAIT_SAVE_IBAN:
    case CEF_CPAIT_WALLET_REMINDER_NOTICE:
    case CEF_CPAIT_PAYMENTS_CHURNED_USERS:
    case CEF_CPAIT_AUTOFILL_PAYMENT:
    case CEF_CPAIT_CONTEXTUAL_SIDE_PANEL:
    case CEF_CPAIT_ANCHORED_CONTEXTUAL_CUE:
    case CEF_CPAIT_JS_OPTIMIZATIONS:
    case CEF_CPAIT_RECORD_REPLAY:
      return false;
    default:
      return true;
  }
}

bool ChromeClient::IsChromeToolbarButtonVisible(cef_chrome_toolbar_button_type_t button_type) {
  return button_type != CEF_CTBT_AVATAR;
}

int ChromeClient::BlockedForUrl(const std::string& url) {
  std::lock_guard<std::mutex> lock(mutex_);
  int best = 0;
  for (const auto& entry : pages_) {
    if (entry.second.document == url && entry.second.blocked > best) best = entry.second.blocked;
  }
  return best;
}

int ChromeClient::BlockedTotal() {
  std::lock_guard<std::mutex> lock(mutex_);
  return blocked_total_;
}

}  // namespace tobari
