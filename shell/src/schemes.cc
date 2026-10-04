#include "schemes.h"

namespace tobari {

void RegisterTobariScheme(CefRawPtr<CefSchemeRegistrar> registrar) {
  registrar->AddCustomScheme("tobari", CEF_SCHEME_OPTION_STANDARD | CEF_SCHEME_OPTION_SECURE |
                                           CEF_SCHEME_OPTION_DISPLAY_ISOLATED |
                                           CEF_SCHEME_OPTION_FETCH_ENABLED);
}

}  // namespace tobari
