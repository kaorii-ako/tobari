#pragma once

#include "include/cef_app.h"
#include "include/cef_resource_bundle_handler.h"

namespace tobari {

class App : public CefApp, public CefBrowserProcessHandler, public CefResourceBundleHandler {
 public:
  App() = default;

  CefRefPtr<CefBrowserProcessHandler> GetBrowserProcessHandler() override { return this; }
  CefRefPtr<CefResourceBundleHandler> GetResourceBundleHandler() override { return this; }

  bool GetLocalizedString(int string_id, CefString& string) override;
  bool GetDataResource(int resource_id, void*& data, size_t& data_size) override { return false; }
  bool GetDataResourceForScale(int resource_id, ScaleFactor scale_factor, void*& data,
                               size_t& data_size) override {
    return false;
  }

  void OnBeforeCommandLineProcessing(const CefString& process_type,
                                     CefRefPtr<CefCommandLine> command_line) override;
  void OnContextInitialized() override;
  CefRefPtr<CefClient> GetDefaultClient() override;
  bool OnAlreadyRunningAppRelaunch(CefRefPtr<CefCommandLine> command_line,
                                   const CefString& current_directory) override;

 private:
  IMPLEMENT_REFCOUNTING(App);
  DISALLOW_COPY_AND_ASSIGN(App);
};

}  // namespace tobari
