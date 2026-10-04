// Entry point for Tobari's macOS helper apps (renderer, GPU, plugin, alerts).
// Each helper enters Chromium's sandbox before loading the framework.

#include "include/cef_app.h"
#include "include/wrapper/cef_library_loader.h"
#include "schemes.h"

#if defined(CEF_USE_SANDBOX)
#include "include/cef_sandbox_mac.h"
#endif

namespace {

// Sub-processes must know the tobari:// scheme too, or its pages lose their
// origin and display isolation in the renderer.
class HelperApp : public CefApp {
 public:
  void OnRegisterCustomSchemes(CefRawPtr<CefSchemeRegistrar> registrar) override {
    tobari::RegisterTobariScheme(registrar);
  }

 private:
  IMPLEMENT_REFCOUNTING(HelperApp);
};

}  // namespace

int main(int argc, char* argv[]) {
#if defined(CEF_USE_SANDBOX)
  CefScopedSandboxContext sandbox_context;
  if (!sandbox_context.Initialize(argc, argv)) {
    return 1;
  }
#endif

  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInHelper()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);
  CefRefPtr<HelperApp> app(new HelperApp);
  return CefExecuteProcess(main_args, app, nullptr);
}
