#include "app.h"

#include "client.h"
#include "paths.h"

namespace tobari {

App::App(std::vector<std::string> urls) : urls_(std::move(urls)) {}

void App::OnBeforeCommandLineProcessing(const CefString& process_type, CefRefPtr<CefCommandLine> command_line) {
  if (!process_type.empty()) return;
  const auto ext = ExeDir() / "extension";
  if (!command_line->HasSwitch("load-extension")) command_line->AppendSwitchWithValue("load-extension", ext.string());
  if (!command_line->HasSwitch("ozone-platform-hint")) command_line->AppendSwitchWithValue("ozone-platform-hint", "auto");
  command_line->AppendSwitch("enable-wayland-ime");
  command_line->AppendSwitch("no-default-browser-check");
  command_line->AppendSwitch("disable-background-networking");
}

void App::OnContextInitialized() {
  if (urls_.empty()) urls_.push_back("chrome://newtab/");
  for (const auto& url : urls_) {
    CefBrowserSettings settings;
    CefRefPtr<CefBrowserView> view =
        CefBrowserView::CreateBrowserView(Client::Get(), url, settings, nullptr, nullptr, new BrowserViewDelegate());
    CefWindow::CreateTopLevelWindow(new WindowDelegate(view));
  }
}

CefRefPtr<CefClient> App::GetDefaultClient() { return Client::Get(); }

}
