#include "importer.h"

#include <atomic>

#include "include/cef_cookie.h"
#include "include/cef_parser.h"
#include "tobari_blocker.h"

namespace tobari {
namespace {

std::string Run(const std::string& op, const std::string& arg) {
  char* raw = tobari_import(op.c_str(), arg.c_str());
  if (!raw) return "{\"error\":\"import failed\"}";
  std::string out(raw);
  tobari_free_string(raw);
  return out;
}

cef_cookie_same_site_t SameSite(int chromium_value) {
  switch (chromium_value) {
    case 0: return CEF_COOKIE_SAME_SITE_NO_RESTRICTION;
    case 1: return CEF_COOKIE_SAME_SITE_LAX_MODE;
    case 2: return CEF_COOKIE_SAME_SITE_STRICT_MODE;
    default: return CEF_COOKIE_SAME_SITE_UNSPECIFIED;
  }
}

}  // namespace

std::string ImportSources() { return Run("sources", ""); }

std::string ImportData(const std::string& op, const std::string& source_id) {
  if (op != "bookmarks" && op != "history" && op != "extensions") return "{\"error\":\"unknown\"}";
  return Run(op, source_id);
}

std::string ImportCookies(const std::string& source_id) {
  const std::string json = Run("cookies", source_id);
  CefRefPtr<CefValue> parsed = CefParseJSON(json, JSON_PARSER_RFC);
  if (!parsed || parsed->GetType() != VTYPE_DICTIONARY) return json;
  CefRefPtr<CefDictionaryValue> result = parsed->GetDictionary();
  if (result->HasKey("error")) return json;

  CefRefPtr<CefCookieManager> manager = CefCookieManager::GetGlobalManager(nullptr);
  CefRefPtr<CefListValue> list = result->GetList("cookies");
  int written = 0;
  int rejected = 0;
  for (size_t i = 0; list && i < list->GetSize(); ++i) {
    CefRefPtr<CefDictionaryValue> c = list->GetDictionary(i);
    const std::string domain = c->GetString("domain").ToString();
    const std::string path = c->GetString("path").ToString().empty() ? "/" : c->GetString("path").ToString();
    const bool secure = c->GetBool("secure");
    const std::string host = !domain.empty() && domain[0] == '.' ? domain.substr(1) : domain;
    if (host.empty()) {
      ++rejected;
      continue;
    }
    CefCookie cookie;
    CefString(&cookie.name) = c->GetString("name");
    CefString(&cookie.value) = c->GetString("value");
    // A leading dot makes it a domain cookie, as in the source browser;
    // without one it is a host-only cookie, which CEF expresses by leaving
    // the domain empty.
    if (!domain.empty() && domain[0] == '.') CefString(&cookie.domain) = domain;
    CefString(&cookie.path) = path;
    cookie.secure = secure;
    cookie.httponly = c->GetBool("httpOnly");
    cookie.same_site = SameSite(c->GetInt("sameSite"));
    // SameSite=None requires Secure; such a cookie would be refused outright.
    if (cookie.same_site == CEF_COOKIE_SAME_SITE_NO_RESTRICTION && !secure) {
      cookie.same_site = CEF_COOKIE_SAME_SITE_UNSPECIFIED;
    }
    const double expires = c->GetDouble("expires");
    if (expires > 0) {
      cookie.has_expires = true;
      cookie.expires.val = static_cast<int64_t>(expires);
    }
    const std::string url = std::string(secure ? "https://" : "http://") + host + path;
    if (manager && manager->SetCookie(url, cookie, nullptr)) {
      ++written;
    } else {
      ++rejected;
    }
  }
  if (manager) manager->FlushStore(nullptr);

  CefRefPtr<CefDictionaryValue> out = CefDictionaryValue::Create();
  out->SetInt("total", result->GetInt("total"));
  out->SetInt("imported", written);
  out->SetInt("rejected", rejected);
  out->SetInt("expired", result->GetInt("expired"));
  out->SetInt("undecryptable", result->GetInt("undecryptable"));
  out->SetInt("skipped", result->HasKey("skipped") ? result->GetInt("skipped") : 0);
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(out);
  return CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();
}

}  // namespace tobari
