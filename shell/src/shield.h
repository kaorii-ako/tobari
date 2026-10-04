#pragma once

#include "include/cef_frame.h"
#include "include/cef_request.h"

namespace tobari {

// Serves https://tobari.internal/* to the bundled Tobari toolbar extension and
// to nothing else. A request is answered only when it comes from a frame whose
// URL is inside that extension; every other caller gets 403.
void RegisterShieldBridge();

// True when |request| was made by the bundled Tobari toolbar extension.
bool FromShieldExtension(CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request);

// True when the bridge would answer |request|: anything from the toolbar
// extension, and the one call (open the setup window) the new tab may make.
bool BridgeRequestAllowed(CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request);

}  // namespace tobari
