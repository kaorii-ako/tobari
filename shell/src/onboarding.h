#pragma once

#include <string>

#include "include/cef_values.h"

namespace tobari {

// First-run setup: tobari://welcome, in its own window, lets a
// new user pick a search engine, appearance and privacy options. These read
// and write Chromium's own preferences, so everything chosen here can also be
// changed later in chrome://settings. All functions run on the UI thread.

bool Onboarded();

// Current choices plus the options to offer, for the welcome page.
CefRefPtr<CefDictionaryValue> SetupState();

// Applies whichever of these keys |in| carries: engine, scheme, accent,
// suggest, restore, fastJs. Returns the new state.
CefRefPtr<CefDictionaryValue> ApplySetup(CefRefPtr<CefDictionaryValue> in);

// Records that the welcome flow was finished or skipped.
void MarkOnboarded();

}  // namespace tobari
