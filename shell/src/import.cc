#include "import.h"

#include <dlfcn.h>

#include <filesystem>
#include <fstream>
#include <sstream>

#include "include/cef_parser.h"

namespace fs = std::filesystem;

namespace {

bool Web(const std::string& u) { return u.rfind("http://", 0) == 0 || u.rfind("https://", 0) == 0; }

// SQLite comes from the system (every desktop has it) through dlopen, so Tobari doesn't ship or link it.
struct Sqlite {
  int (*open)(const char*, void**, int, const char*);
  int (*prepare)(void*, const char*, int, void**, const char**);
  int (*step)(void*);
  const unsigned char* (*text)(void*, int);
  int64_t (*int64)(void*, int);
  int (*finalize)(void*);
  int (*close)(void*);
  const char* (*errmsg)(void*);
  bool ok = false;
  Sqlite() {
    void* h = dlopen("libsqlite3.so.0", RTLD_NOW | RTLD_LOCAL);
    if (!h) return;
    auto f = [&](auto& p, const char* n) { p = reinterpret_cast<std::remove_reference_t<decltype(p)>>(dlsym(h, n)); return p != nullptr; };
    ok = f(open, "sqlite3_open_v2") && f(prepare, "sqlite3_prepare_v2") && f(step, "sqlite3_step") &&
         f(text, "sqlite3_column_text") && f(int64, "sqlite3_column_int64") && f(finalize, "sqlite3_finalize") &&
         f(close, "sqlite3_close") && f(errmsg, "sqlite3_errmsg");
  }
};

constexpr int kReadOnly = 0x1, kUri = 0x40, kRow = 100;

// Runs a query on a database opened read-only and immutable, so a browser that is running (and holds the
// lock) is never disturbed. Each row's columns are url, title, time, count.
std::string Query(const std::string& db, const char* sql, std::vector<ImportEntry>& out, int64_t (*to_unix)(int64_t)) {
  static Sqlite s;
  if (!s.ok) return "SQLite (libsqlite3.so.0) isn't installed, so history can't be read.";
  if (!fs::exists(db)) return "";
  void* c = nullptr;
  std::string uri = "file:" + db + "?immutable=1";
  if (s.open(uri.c_str(), &c, kReadOnly | kUri, nullptr) != 0) {
    std::string e = c ? s.errmsg(c) : "can't open";
    if (c) s.close(c);
    return fs::path(db).filename().string() + ": " + e;
  }
  void* st = nullptr;
  if (s.prepare(c, sql, -1, &st, nullptr) != 0) {
    std::string e = s.errmsg(c);
    s.close(c);
    return fs::path(db).filename().string() + ": " + e;
  }
  while (s.step(st) == kRow) {
    auto col = [&](int i) { auto t = s.text(st, i); return t ? std::string(reinterpret_cast<const char*>(t)) : ""; };
    ImportEntry e{col(0), col(1), to_unix ? to_unix(s.int64(st, 2)) : 0, static_cast<int>(s.int64(st, 3))};
    if (Web(e.url)) out.push_back(std::move(e));
  }
  s.finalize(st);
  s.close(c);
  return "";
}

int64_t FromChrome(int64_t t) { return t ? t / 1000000 - 11644473600 : 0; }  // microseconds since 1601
int64_t FromFirefox(int64_t t) { return t / 1000000; }                        // microseconds since 1970

void ChromeBookmarks(CefRefPtr<CefDictionaryValue> node, std::vector<ImportEntry>& out) {
  if (!node) return;
  if (node->GetString("type") == "url" && Web(node->GetString("url"))) out.push_back({node->GetString("url"), node->GetString("name")});
  auto kids = node->GetList("children");
  for (size_t i = 0; kids && i < kids->GetSize(); ++i) ChromeBookmarks(kids->GetDictionary(i), out);
}

}  // namespace

std::vector<Profile> FindProfiles(const std::string& home) {
  std::vector<Profile> out;
  const std::pair<const char*, const char*> chromes[] = {
      {"Chrome", ".config/google-chrome"},     {"Chromium", ".config/chromium"},
      {"Brave", ".config/BraveSoftware/Brave-Browser"}, {"Edge", ".config/microsoft-edge"},
      {"Vivaldi", ".config/vivaldi"},
      {"Chrome (Flatpak)", ".var/app/com.google.Chrome/config/google-chrome"},
      {"Chromium (Flatpak)", ".var/app/org.chromium.Chromium/config/chromium"},
      {"Brave (Flatpak)", ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"},
      {"Edge (Flatpak)", ".var/app/com.microsoft.Edge/config/microsoft-edge"},
      {"Vivaldi (Flatpak)", ".var/app/com.vivaldi.Vivaldi/config/vivaldi"},
  };
  std::error_code ec;
  for (auto [name, rel] : chromes) {
    fs::path root = fs::path(home) / rel;
    for (auto& d : fs::directory_iterator(root, ec)) {
      std::string base = d.path().filename().string();
      if ((base == "Default" || base.rfind("Profile ", 0) == 0) &&
          (fs::exists(d.path() / "History") || fs::exists(d.path() / "Bookmarks")))
        out.push_back({base == "Default" ? name : std::string(name) + " · " + base, d.path().string(), false});
    }
  }
  const std::pair<const char*, const char*> foxes[] = {
      {"Firefox", ".mozilla/firefox"}, {"Firefox (Flatpak)", ".var/app/org.mozilla.firefox/.mozilla/firefox"}};
  for (auto [name, rel] : foxes) {
    for (auto& d : fs::directory_iterator(fs::path(home) / rel, ec)) {
      if (!fs::exists(d.path() / "places.sqlite")) continue;
      std::string base = d.path().filename().string();
      out.push_back({std::string(name) + " · " + base.substr(base.find('.') + 1), d.path().string(), true});
    }
  }
  return out;
}

std::string ReadProfile(const Profile& p, std::vector<ImportEntry>& bookmarks, std::vector<ImportEntry>& history) {
  if (p.firefox) {
    std::string db = p.dir + "/places.sqlite";
    std::string e = Query(db,
                          "SELECT p.url, b.title, 0, 0 FROM moz_bookmarks b JOIN moz_places p ON p.id = b.fk "
                          "WHERE b.type = 1",
                          bookmarks, nullptr);
    if (!e.empty()) return e;
    return Query(db,
                 "SELECT url, title, last_visit_date, visit_count FROM moz_places WHERE last_visit_date IS NOT NULL "
                 "ORDER BY last_visit_date DESC LIMIT 100000",
                 history, FromFirefox);
  }
  std::ifstream f(p.dir + "/Bookmarks");
  if (f) {
    std::stringstream ss;
    ss << f.rdbuf();
    auto v = CefParseJSON(ss.str(), JSON_PARSER_RFC);
    auto roots = v && v->GetType() == VTYPE_DICTIONARY ? v->GetDictionary()->GetDictionary("roots") : nullptr;
    if (roots) {
      CefDictionaryValue::KeyList keys;
      roots->GetKeys(keys);
      for (auto& k : keys) ChromeBookmarks(roots->GetDictionary(k), bookmarks);
    }
  }
  return Query(p.dir + "/History",
               "SELECT url, title, last_visit_time, visit_count FROM urls ORDER BY last_visit_time DESC LIMIT 100000",
               history, FromChrome);
}
