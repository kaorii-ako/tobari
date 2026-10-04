// macOS entry point for the browser process. Sub-processes run from the
// helper apps inside the bundle (helper_mac.cc), so unlike main.cc on Linux
// this never calls CefExecuteProcess.

#import <Cocoa/Cocoa.h>

#include <string>

#include "include/cef_app.h"
#include "include/cef_application_mac.h"
#include "include/wrapper/cef_library_loader.h"

#include "app.h"
#include "chrome_client.h"
#include "defaults.h"
#include "paths.h"

// CEF requires the NSApplication to implement CefAppProtocol so it can tell
// when an event is being dispatched.
@interface TobariApplication : NSApplication <CefAppProtocol> {
 @private
  BOOL handlingSendEvent_;
}
@end

@implementation TobariApplication
- (BOOL)isHandlingSendEvent {
  return handlingSendEvent_;
}

- (void)setHandlingSendEvent:(BOOL)handlingSendEvent {
  handlingSendEvent_ = handlingSendEvent;
}

- (void)sendEvent:(NSEvent*)event {
  CefScopedSendingEvent sendingEventScoper;
  [super sendEvent:event];
}

// Quit from the Dock or the system: close the browsers so profiles are
// written out, then the last close ends the message loop.
- (void)terminate:(id)sender {
  tobari::ChromeClient::Get()->CloseAllBrowsers(false);
}
@end

@interface TobariAppDelegate : NSObject <NSApplicationDelegate>
@end

@implementation TobariAppDelegate
- (BOOL)applicationSupportsSecureRestorableState:(NSApplication*)app {
  return YES;
}
@end

int main(int argc, char* argv[]) {
  CefScopedLibraryLoader library_loader;
  if (!library_loader.LoadInMain()) {
    return 1;
  }

  CefMainArgs main_args(argc, argv);

  @autoreleasepool {
    [TobariApplication sharedApplication];

    CefRefPtr<tobari::App> app(new tobari::App);
    tobari::SeedNewProfile();

    CefSettings settings;
    settings.no_sandbox = false;
    const char* log_env = getenv("TOBARI_LOG");
    settings.log_severity = (log_env && std::string(log_env) == "info") ? LOGSEVERITY_INFO
                                                                       : LOGSEVERITY_WARNING;
    CefString(&settings.root_cache_path) = tobari::ProfileDir();

    if (!CefInitialize(main_args, settings, app.get(), nullptr)) {
      return CefGetExitCode();
    }

    TobariAppDelegate* delegate = [[TobariAppDelegate alloc] init];
    [NSApp setDelegate:delegate];

    CefRunMessageLoop();
    CefShutdown();
  }
  return 0;
}
