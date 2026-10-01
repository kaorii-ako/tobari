#include "shield.h"

#include <cstdio>
#include <cstring>
#include <string>

#include "blocking.h"
#include "bangs.h"
#include "chrome_client.h"
#include "filters_update.h"
#include "include/cef_parser.h"
#include "include/cef_scheme.h"
#include "include/wrapper/cef_stream_resource_handler.h"
#include "paths.h"

namespace tobari {
namespace {

constexpr char kShieldOrigin[] = "chrome-extension://lgfgpfedeaaahediodajihnoneonicaf";
constexpr char kHost[] = "tobari.internal";

std::string Body(CefRefPtr<CefRequest> request) {
  CefRefPtr<CefPostData> post = request->GetPostData();
  if (!post) return std::string();
  CefPostData::ElementVector elements;
  post->GetElements(elements);
  std::string out;
  for (const auto& e : elements) {
    if (e->GetType() != PDE_TYPE_BYTES) continue;
    std::string chunk(e->GetBytesCount(), '\0');
    e->GetBytes(chunk.size(), chunk.data());
    out += chunk;
  }
  return out;
}

CefRefPtr<CefDictionaryValue> ParseObject(const std::string& json) {
  CefRefPtr<CefValue> v = CefParseJSON(json, JSON_PARSER_RFC);
  if (v && v->GetType() == VTYPE_DICTIONARY) return v->GetDictionary();
  return CefDictionaryValue::Create();
}

std::string Serialize(CefRefPtr<CefDictionaryValue> d) {
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(d);
  return CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();
}

// A read handler that owns its bytes; CefStreamReader::CreateForData would
// only borrow them, and the response outlives this function.
class OwnedStringReader : public CefReadHandler {
 public:
  explicit OwnedStringReader(std::string data) : data_(std::move(data)) {}

  size_t Read(void* ptr, size_t size, size_t n) override {
    const size_t want = size * n;
    const size_t left = data_.size() - offset_;
    const size_t take = want < left ? want : left;
    memcpy(ptr, data_.data() + offset_, take);
    offset_ += take;
    return size ? take / size : 0;
  }
  int Seek(int64_t offset, int whence) override {
    int64_t base = whence == SEEK_SET ? 0 : whence == SEEK_CUR ? static_cast<int64_t>(offset_)
                                                                : static_cast<int64_t>(data_.size());
    const int64_t target = base + offset;
    if (target < 0 || target > static_cast<int64_t>(data_.size())) return -1;
    offset_ = static_cast<size_t>(target);
    return 0;
  }
  int64_t Tell() override { return static_cast<int64_t>(offset_); }
  int Eof() override { return offset_ >= data_.size(); }
  bool MayBlock() override { return false; }

 private:
  std::string data_;
  size_t offset_ = 0;

  IMPLEMENT_REFCOUNTING(OwnedStringReader);
  DISALLOW_COPY_AND_ASSIGN(OwnedStringReader);
};

CefRefPtr<CefResourceHandler> Respond(int status, const std::string& origin, const std::string& body) {
  CefResponse::HeaderMap headers;
  headers.insert({"Cache-Control", "no-store"});
  if (!origin.empty()) headers.insert({"Access-Control-Allow-Origin", origin});
  CefRefPtr<CefStreamReader> stream = CefStreamReader::CreateForHandler(new OwnedStringReader(body));
  return new CefStreamResourceHandler(status, status == 200 ? "OK" : "Forbidden",
                                      "application/json", headers, stream);
}

CefRefPtr<CefDictionaryValue> PageState(const std::string& url) {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  const std::string host = HostOf(url);
  Blocking& blocking = Blocking::Get();
  d->SetString("host", host);
  d->SetBool("applicable", url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0);
  d->SetBool("enabled", !host.empty() && !blocking.HostDisabled(host));
  d->SetInt("blocked", ChromeClient::Get()->BlockedForUrl(url));
  d->SetInt("total", ChromeClient::Get()->BlockedTotal());
  d->SetInt("rules", static_cast<int>(blocking.RuleCount()));
  return d;
}

CefRefPtr<CefDictionaryValue> Stats() {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  Blocking& blocking = Blocking::Get();
  d->SetInt("total", ChromeClient::Get()->BlockedTotal());
  d->SetInt("rules", static_cast<int>(blocking.RuleCount()));
  d->SetInt("bangs", static_cast<int>(BangCount()));
  d->SetString("updateState", FilterUpdater::Get().StateString());
  CefRefPtr<CefListValue> lists = CefListValue::Create();
  size_t i = 0;
  for (const ListInfo& l : blocking.Lists()) {
    CefRefPtr<CefDictionaryValue> e = CefDictionaryValue::Create();
    e->SetString("name", l.name);
    e->SetInt("rules", static_cast<int>(l.rules));
    e->SetDouble("modified", static_cast<double>(l.modified));
    e->SetBool("bundled", l.path.find("/filters/") != std::string::npos &&
                              l.path.rfind(FiltersDir(), 0) != 0);
    lists->SetDictionary(i++, e);
  }
  d->SetList("lists", lists);
  return d;
}

class ShieldFactory : public CefSchemeHandlerFactory {
 public:
  ShieldFactory() = default;

  CefRefPtr<CefResourceHandler> Create(CefRefPtr<CefBrowser> browser,
                                       CefRefPtr<CefFrame> frame,
                                       const CefString& scheme_name,
                                       CefRefPtr<CefRequest> request) override {
    // Identity comes from browser-computed facts that page script cannot set:
    // the requesting frame's URL, or — for requests from extension hosts that
    // CEF does not wrap as browsers, like the offscreen document — the site
    // for cookies, which is the top-level document's site. A web page's
    // requests carry its own site, and nothing web-reachable can embed this
    // extension because it declares no web-accessible resources.
    //
    // Not usable: CEF reports Origin as "null" for every caller, and Chromium
    // strips Referer on extension-to-web requests.
    const std::string expected = std::string(kShieldOrigin) + "/";
    const std::string frame_url = frame ? frame->GetURL().ToString() : std::string();
    const std::string site = request->GetFirstPartyForCookies().ToString();
    const bool from_extension = frame_url.rfind(expected, 0) == 0 || site.rfind(expected, 0) == 0;
    if (!from_extension || request->GetMethod().ToString() != "POST") {
      return Respond(403, "", "{\"error\":\"forbidden\"}");
    }
    const std::string origin = kShieldOrigin;

    CefURLParts parts;
    CefParseURL(request->GetURL(), parts);
    const std::string path = CefString(&parts.path).ToString();
    CefRefPtr<CefDictionaryValue> in = ParseObject(Body(request));

    if (path == "/state") {
      return Respond(200, origin, Serialize(PageState(in->GetString("url").ToString())));
    }
    if (path == "/toggle") {
      const std::string url = in->GetString("url").ToString();
      const std::string host = HostOf(url);
      if (!host.empty()) {
        Blocking::Get().SetHostDisabled(host, !Blocking::Get().HostDisabled(host));
      }
      return Respond(200, origin, Serialize(PageState(url)));
    }
    if (path == "/stats") {
      return Respond(200, origin, Serialize(Stats()));
    }
    if (path == "/update") {
      FilterUpdater::Get().Start(true);
      return Respond(200, origin, Serialize(Stats()));
    }
    return Respond(403, "", "{\"error\":\"unknown\"}");
  }

 private:
  IMPLEMENT_REFCOUNTING(ShieldFactory);
  DISALLOW_COPY_AND_ASSIGN(ShieldFactory);
};

}  // namespace

void RegisterShieldBridge() {
  CefRegisterSchemeHandlerFactory("https", kHost, new ShieldFactory());
}

}  // namespace tobari
