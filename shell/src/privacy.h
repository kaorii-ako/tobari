// Privacy defaults: filter lists, network blocking, HTTPS-Only, third-party cookies and WebRTC.
#pragma once
#include <string>

#include "include/cef_resource_request_handler.h"

// Applies the browser-wide settings and loads the filter lists. UI thread, once.
void PrivacyStart();
// Fetches any filter list older than a week. UI thread; Shell::Tick calls it every minute.
void PrivacyUpdate();
// Shared handler for every web request. Blocks list matches, upgrades http:// navigations.
CefRefPtr<CefResourceRequestHandler> PrivacyHandler();

// Per-site switch, keyed by Site() of the top-level host. Thread-safe.
bool SiteProtected(const std::string& site);
void SetSiteProtected(const std::string& site, bool on);

// HTTPS-Only. WasUpgraded is true once for a host whose http:// navigation was upgraded.
bool WasUpgraded(const std::string& host);
void AllowHttp(const std::string& host);

// JSON for tobari://blocking/.
std::string PrivacyStatus();
