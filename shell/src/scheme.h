#pragma once

#include "include/cef_app.h"
#include "include/cef_scheme.h"

namespace tobari {

void RegisterTobariScheme(CefRawPtr<CefSchemeRegistrar> registrar);
void RegisterTobariSchemeHandler();

}  // namespace tobari
