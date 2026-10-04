#pragma once

#include "include/cef_scheme.h"

namespace tobari {

// tobari:// — Tobari's own pages, like chrome://. Registered in every process
// (browser, renderers, and the macOS helper apps) before CEF starts.
//
// Display-isolated: only tobari:// content and the user (typing it, or the
// browser opening it) can show a tobari:// page; a website cannot link to,
// redirect to or frame one. Secure and standard, so pages get a real origin
// and can fetch their own /api/ paths same-origin.
void RegisterTobariScheme(CefRawPtr<CefSchemeRegistrar> registrar);

// Serves tobari:// pages from the install and answers their /api/ requests.
void RegisterTobariPages();

}  // namespace tobari
