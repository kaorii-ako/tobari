#pragma once

#include <string>
#include <vector>

#include "include/cef_app.h"

namespace tobari {

class App : public CefApp, public CefBrowserProcessHandler {
 public:
  explicit App(std::vector<std::string> urls);

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  void OnBeforeCommandLineProcessing(const CefString& process_type, CefRefPtr<CefCommandLine> command_line) override;
  void OnContextInitialized() override;
  CefRefPtr<CefClient> GetDefaultClient() override;

 private:
  std::vector<std::string> urls_;
  IMPLEMENT_REFCOUNTING(App);
  DISALLOW_COPY_AND_ASSIGN(App);
};

}
