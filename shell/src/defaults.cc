#include "defaults.h"

#include <cstdio>
#include <string>

#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/cef_values.h"
#include "paths.h"

namespace tobari {
namespace {

constexpr int kDefaultsVersion = 5;

// ContentSetting values as Chromium stores them.
constexpr int kBlock = 2;

constexpr char kShieldExtensionId[] = "lgfgpfedeaaahediodajihnoneonicaf";

// ui::SystemTheme::kDefault — Chromium's own palette rather than GTK's, which
// would otherwise override the user colour with the desktop theme.
constexpr int kSystemThemeClassic = 0;

// SkColor 0xFFFF6B3D (the --signal token) as the signed int Chromium stores.
constexpr int kVermilion = -38083;

// ui::mojom::BrowserColorVariant::kNeutral — a near-grey palette tinted by the
// seed, which keeps the chrome monochrome with a trace of the signal colour.
constexpr int kVariantNeutral = 2;

// ui::mojom::BrowserColorScheme::kDark.
constexpr int kSchemeDark = 2;

// SessionStartupPref::kPrefValueLast — continue where you left off.
constexpr int kRestoreLastSession = 1;

// prediction::NETWORK_PREDICTION_NEVER.
constexpr int kPredictionNever = 2;

// content_settings::CookieControlsMode::kBlockThirdParty.
constexpr int kBlockThirdPartyCookies = 1;

std::string MarkerPath() { return DataDir() + "/state/defaults-version"; }

int AppliedVersion() {
  std::string text;
  if (!ReadFile(MarkerPath(), &text)) return 0;
  return std::atoi(text.c_str());
}

// Set when any default fails to apply, so the version marker is not written
// and the next launch tries again (for example after an engine update renames
// a preference, which is then reported on every start rather than once).
bool g_failed = false;

void Set(CefRefPtr<CefRequestContext> ctx, const char* name, CefRefPtr<CefValue> value) {
  CefString error;
  if (!ctx->CanSetPreference(name)) {
    fprintf(stderr, "tobari: preference %s is not settable\n", name);
    g_failed = true;
    return;
  }
  if (!ctx->SetPreference(name, value, error)) {
    fprintf(stderr, "tobari: preference %s rejected: %s\n", name, error.ToString().c_str());
    g_failed = true;
  }
}

// True when the user (or anything else) has already given |name| a value of
// its own. Migrations for existing profiles leave such preferences alone.
bool UserSet(CefRefPtr<CefDictionaryValue> user_prefs, const std::string& name) {
  CefRefPtr<CefDictionaryValue> d = user_prefs;
  size_t start = 0;
  while (d) {
    const size_t dot = name.find('.', start);
    const std::string key = name.substr(start, dot == std::string::npos ? std::string::npos : dot - start);
    if (!d->HasKey(key)) return false;
    if (dot == std::string::npos) return true;
    d = d->GetDictionary(key);
    start = dot + 1;
  }
  return false;
}

void Migrate(CefRefPtr<CefRequestContext> ctx, CefRefPtr<CefDictionaryValue> user_prefs,
             bool existing, const std::string& name, CefRefPtr<CefValue> value) {
  if (existing && UserSet(user_prefs, name)) return;
  Set(ctx, name.c_str(), value);
}

void WriteMarker() {
  if (g_failed) {
    fprintf(stderr, "tobari: some defaults did not apply; will retry next launch\n");
    return;
  }
  WriteFileAtomic(MarkerPath(), std::to_string(kDefaultsVersion) + "\n");
}

CefRefPtr<CefValue> Int(int v) { auto x = CefValue::Create(); x->SetInt(v); return x; }
CefRefPtr<CefValue> Bool(bool v) { auto x = CefValue::Create(); x->SetBool(v); return x; }
CefRefPtr<CefValue> Str(const char* v) { auto x = CefValue::Create(); x->SetString(v); return x; }

CefRefPtr<CefValue> DuckDuckGo() {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  d->SetString("short_name", "DuckDuckGo");
  d->SetString("keyword", "duckduckgo.com");
  d->SetString("url", "https://duckduckgo.com/?q={searchTerms}");
  d->SetString("suggestions_url", "");
  d->SetInt("prepopulate_id", 92);
  d->SetBool("safe_for_autoreplace", true);
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(d);
  return v;
}

}  // namespace

void SeedNewProfile() {
  const std::string prefs_path = ProfileDir() + "/Default/Preferences";
  if (Readable(prefs_path)) return;

  CefRefPtr<CefDictionaryValue> theme = CefDictionaryValue::Create();
  theme->SetInt("color_scheme2", kSchemeDark);
  theme->SetBool("is_grayscale2", true);
  CefRefPtr<CefDictionaryValue> browser = CefDictionaryValue::Create();
  browser->SetDictionary("theme", theme);

  CefRefPtr<CefDictionaryValue> ext_theme = CefDictionaryValue::Create();
  ext_theme->SetInt("system_theme", kSystemThemeClassic);
  CefRefPtr<CefDictionaryValue> extensions = CefDictionaryValue::Create();
  extensions->SetDictionary("theme", ext_theme);

  CefRefPtr<CefDictionaryValue> root = CefDictionaryValue::Create();
  root->SetDictionary("browser", browser);
  root->SetDictionary("extensions", extensions);

  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetDictionary(root);
  WriteFileAtomic(prefs_path, CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString());
}

bool ApplyFirstRunDefaults() {
  const int applied = AppliedVersion();
  if (applied >= kDefaultsVersion) return false;
  CefRefPtr<CefRequestContext> ctx = CefRequestContext::GetGlobalContext();

  if (applied < 5) {
    // The V8 optimizing compilers are where most exploited V8 bugs live (type
    // confusions in TurboFan/Maglev). Chromium's per-site setting turns them
    // off; this makes that the default, with "allow" one click away per site
    // in the Tobari toolbar popup.
    // Profiles made before v5 keep any choice already made for these.
    CefRefPtr<CefDictionaryValue> user_prefs = ctx->GetAllPreferences(false);
    const bool existing = applied >= 1;
    Migrate(ctx, user_prefs, existing, "profile.default_content_setting_values.javascript_optimizer",
            Int(kBlock));
    Migrate(ctx, user_prefs, existing, "https_only_mode_enabled", Bool(true));
    for (const char* name : {"usb_guard", "serial_guard", "hid_guard", "bluetooth_guard",
                             "sensors", "local_fonts", "idle_detection"}) {
      Migrate(ctx, user_prefs, existing,
              std::string("profile.default_content_setting_values.") + name, Int(kBlock));
    }
  }
  if (applied < 4) {
    CefRefPtr<CefListValue> pinned = CefListValue::Create();
    pinned->SetString(0, kShieldExtensionId);
    CefRefPtr<CefValue> v = CefValue::Create();
    v->SetList(pinned);
    Set(ctx, "extensions.pinned_extensions", v);
  }
  if (applied < 3) {
    // The seeded neutral variant came out brown against the ink new-tab page.
    // Grayscale keeps the chrome monochrome; the signal colour lives in content.
    Set(ctx, "browser.theme.is_grayscale2", Bool(true));
  }
  if (applied < 2) {
    Set(ctx, "extensions.theme.system_theme", Int(kSystemThemeClassic));
    Set(ctx, "NewTabPage.FooterVisible", Bool(false));
    Set(ctx, "ntp_footer.settings.extension_attribution", Bool(false));
  }
  if (applied >= 1) {
    WriteMarker();
    return true;
  }

  Set(ctx, "browser.theme.color_scheme2", Int(kSchemeDark));
  Set(ctx, "browser.theme.user_color2", Int(kVermilion));
  Set(ctx, "browser.theme.color_variant2", Int(kVariantNeutral));

  Set(ctx, "default_search_provider_data.template_url_data", DuckDuckGo());
  Set(ctx, "search.suggest_enabled", Bool(false));

  Set(ctx, "session.restore_on_startup", Int(kRestoreLastSession));
  Set(ctx, "net.network_prediction_options", Int(kPredictionNever));
  Set(ctx, "profile.cookie_controls_mode", Int(kBlockThirdPartyCookies));
  Set(ctx, "webrtc.ip_handling_policy", Str("default_public_interface_only"));

  Set(ctx, "alternate_error_pages.enabled", Bool(false));
  Set(ctx, "translate.enabled", Bool(false));
  Set(ctx, "safebrowsing.enabled", Bool(false));
  Set(ctx, "autofill.credit_card_enabled", Bool(false));
  Set(ctx, "payments.can_make_payment_enabled", Bool(false));
  Set(ctx, "url_keyed_anonymized_data_collection.enabled", Bool(false));
  Set(ctx, "signin.allowed", Bool(false));

  WriteMarker();
  return true;
}

}  // namespace tobari
