#include "shield.h"

#include <algorithm>
#include <cstdio>
#include <cstring>
#include <functional>
#include <mutex>
#include <string>

#include "blocking.h"
#include "bangs.h"
#include "chrome_client.h"
#include "filters_update.h"
#include "onboarding.h"
#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/cef_scheme.h"
#include "include/cef_task.h"
#include "include/wrapper/cef_closure_task.h"
#include "paths.h"
#include "tobari_blocker.h"

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

// Answers one bridge request. Content settings may only be read or written on
// the browser UI thread, while scheme handlers run on the IO thread, so the
// response is computed on UI and the handler completes once it arrives.
class BridgeHandler : public CefResourceHandler {
 public:
  using Compute = std::function<std::string()>;

  BridgeHandler(int status, std::string origin, Compute compute)
      : status_(status), origin_(std::move(origin)), compute_(std::move(compute)) {}

  bool Open(CefRefPtr<CefRequest> request, bool& handle_request,
            CefRefPtr<CefCallback> callback) override {
    handle_request = false;
    if (!compute_) {
      handle_request = true;
      return true;
    }
    CefRefPtr<BridgeHandler> self(this);
    CefPostTask(TID_UI, base::BindOnce(
        [](CefRefPtr<BridgeHandler> h, CefRefPtr<CefCallback> cb) {
          std::string body = h->compute_();
          {
            std::lock_guard<std::mutex> lock(h->mutex_);
            h->body_ = std::move(body);
          }
          cb->Continue();
        },
        self, callback));
    return true;
  }

  void GetResponseHeaders(CefRefPtr<CefResponse> response, int64_t& response_length,
                          CefString& redirect_url) override {
    response->SetStatus(status_);
    response->SetStatusText(status_ == 200 ? "OK" : "Forbidden");
    response->SetMimeType("application/json");
    CefResponse::HeaderMap headers;
    headers.insert({"Cache-Control", "no-store"});
    headers.insert({"X-Content-Type-Options", "nosniff"});
    if (status_ == 200 && !origin_.empty()) headers.insert({"Access-Control-Allow-Origin", origin_});
    response->SetHeaderMap(headers);
    std::lock_guard<std::mutex> lock(mutex_);
    if (!compute_) body_ = "{\"error\":\"forbidden\"}";
    response_length = static_cast<int64_t>(body_.size());
  }

  bool Read(void* data_out, int bytes_to_read, int& bytes_read,
            CefRefPtr<CefResourceReadCallback> callback) override {
    std::lock_guard<std::mutex> lock(mutex_);
    const size_t left = body_.size() - offset_;
    if (left == 0) {
      bytes_read = 0;
      return false;
    }
    const size_t take = std::min(left, static_cast<size_t>(bytes_to_read));
    memcpy(data_out, body_.data() + offset_, take);
    offset_ += take;
    bytes_read = static_cast<int>(take);
    return true;
  }

  void Cancel() override {}

 private:
  const int status_;
  const std::string origin_;
  const Compute compute_;
  std::mutex mutex_;
  std::string body_;
  size_t offset_ = 0;

  IMPLEMENT_REFCOUNTING(BridgeHandler);
  DISALLOW_COPY_AND_ASSIGN(BridgeHandler);
};

CefRefPtr<CefResourceHandler> Forbidden() {
  return new BridgeHandler(403, std::string(), nullptr);
}

bool IsWebUrl(const std::string& url) {
  return url.rfind("http://", 0) == 0 || url.rfind("https://", 0) == 0;
}

// Chromium decides whether a renderer gets the V8 optimizer from its *site*:
// scheme plus registrable domain, with no port. An exception keyed on the
// page's full origin would never match, so settings are read and written for
// the site URL, which also makes one switch cover every subdomain.
std::string SiteUrlOf(const std::string& url) {
  CefURLParts parts;
  if (!CefParseURL(url, parts)) return std::string();
  const std::string scheme = CefString(&parts.scheme).ToString();
  const std::string host = CefString(&parts.host).ToString();
  if ((scheme != "http" && scheme != "https") || host.empty()) return std::string();
  char domain[256];
  const size_t n = tobari_registrable_domain(host.c_str(), domain, sizeof(domain));
  return scheme + "://" + (n ? std::string(domain, n) : host) + "/";
}

// The V8 optimizer is off by default (defaults.cc); a site the user trusts can
// be given it back. Must run on the UI thread.
bool FastJsAllowed(const std::string& url) {
  const std::string site_url = SiteUrlOf(url);
  if (site_url.empty()) return false;
  CefRefPtr<CefRequestContext> ctx = CefRequestContext::GetGlobalContext();
  const cef_content_setting_values_t site =
      ctx->GetContentSetting(site_url, site_url, CEF_CONTENT_SETTING_TYPE_JAVASCRIPT_OPTIMIZER);
  const cef_content_setting_values_t effective =
      site != CEF_CONTENT_SETTING_VALUE_DEFAULT
          ? site
          : ctx->GetContentSetting("", "", CEF_CONTENT_SETTING_TYPE_JAVASCRIPT_OPTIMIZER);
  return effective == CEF_CONTENT_SETTING_VALUE_ALLOW;
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
  d->SetBool("fastJs", FastJsAllowed(url));
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
    if (!FromShieldExtension(frame, request) || request->GetMethod().ToString() != "POST") {
      return Forbidden();
    }
    const std::string origin = kShieldOrigin;

    CefURLParts parts;
    CefParseURL(request->GetURL(), parts);
    const std::string path = CefString(&parts.path).ToString();
    CefRefPtr<CefDictionaryValue> in = ParseObject(Body(request));
    const std::string url = in->GetString("url").ToString();

    BridgeHandler::Compute compute;
    if (path == "/state") {
      compute = [url] { return Serialize(PageState(url)); };
    } else if (path == "/toggle") {
      compute = [url] {
        const std::string host = HostOf(url);
        if (IsWebUrl(url) && !host.empty()) {
          Blocking::Get().SetHostDisabled(host, !Blocking::Get().HostDisabled(host));
        }
        return Serialize(PageState(url));
      };
    } else if (path == "/fastjs") {
      compute = [url] {
        const std::string site_url = SiteUrlOf(url);
        if (!site_url.empty()) {
          CefRequestContext::GetGlobalContext()->SetContentSetting(
              site_url, site_url, CEF_CONTENT_SETTING_TYPE_JAVASCRIPT_OPTIMIZER,
              FastJsAllowed(url) ? CEF_CONTENT_SETTING_VALUE_DEFAULT
                                 : CEF_CONTENT_SETTING_VALUE_ALLOW);
        }
        return Serialize(PageState(url));
      };
    } else if (path == "/setup/state") {
      compute = [] { return Serialize(SetupState()); };
    } else if (path == "/setup/apply") {
      compute = [in] { return Serialize(ApplySetup(in)); };
    } else if (path == "/setup/done") {
      compute = [] {
        MarkOnboarded();
        return Serialize(SetupState());
      };
    } else if (path == "/stats") {
      compute = [] { return Serialize(Stats()); };
    } else if (path == "/update") {
      compute = [] {
        FilterUpdater::Get().Start(true);
        return Serialize(Stats());
      };
    } else {
      return Forbidden();
    }
    return new BridgeHandler(200, origin, std::move(compute));
  }

 private:
  IMPLEMENT_REFCOUNTING(ShieldFactory);
  DISALLOW_COPY_AND_ASSIGN(ShieldFactory);
};

}  // namespace

bool FromShieldExtension(CefRefPtr<CefFrame> frame, CefRefPtr<CefRequest> request) {
  const std::string expected = std::string(kShieldOrigin) + "/";
  const std::string frame_url = frame ? frame->GetURL().ToString() : std::string();
  const std::string site = request->GetFirstPartyForCookies().ToString();
  return frame_url.rfind(expected, 0) == 0 || site.rfind(expected, 0) == 0;
}

void RegisterShieldBridge() {
  CefRegisterSchemeHandlerFactory("https", kHost, new ShieldFactory());
}

}  // namespace tobari
