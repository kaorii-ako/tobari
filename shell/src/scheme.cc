#include "scheme.h"

#include <unistd.h>

#include <cstring>
#include <fstream>
#include <mutex>
#include <set>
#include <sstream>

#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/wrapper/cef_closure_task.h"
#include "shell.h"
#include "util.h"

namespace {

// Browsers whose main frame is a tobari:// page. Only they may load tobari:// subresources, so web pages
// can't probe for Tobari. Frame URLs and referrers aren't available on this thread, hence the set.
std::mutex g_mu;
std::set<int> g_internal;

std::string ExeDir() {
  char buf[4096];
  ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  std::string p(buf, n > 0 ? n : 0);
  return p.substr(0, p.find_last_of('/'));
}

std::string Mime(const std::string& path) {
  std::string ext = path.substr(path.find_last_of('.') + 1);
  if (ext == "html") return "text/html";
  if (ext == "css") return "text/css";
  if (ext == "js") return "text/javascript";
  if (ext == "svg") return "image/svg+xml";
  if (ext == "png") return "image/png";
  if (ext == "json") return "application/json";
  if (ext == "woff2") return "font/woff2";
  return "text/plain";
}

class Handler : public CefResourceHandler {
 public:
  Handler(CefRefPtr<CefBrowser> b) : browser_(b) {}

  bool Open(CefRefPtr<CefRequest> req, bool& handle_request, CefRefPtr<CefCallback> cb) override {
    CefURLParts parts;
    CefParseURL(req->GetURL(), parts);
    std::string host = CefString(&parts.host), path = CefString(&parts.path);
    handle_request = true;
    if (path.rfind("/api/", 0) == 0) {
      if (req->GetMethod() != "POST") return Fail(405);
      std::string body;
      if (auto post = req->GetPostData()) {
        CefPostData::ElementVector els;
        post->GetElements(els);
        for (auto& e : els) {
          std::string chunk(e->GetBytesCount(), '\0');
          e->GetBytes(chunk.size(), chunk.data());
          body += chunk;
        }
      }
      std::string cmd = path.substr(5);
      handle_request = false;
      CefPostTask(TID_UI, base::BindOnce(&Handler::Call, CefRefPtr<Handler>(this), host, cmd, body, cb));
      return true;
    }
    std::string rel = UiPath(host, path);
    if (rel.empty()) return Fail(404);
    std::ifstream f(ExeDir() + "/ui/" + rel, std::ios::binary);
    if (!f) return Fail(404);
    std::stringstream s;
    s << f.rdbuf();
    data_ = s.str();
    mime_ = Mime(rel);
    return true;
  }

  void Call(std::string host, std::string cmd, std::string body, CefRefPtr<CefCallback> cb) {
    Shell* shell = Shell::Get();
    auto v = CefParseJSON(body.empty() ? "{}" : body, JSON_PARSER_RFC);
    auto arg = v && v->GetType() == VTYPE_DICTIONARY ? v->GetDictionary() : CefDictionaryValue::Create();
    // Built-in pages other than the UI may only call their own "<host>." commands.
    std::string out;
    std::string page = browser_->GetMainFrame()->GetURL();
    if (shell && (shell->IsUi(browser_) || (page.rfind("tobari://" + host + "/", 0) == 0 && cmd.rfind(host + ".", 0) == 0))) out = shell->Api(browser_, cmd, arg);
    if (out.empty()) {
      status_ = 403;
      data_ = "{\"error\":\"forbidden\"}";
    } else {
      data_ = out;
    }
    mime_ = "application/json";
    cb->Continue();
  }

  void GetResponseHeaders(CefRefPtr<CefResponse> res, int64_t& len, CefString&) override {
    res->SetStatus(status_);
    res->SetMimeType(mime_);
    res->SetCharset("utf-8");
    CefResponse::HeaderMap h;
    h.insert({"Content-Security-Policy",
              "default-src 'self'; img-src 'self' https: http: data:; style-src 'self' 'unsafe-inline'"});
    h.insert({"Cache-Control", "no-store"});
    res->SetHeaderMap(h);
    len = static_cast<int64_t>(data_.size());
  }

  bool Read(void* out, int n, int& read, CefRefPtr<CefResourceReadCallback>) override {
    read = static_cast<int>(std::min<size_t>(n, data_.size() - pos_));
    memcpy(out, data_.data() + pos_, read);
    pos_ += read;
    return read > 0;
  }

  void Cancel() override {}

 private:
  bool Fail(int status) {
    status_ = status;
    mime_ = "text/plain";
    data_ = "not found";
    return true;
  }

  CefRefPtr<CefBrowser> browser_;
  std::string data_, mime_ = "text/plain";
  size_t pos_ = 0;
  int status_ = 200;
  IMPLEMENT_REFCOUNTING(Handler);
};

class Factory : public CefSchemeHandlerFactory {
 public:
  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> b, CefRefPtr<CefFrame> f, const CefString&,
                                       CefRefPtr<CefRequest> req) override {
    if (!b) return nullptr;
    auto type = req->GetResourceType();
    std::lock_guard lock(g_mu);
    // Navigations were already vetted by Shell::OnBeforeBrowse.
    if (type == RT_MAIN_FRAME) g_internal.insert(b->GetIdentifier());
    else if (type != RT_SUB_FRAME && !g_internal.count(b->GetIdentifier())) return nullptr;
    return new Handler(b);
  }
  IMPLEMENT_REFCOUNTING(Factory);
};

}  // namespace

CefRefPtr<CefSchemeHandlerFactory> NewSchemeFactory() { return new Factory; }

void LeftInternal(int browser_id) {
  std::lock_guard lock(g_mu);
  g_internal.erase(browser_id);
}
