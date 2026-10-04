#include "onboarding.h"

#include <cstdint>
#include <cstdio>

#include "include/cef_request_context.h"
#include "paths.h"

namespace tobari {

namespace {

// Search engines offered at setup. Every results URL here is one the bang
// resolver (bangs.cc) recognises, so bangs keep working whichever is chosen.
// Suggestion URLs are only contacted when the user turns suggestions on.
//
// Chromium only accepts a user-chosen default it can find in its engine
// list: a built-in engine by prepopulate_id (IDs as listed in the profile's
// Web Data keywords table, Chromium 154), or any engine by sync GUID. An
// entry with neither is added as new, which fails when its keyword collides
// with a built-in one, leaving no default at all. Engines Chromium does not
// ship carry a fixed GUID so choosing them again reuses the same entry.
struct Engine {
  const char* id;
  const char* name;
  const char* keyword;
  const char* url;
  const char* suggest;
  const char* note;
  int prepopulate_id;
  const char* guid;
};

const Engine kEngines[] = {
    {"ddg", "DuckDuckGo", "duckduckgo.com", "https://duckduckgo.com/?q={searchTerms}",
     "https://duckduckgo.com/ac/?q={searchTerms}&type=list",
     "No search history kept. Tobari's default.", 92, nullptr},
    {"brave", "Brave Search", "search.brave.com", "https://search.brave.com/search?q={searchTerms}",
     "https://search.brave.com/api/suggest?q={searchTerms}",
     "Its own independent index; no profiling.", 109, nullptr},
    {"startpage", "Startpage", "startpage.com", "https://www.startpage.com/sp/search?query={searchTerms}",
     "https://www.startpage.com/osuggestions?q={searchTerms}",
     "Google's results, without Google seeing you.", 0, "6c1f2a4e-3b7d-4e19-9a52-7d0b5e3c1a01"},
    {"kagi", "Kagi", "kagi.com", "https://kagi.com/search?q={searchTerms}",
     "https://kagi.com/api/autosuggest?q={searchTerms}",
     "Paid, ad-free. Needs a Kagi account.", 0, "6c1f2a4e-3b7d-4e19-9a52-7d0b5e3c1a02"},
    {"ecosia", "Ecosia", "ecosia.org", "https://www.ecosia.org/search?q={searchTerms}",
     "https://ac.ecosia.org/autocomplete?q={searchTerms}&type=list",
     "Funds tree planting from ad revenue.", 101, nullptr},
    {"google", "Google", "google.com", "https://www.google.com/search?q={searchTerms}",
     "https://www.google.com/complete/search?client=chrome&q={searchTerms}",
     "Best coverage. Builds a profile of your searches.", 1, nullptr},
    {"bing", "Bing", "bing.com", "https://www.bing.com/search?q={searchTerms}",
     "https://www.bing.com/osjson.aspx?query={searchTerms}",
     "Microsoft's index. Tracks searches for ads.", 3, nullptr},
};

// Accent colours for the browser's own interface. "Monochrome" is Chromium's
// grayscale theme, which is what Tobari ships; the others tint the chrome.
struct Accent {
  const char* id;
  const char* name;
  uint32_t argb;  // 0 = grayscale
};

const Accent kAccents[] = {
    {"mono", "Monochrome", 0},
    {"vermilion", "Vermilion", 0xFFFF6B3D},
    {"moss", "Moss", 0xFF7FB894},
    {"tide", "Tide", 0xFF5B8FD9},
    {"plum", "Plum", 0xFFB07CC6},
    {"sand", "Sand", 0xFFC9A46A},
};

// content_settings values and session.restore_on_startup values.
constexpr int kAllow = 1;
constexpr int kBlock = 2;
constexpr int kRestoreLastSession = 1;
constexpr int kOpenNewTab = 5;

std::string MarkerPath() { return DataDir() + "/state/onboarded"; }

CefRefPtr<CefRequestContext> Ctx() { return CefRequestContext::GetGlobalContext(); }

CefRefPtr<CefValue> Get(const char* name) {
  CefRefPtr<CefValue> v = Ctx()->GetPreference(name);
  return v ? v : CefValue::Create();
}

bool Set(const char* name, CefRefPtr<CefValue> value) {
  CefString error;
  CefRefPtr<CefRequestContext> ctx = Ctx();
  if (!ctx->CanSetPreference(name) || !ctx->SetPreference(name, value, error)) {
    fprintf(stderr, "tobari: setup could not set %s: %s\n", name, error.ToString().c_str());
    return false;
  }
  return true;
}

CefRefPtr<CefValue> Int(int v) { auto x = CefValue::Create(); x->SetInt(v); return x; }
CefRefPtr<CefValue> Bool(bool v) { auto x = CefValue::Create(); x->SetBool(v); return x; }

const Engine* EngineById(const std::string& id) {
  for (const Engine& e : kEngines) {
    if (id == e.id) return &e;
  }
  return nullptr;
}

const Accent* AccentById(const std::string& id) {
  for (const Accent& a : kAccents) {
    if (id == a.id) return &a;
  }
  return nullptr;
}

std::string CurrentEngine() {
  CefRefPtr<CefValue> data = Get("default_search_provider_data.template_url_data");
  if (data->GetType() != VTYPE_DICTIONARY) return "ddg";
  const std::string keyword = data->GetDictionary()->GetString("keyword").ToString();
  for (const Engine& e : kEngines) {
    if (keyword == e.keyword) return e.id;
  }
  return "other";
}

std::string CurrentAccent() {
  if (Get("browser.theme.is_grayscale2")->GetBool()) return "mono";
  const uint32_t color = static_cast<uint32_t>(Get("browser.theme.user_color2")->GetInt());
  for (const Accent& a : kAccents) {
    if (a.argb && a.argb == color) return a.id;
  }
  return "custom";
}

CefRefPtr<CefValue> TemplateFor(const Engine& e) {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  d->SetString("short_name", e.name);
  d->SetString("keyword", e.keyword);
  d->SetString("url", e.url);
  d->SetString("suggestions_url", e.suggest);
  d->SetBool("safe_for_autoreplace", true);
  if (e.prepopulate_id) d->SetInt("prepopulate_id", e.prepopulate_id);
  if (e.guid) d->SetString("synced_guid", e.guid);
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(d);
  return v;
}

}  // namespace

bool Onboarded() { return Readable(MarkerPath()); }

void MarkOnboarded() { WriteFileAtomic(MarkerPath(), "1\n"); }

CefRefPtr<CefDictionaryValue> SetupState() {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  d->SetString("engine", CurrentEngine());
  d->SetInt("scheme", Get("browser.theme.color_scheme2")->GetInt());
  d->SetString("accent", CurrentAccent());
  d->SetBool("suggest", Get("search.suggest_enabled")->GetBool());
  d->SetBool("restore", Get("session.restore_on_startup")->GetInt() == kRestoreLastSession);
  d->SetBool("fastJs",
             Get("profile.default_content_setting_values.javascript_optimizer")->GetInt() == kAllow);
  d->SetBool("onboarded", Onboarded());

  CefRefPtr<CefListValue> engines = CefListValue::Create();
  size_t i = 0;
  for (const Engine& e : kEngines) {
    CefRefPtr<CefDictionaryValue> x = CefDictionaryValue::Create();
    x->SetString("id", e.id);
    x->SetString("name", e.name);
    x->SetString("host", e.keyword);
    x->SetString("note", e.note);
    engines->SetDictionary(i++, x);
  }
  d->SetList("engines", engines);

  CefRefPtr<CefListValue> accents = CefListValue::Create();
  i = 0;
  for (const Accent& a : kAccents) {
    CefRefPtr<CefDictionaryValue> x = CefDictionaryValue::Create();
    x->SetString("id", a.id);
    x->SetString("name", a.name);
    char hex[8] = "";
    if (a.argb) snprintf(hex, sizeof(hex), "#%06X", a.argb & 0xFFFFFF);
    x->SetString("color", hex);
    accents->SetDictionary(i++, x);
  }
  d->SetList("accents", accents);
  return d;
}

CefRefPtr<CefDictionaryValue> ApplySetup(CefRefPtr<CefDictionaryValue> in) {
  if (in->HasKey("engine")) {
    if (const Engine* e = EngineById(in->GetString("engine").ToString())) {
      Set("default_search_provider_data.template_url_data", TemplateFor(*e));
    }
  }
  if (in->HasKey("scheme")) {
    const int scheme = in->GetInt("scheme");
    if (scheme >= 0 && scheme <= 2) Set("browser.theme.color_scheme2", Int(scheme));
  }
  if (in->HasKey("accent")) {
    if (const Accent* a = AccentById(in->GetString("accent").ToString())) {
      Set("browser.theme.is_grayscale2", Bool(a->argb == 0));
      if (a->argb) Set("browser.theme.user_color2", Int(static_cast<int32_t>(a->argb)));
    }
  }
  if (in->HasKey("suggest")) Set("search.suggest_enabled", Bool(in->GetBool("suggest")));
  if (in->HasKey("restore")) {
    Set("session.restore_on_startup", Int(in->GetBool("restore") ? kRestoreLastSession : kOpenNewTab));
  }
  if (in->HasKey("fastJs")) {
    Set("profile.default_content_setting_values.javascript_optimizer",
        Int(in->GetBool("fastJs") ? kAllow : kBlock));
  }
  return SetupState();
}

}  // namespace tobari
