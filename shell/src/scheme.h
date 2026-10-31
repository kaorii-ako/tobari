// tobari:// serves the built-in pages from <exe dir>/ui and takes API calls at tobari://<host>/api/<cmd>.
#pragma once

#include "include/cef_scheme.h"

CefRefPtr<CefSchemeHandlerFactory> NewSchemeFactory();

// Call when a browser's main frame commits a URL that isn't tobari://.
void LeftInternal(int browser_id);
