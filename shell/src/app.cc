#include "app.h"

#include "include/cef_scheme.h"
#include "blocking.h"
#include "store.h"
#include "scheme.h"
#include "window.h"

namespace tobari {

App::App() = default;

void App::OnBeforeCommandLineProcessing(const CefString& process_type,
                                        CefRefPtr<CefCommandLine> command_line) {
  if (!process_type.empty()) {
    return;
  }

  if (!command_line->HasSwitch("ozone-platform")) {
    command_line->AppendSwitchWithValue("ozone-platform", "wayland");
  }

  command_line->AppendSwitch("disable-breakpad");
  command_line->AppendSwitch("disable-crash-reporter");
  command_line->AppendSwitch("disable-domain-reliability");
  command_line->AppendSwitch("no-pings");
  command_line->AppendSwitchWithValue("metrics-recording-only", "");
  command_line->AppendSwitch("disable-background-networking");
  command_line->AppendSwitch("disable-component-update");
  command_line->AppendSwitch("disable-sync");
}

void App::OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) {
  RegisterTobariScheme(registrar);
}

void App::OnContextInitialized() {
  RegisterTobariSchemeHandler();
  Blocking::Get().Load();
  Store::Get().Load();
  BrowserWindow::CreateNew();
}

void App::OnContextCreated(CefRefPtr<CefBrowser> browser,
                           CefRefPtr<CefFrame> frame,
                           CefRefPtr<CefV8Context> context) {
  if (!renderer_router_) {
    CefMessageRouterConfig config;
    renderer_router_ = CefMessageRouterRendererSide::Create(config);
  }
  renderer_router_->OnContextCreated(browser, frame, context);
}

void App::OnContextReleased(CefRefPtr<CefBrowser> browser,
                            CefRefPtr<CefFrame> frame,
                            CefRefPtr<CefV8Context> context) {
  if (renderer_router_) {
    renderer_router_->OnContextReleased(browser, frame, context);
  }
}

bool App::OnProcessMessageReceived(CefRefPtr<CefBrowser> browser,
                                   CefRefPtr<CefFrame> frame,
                                   CefProcessId source_process,
                                   CefRefPtr<CefProcessMessage> message) {
  if (renderer_router_) {
    return renderer_router_->OnProcessMessageReceived(browser, frame,
                                                      source_process, message);
  }
  return false;
}

}  // namespace tobari
