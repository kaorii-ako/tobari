#include "scheme.h"

#include <unistd.h>

#include <algorithm>
#include <string>

#include "include/cef_parser.h"
#include "include/wrapper/cef_stream_resource_handler.h"

namespace tobari {
namespace {

constexpr char kScheme[] = "tobari";
constexpr char kHost[] = "ui";

std::string ExecutableDir() {
  char buffer[4096];
  const ssize_t len = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (len <= 0) {
    return ".";
  }
  buffer[len] = '\0';
  std::string path(buffer);
  const size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string MimeForPath(const std::string& path) {
  const size_t dot = path.find_last_of('.');
  if (dot == std::string::npos) {
    return "application/octet-stream";
  }
  const std::string ext = path.substr(dot + 1);
  if (ext == "html") return "text/html";
  if (ext == "css") return "text/css";
  if (ext == "js" || ext == "mjs") return "text/javascript";
  if (ext == "json") return "application/json";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "woff2") return "font/woff2";
  return "application/octet-stream";
}

bool IsSafeRelativePath(const std::string& path) {
  if (path.empty()) return false;
  if (path.find("..") != std::string::npos) return false;
  if (path.front() == '/') return false;
  return true;
}

class UiSchemeHandlerFactory : public CefSchemeHandlerFactory {
 public:
  UiSchemeHandlerFactory() = default;

  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
                                       CefRefPtr<CefFrame> frame,
                                       const CefString& scheme_name,
                                       CefRefPtr<CefRequest> request) override {
    CefURLParts parts;
    if (!CefParseURL(request->GetURL(), parts)) {
      return nullptr;
    }

    std::string rel = CefString(&parts.path).ToString();
    if (!rel.empty() && rel.front() == '/') {
      rel.erase(0, 1);
    }
    if (rel.empty()) {
      rel = "index.html";
    }
    if (!IsSafeRelativePath(rel)) {
      return nullptr;
    }

    const std::string full = ExecutableDir() + "/ui/" + rel;
    CefRefPtr<CefStreamReader> reader = CefStreamReader::CreateForFile(full);
    if (!reader) {
      return nullptr;
    }
    return new CefStreamResourceHandler(MimeForPath(rel), reader);
  }

 private:
  IMPLEMENT_REFCOUNTING(UiSchemeHandlerFactory);
  DISALLOW_COPY_AND_ASSIGN(UiSchemeHandlerFactory);
};

}  // namespace

void RegisterTobariScheme(CefRawPtr<CefSchemeRegistrar> registrar) {
  registrar->AddCustomScheme(kScheme, CEF_SCHEME_OPTION_STANDARD |
                                          CEF_SCHEME_OPTION_SECURE |
                                          CEF_SCHEME_OPTION_CORS_ENABLED |
                                          CEF_SCHEME_OPTION_FETCH_ENABLED);
}

void RegisterTobariSchemeHandler() {
  CefRegisterSchemeHandlerFactory(kScheme, kHost, new UiSchemeHandlerFactory());
}

}  // namespace tobari
