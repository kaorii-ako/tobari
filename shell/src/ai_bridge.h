#pragma once

#include <string>

#include "include/cef_resource_handler.h"
#include "include/cef_values.h"

namespace tobari {

// Who is asking decides what is allowed.
enum class AiCaller {
  kShield,      // the shield extension: page summary and questions, tab grouping
  kTobariPage,  // tobari:// pages: everything, including model downloads
};

// Handles one AI endpoint (|name| without a leading slash: "state", "page",
// "group", "chat", "download", "cancel", "delete", "select", "open").
// Returns null for a name the caller may not use. Streaming endpoints answer
// with NDJSON lines: {"t":"text"} as text arrives, then {"done":true,"error":""}.
CefRefPtr<CefResourceHandler> AiHandler(AiCaller caller, const std::string& name,
                                        CefRefPtr<CefDictionaryValue> in, const std::string& origin);

}  // namespace tobari
