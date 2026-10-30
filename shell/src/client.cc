#include "client.h"

#include "include/cef_app.h"
#include "include/wrapper/cef_helpers.h"

namespace tobari {

CefRefPtr<Client> Client::Get() {
  static CefRefPtr<Client> instance(new Client());
  return instance;
}

void Client::OnAfterCreated(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  ++browsers_;
}

void Client::OnBeforeClose(CefRefPtr<CefBrowser> browser) {
  CEF_REQUIRE_UI_THREAD();
  if (--browsers_ == 0) CefQuitMessageLoop();
}

bool BrowserViewDelegate::OnPopupBrowserViewCreated(CefRefPtr<CefBrowserView> browser_view,
                                                    CefRefPtr<CefBrowserView> popup_browser_view, bool is_devtools) {
  CefWindow::CreateTopLevelWindow(new WindowDelegate(popup_browser_view));
  return true;
}

void WindowDelegate::OnWindowCreated(CefRefPtr<CefWindow> window) {
  window->AddChildView(view_);
  window->SetTitle("Tobari");
  window->Show();
  view_->RequestFocus();
}

bool WindowDelegate::CanClose(CefRefPtr<CefWindow> window) {
  if (!view_) return true;
  CefRefPtr<CefBrowser> browser = view_->GetBrowser();
  return browser ? browser->GetHost()->TryCloseBrowser() : true;
}

bool WindowDelegate::GetLinuxWindowProperties(CefRefPtr<CefWindow> window, CefLinuxWindowProperties& properties) {
  CefString(&properties.wayland_app_id) = "dev.tobari.Tobari";
  CefString(&properties.wm_class_class) = "Tobari";
  CefString(&properties.wm_class_name) = "tobari";
  CefString(&properties.wm_role_name) = "browser";
  return true;
}

}
