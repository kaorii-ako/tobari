#include "welcome_window.h"

#include "include/cef_app.h"
#include "include/cef_client.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_window.h"

#include <vector>

namespace tobari {
namespace {

constexpr char kWelcomeUrl[] = "tobari://welcome/";

CefRefPtr<CefWindow> g_window;
bool g_quit_after_close = false;

class WelcomeClient : public CefClient,
                      public CefLifeSpanHandler,
                      public CefDisplayHandler,
                      public CefDragHandler {
 public:
  CefRefPtr<CefLifeSpanHandler> GetLifeSpanHandler() override { return this; }
  CefRefPtr<CefDisplayHandler> GetDisplayHandler() override { return this; }
  CefRefPtr<CefDragHandler> GetDragHandler() override { return this; }

  // The window is frameless and the page draws its own header; the parts it
  // marks with -webkit-app-region: drag move the window.
  void OnDraggableRegionsChanged(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame> frame,
                                 const std::vector<CefDraggableRegion>& regions) override {
    if (g_window && frame->IsMain()) g_window->SetDraggableRegions(regions);
  }

  // The setup page never opens windows of its own; links it offers are opened
  // in the main window through its API.
  bool OnBeforePopup(CefRefPtr<CefBrowser>, CefRefPtr<CefFrame>, int, const CefString&,
                     const CefString&, CefLifeSpanHandler::WindowOpenDisposition, bool,
                     const CefPopupFeatures&, CefWindowInfo&, CefRefPtr<CefClient>&,
                     CefBrowserSettings&, CefRefPtr<CefDictionaryValue>&, bool*) override {
    return true;
  }

  void OnTitleChange(CefRefPtr<CefBrowser> browser, const CefString& title) override {
    if (g_window) g_window->SetTitle(title);
  }

  void OnBeforeClose(CefRefPtr<CefBrowser> browser) override {
    if (g_quit_after_close) {
      g_quit_after_close = false;
      CefQuitMessageLoop();
    }
  }

 private:
  IMPLEMENT_REFCOUNTING(WelcomeClient);
};

class WelcomeViewDelegate : public CefBrowserViewDelegate {
 public:
  // Alloy style: a bare browser view, without Chromium's tab strip and
  // toolbar. A Chrome-style window refuses further Chrome-style views, and
  // this window needs none of that interface anyway.
  cef_runtime_style_t GetBrowserRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }

 private:
  IMPLEMENT_REFCOUNTING(WelcomeViewDelegate);
};

class WelcomeWindowDelegate : public CefWindowDelegate {
 public:
  explicit WelcomeWindowDelegate(CefRefPtr<CefBrowserView> view) : view_(view) {}

  void OnWindowCreated(CefRefPtr<CefWindow> window) override {
    window->AddChildView(view_);
    window->CenterWindow(CefSize(600, 760));
    window->Show();
    view_->RequestFocus();
  }

  void OnWindowDestroyed(CefRefPtr<CefWindow> window) override {
    view_ = nullptr;
    g_window = nullptr;
  }

  // Closing the window asks the page's browser to close first, so it unloads
  // cleanly; the window goes when the browser has.
  bool CanClose(CefRefPtr<CefWindow> window) override {
    CefRefPtr<CefBrowser> browser = view_ ? view_->GetBrowser() : nullptr;
    return browser ? browser->GetHost()->TryCloseBrowser() : true;
  }

  // Frameless, with the header drawn by the page: desktops that do not
  // decorate Wayland windows (GNOME) would otherwise give it no title bar.
  bool IsFrameless(CefRefPtr<CefWindow>) override { return true; }

  CefSize GetPreferredSize(CefRefPtr<CefView>) override { return CefSize(600, 760); }
  CefSize GetMinimumSize(CefRefPtr<CefView>) override { return CefSize(480, 600); }
  bool CanMaximize(CefRefPtr<CefWindow>) override { return false; }
  cef_runtime_style_t GetWindowRuntimeStyle() override { return CEF_RUNTIME_STYLE_ALLOY; }

  // Same app id and window class as the browser windows, so the dock and
  // window switcher show it under Tobari's name and icon.
  bool GetLinuxWindowProperties(CefRefPtr<CefWindow>, CefLinuxWindowProperties& properties) override {
    CefString(&properties.wayland_app_id) = "dev.tobari.Browser";
    CefString(&properties.wm_class_class) = "dev.tobari.Browser";
    CefString(&properties.wm_class_name) = "dev.tobari.Browser";
    CefString(&properties.wm_role_name) = "tobari-setup";
    return true;
  }

 private:
  CefRefPtr<CefBrowserView> view_;

  IMPLEMENT_REFCOUNTING(WelcomeWindowDelegate);
};

}  // namespace

bool WelcomeWindowOpen() { return g_window != nullptr; }

void ShowWelcomeWindow() {
  if (g_window) {
    g_window->Show();
    g_window->Activate();
    return;
  }
  CefBrowserSettings settings;
  CefRefPtr<CefBrowserView> view = CefBrowserView::CreateBrowserView(
      new WelcomeClient(), kWelcomeUrl, settings, nullptr, nullptr, new WelcomeViewDelegate());
  g_window = CefWindow::CreateTopLevelWindow(new WelcomeWindowDelegate(view));
}

void CloseWelcomeWindow(bool then_quit) {
  if (!g_window) {
    if (then_quit) CefQuitMessageLoop();
    return;
  }
  g_quit_after_close = then_quit;
  g_window->Close();
}

}  // namespace tobari
