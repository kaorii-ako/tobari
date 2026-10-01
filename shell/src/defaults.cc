#include "defaults.h"

#include <cstdio>
#include <string>

#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/cef_values.h"
#include "paths.h"

namespace tobari {
namespace {

constexpr int kDefaultsVersion = 4;

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

void Set(CefRefPtr<CefRequestContext> ctx, const char* name, CefRefPtr<CefValue> value) {
  CefString error;
  if (!ctx->CanSetPreference(name)) {
    fprintf(stderr, "tobari: preference %s is not settable\n", name);
    return;
  }
  if (!ctx->SetPreference(name, value, error)) {
    fprintf(stderr, "tobari: preference %s rejected: %s\n", name, error.ToString().c_str());
  }
}

CefRefPtr<CefValue> Int(int v) { auto x = CefValue::Create(); x->SetInt(v); return x; }
CefRefPtr<CefValue> Bool(bool v) { auto x = CefValue::Create(); x->SetBool(v); return x; }
CefRefPtr<CefValue> Str(const char* v) { auto x = CefValue::Create(); x->SetString(v); return x; }

CefRefPtr<CefValue> DuckDuckGo() {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  d->SetString("short_name", "DuckDuckGo");
  d->SetString("keyword", "duckduckgo.com");
  d->SetString("url", "https://duckduckgo.com/?q={searchTerms}");
  d->SetString("favicon_url", "https://duckduckgo.com/favicon.ico");
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
    WriteFileAtomic(MarkerPath(), std::to_string(kDefaultsVersion) + "\n");
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

  WriteFileAtomic(MarkerPath(), std::to_string(kDefaultsVersion) + "\n");
  return true;
}

}  // namespace tobari
