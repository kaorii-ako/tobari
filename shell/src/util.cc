#include "util.h"

#include <cctype>
#include <cstdio>
#include <cstdlib>
#include <fstream>

#include <sys/stat.h>
#include <algorithm>
#include <filesystem>

namespace {
std::string g_profile;  // "" is the default profile, which lives at the data root as before profiles existed
std::string g_search = "https://duckduckgo.com/?q=%s";
}  // namespace

std::string Home() {
  const char* h = getenv("HOME");
  return h ? h : "";
}

namespace {

std::string Trim(const std::string& s) {
  size_t a = s.find_first_not_of(" \t\r\n"), b = s.find_last_not_of(" \t\r\n");
  return a == std::string::npos ? "" : s.substr(a, b - a + 1);
}

std::string Encode(const std::string& s) {
  static const char* hex = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : s) {
    if (isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~') {
      out += c;
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

bool StartsWith(const std::string& s, const char* p) {
  return s.rfind(p, 0) == 0;
}

// Host part of "host[:port][/path]", lower-cased.
std::string HostOf(const std::string& s) {
  std::string h = s.substr(0, s.find_first_of("/?#"));
  h = h.substr(0, h.find(':'));
  for (char& c : h) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return h;
}

bool LooksLikeHost(const std::string& h) {
  if (h == "localhost") return true;
  size_t dot = h.rfind('.');
  if (dot == std::string::npos || dot == 0 || dot + 1 >= h.size()) return false;
  for (char c : h)
    if (!isalnum(static_cast<unsigned char>(c)) && c != '-' && c != '.') return false;
  std::string tld = h.substr(dot + 1);
  bool digits = true, letters = true;
  for (char c : tld) {
    digits = digits && isdigit(static_cast<unsigned char>(c));
    letters = letters && isalpha(static_cast<unsigned char>(c));
  }
  if (digits) {  // IPv4: four numeric parts
    int dots = 0;
    for (char c : h) dots += c == '.';
    return dots == 3;
  }
  return letters && tld.size() >= 2;
}

// "!w tokyo", "tokyo !w" → the bang's search URL; "" if there is no known bang.
std::string BangUrl(const std::string& t) {
  size_t a = t[0] == '!' ? 0 : t.rfind(" !");
  if (a == std::string::npos) return "";
  if (a) ++a;
  size_t b = t.find(' ', a);
  std::string key = t.substr(a + 1, b == std::string::npos ? std::string::npos : b - a - 1);
  for (char& c : key) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  for (const Bang& bang : Bangs()) {
    if (key != bang.key) continue;
    std::string q = Trim(Trim(t.substr(0, a)) + " " + (b == std::string::npos ? "" : Trim(t.substr(b))));
    std::string url = bang.url;
    return url.replace(url.find("%s"), 2, Encode(q));
  }
  return "";
}

}  // namespace

const std::vector<Bang>& Bangs() {
  static const std::vector<Bang> bangs = {
      {"ddg", "DuckDuckGo", "https://duckduckgo.com/?q=%s"},
      {"g", "Google", "https://www.google.com/search?q=%s"},
      {"b", "Bing", "https://www.bing.com/search?q=%s"},
      {"sp", "Startpage", "https://www.startpage.com/do/search?q=%s"},
      {"w", "Wikipedia (English)", "https://en.wikipedia.org/w/index.php?search=%s"},
      {"wja", "Wikipedia (Japanese)", "https://ja.wikipedia.org/w/index.php?search=%s"},
      {"wth", "Wikipedia (Thai)", "https://th.wikipedia.org/w/index.php?search=%s"},
      {"yt", "YouTube", "https://www.youtube.com/results?search_query=%s"},
      {"gh", "GitHub", "https://github.com/search?q=%s"},
      {"so", "Stack Overflow", "https://stackoverflow.com/search?q=%s"},
      {"r", "Reddit", "https://www.reddit.com/search/?q=%s"},
      {"mdn", "MDN Web Docs", "https://developer.mozilla.org/search?q=%s"},
      {"npm", "npm", "https://www.npmjs.com/search?q=%s"},
      {"pypi", "PyPI", "https://pypi.org/search/?q=%s"},
      {"crates", "crates.io", "https://crates.io/search?q=%s"},
      {"aw", "ArchWiki", "https://wiki.archlinux.org/index.php?search=%s"},
      {"flathub", "Flathub", "https://flathub.org/apps/search?q=%s"},
      {"osm", "OpenStreetMap", "https://www.openstreetmap.org/search?query=%s"},
      {"imdb", "IMDb", "https://www.imdb.com/find/?q=%s"},
      {"a", "Amazon", "https://www.amazon.com/s?k=%s"},
      {"jisho", "Jisho (Japanese dictionary)", "https://jisho.org/search/%s"},
      {"tr", "Google Translate", "https://translate.google.com/?sl=auto&text=%s"},
      {"arxiv", "arXiv", "https://arxiv.org/search/?searchtype=all&query=%s"},
      {"scholar", "Google Scholar", "https://scholar.google.com/scholar?q=%s"},
  };
  return bangs;
}

std::string FixupInput(const std::string& text) {
  std::string t = Trim(text);
  if (t.empty()) return "";
  for (const char* scheme : {"http://", "https://", "tobari://", "file://", "view-source:"})
    if (StartsWith(t, scheme)) return t;
  if (t.find(' ') == std::string::npos && LooksLikeHost(HostOf(t)))
    return (StartsWith(t, "localhost") || isdigit(static_cast<unsigned char>(t[0])) ? "http://" : "https://") + t;
  if (std::string bang = BangUrl(t); !bang.empty()) return bang;
  std::string u = g_search;
  return u.replace(u.find("%s"), 2, Encode(t));
}

const std::vector<std::string>& SearchEngines() {
  static const std::vector<std::string> keys = {"ddg", "g", "b", "sp"};
  return keys;
}

bool SetSearch(const std::string& key) {
  for (auto& k : SearchEngines())
    if (k == key)
      for (auto& b : Bangs())
        if (key == b.key) return g_search = b.url, true;
  return false;
}

std::string UiPath(const std::string& host, const std::string& path) {
  if (host.empty() || path.empty() || path[0] != '/') return "";
  std::string p = path == "/" ? host + ".html" : path.substr(1);
  if (p.find("..") != std::string::npos || p.find('\\') != std::string::npos || p[0] == '/') return "";
  for (unsigned char c : p)
    if (c < 0x20) return "";
  return p;
}

std::string FreeName(const std::string& dir, std::string name,
                     const std::function<bool(const std::string&)>& exists) {
  // The server suggests the name, so keep only its last path part and no leading dots.
  name = name.substr(name.find_last_of('/') + 1);
  while (!name.empty() && name[0] == '.') name.erase(0, 1);
  if (name.empty()) name = "download";
  size_t dot = name.rfind('.');
  std::string stem = dot == std::string::npos || dot == 0 ? name : name.substr(0, dot);
  std::string ext = stem.size() == name.size() ? "" : name.substr(dot);
  std::string path = dir + "/" + name;
  for (int i = 1; exists(path); ++i) path = dir + "/" + stem + " (" + std::to_string(i) + ")" + ext;
  return path;
}

std::string DataRoot() {
  const char* x = getenv("XDG_DATA_HOME");
  return (x && *x ? std::string(x) : Home() + "/.local/share") + "/tobari";
}

std::string DataDir() { return g_profile.empty() ? DataRoot() : DataRoot() + "/profiles/" + g_profile; }

const std::string& CurrentProfile() { return g_profile; }

bool ValidProfile(const std::string& name) {
  if (name.empty() || name.size() > 64 || name[0] == '.' || name[0] == ' ' || name.back() == ' ') return false;
  // Bytes >= 0x80 are UTF-8, so Thai and Japanese names work; '/' and control characters would escape the folder.
  for (unsigned char c : name)
    if (c < 0x20 || c == '/' || c == 0x7f) return false;
  return true;
}

bool SetProfile(const std::string& name) {
  if (name == "Default") return g_profile.clear(), true;
  if (!ValidProfile(name)) return false;
  g_profile = name;
  return true;
}

std::vector<std::string> Profiles() {
  std::vector<std::string> out = {"Default"};
  std::error_code ec;
  for (auto& d : std::filesystem::directory_iterator(DataRoot() + "/profiles", ec))
    if (d.is_directory() && ValidProfile(d.path().filename().string()) && d.path().filename() != "Default")
      out.push_back(d.path().filename().string());
  std::sort(out.begin() + 1, out.end());
  return out;
}

std::string DownloadDir() {
  const char* x = getenv("XDG_CONFIG_HOME");
  std::ifstream f((x && *x ? std::string(x) : Home() + "/.config") + "/user-dirs.dirs");
  std::string line;
  while (std::getline(f, line)) {
    if (!StartsWith(line, "XDG_DOWNLOAD_DIR=\"")) continue;
    std::string v = line.substr(18, line.rfind('"') - 18);
    if (StartsWith(v, "$HOME")) v = Home() + v.substr(5);
    if (!v.empty() && v[0] == '/') return v;
  }
  return Home() + "/Downloads";
}

void WriteFile(const std::string& path, const std::string& data) {
  std::string tmp = path + ".tmp";
  {
    std::ofstream f(tmp, std::ios::trunc);
    f << data;
    if (!f.flush()) return;
  }
  chmod(tmp.c_str(), 0600);
  rename(tmp.c_str(), path.c_str());
}

namespace {
// Decodes the JSON string starting just after its opening quote. Returns false on a malformed escape.
bool JsonString(const std::string& s, size_t i, std::string& out) {
  auto put = [&](unsigned c) {  // UTF-8 encode
    if (c < 0x80) out += char(c);
    else if (c < 0x800) out += char(0xC0 | c >> 6), out += char(0x80 | (c & 63));
    else if (c < 0x10000) out += char(0xE0 | c >> 12), out += char(0x80 | (c >> 6 & 63)), out += char(0x80 | (c & 63));
    else out += char(0xF0 | c >> 18), out += char(0x80 | (c >> 12 & 63)), out += char(0x80 | (c >> 6 & 63)), out += char(0x80 | (c & 63));
  };
  auto hex4 = [&](size_t at, unsigned& v) {
    if (at + 4 > s.size()) return false;
    v = std::stoul(s.substr(at, 4), nullptr, 16);
    return std::isxdigit(static_cast<unsigned char>(s[at + 3])) != 0;
  };
  for (; i < s.size(); ++i) {
    char c = s[i];
    if (c == '"') return true;
    if (c != '\\') { out += c; continue; }
    if (++i >= s.size()) return false;
    switch (s[i]) {
      case 'n': out += '\n'; break;
      case 't': out += '\t'; break;
      case 'r': out += '\r'; break;
      case 'b': out += '\b'; break;
      case 'f': out += '\f'; break;
      case 'u': {
        unsigned v, lo;
        if (!hex4(i + 1, v)) return false;
        i += 4;
        if (v >= 0xD800 && v < 0xDC00 && s.compare(i + 1, 2, "\\u") == 0 && hex4(i + 3, lo)) {
          v = 0x10000 + ((v - 0xD800) << 10) + (lo - 0xDC00);
          i += 6;
        }
        put(v);
        break;
      }
      default: out += s[i];  // \" \\ \/
    }
  }
  return false;
}
}  // namespace

std::vector<std::string> SseDeltas(std::string& buf, bool& done) {
  std::vector<std::string> out;
  size_t start = 0, nl;
  while ((nl = buf.find('\n', start)) != std::string::npos) {
    std::string line = buf.substr(start, nl - start);
    start = nl + 1;
    if (line.rfind("data:", 0) != 0) continue;
    if (line.find("[DONE]") != std::string::npos) { done = true; continue; }
    // shortcut: finds the first "content" key after "delta" instead of parsing the event, fine for the
    // flat chunks OpenAI-compatible servers send; parse with CefParseJSON if a provider nests content.
    size_t d = line.find("\"delta\"");
    size_t k = d == std::string::npos ? d : line.find("\"content\"", d);
    if (k == std::string::npos) continue;
    size_t q = line.find_first_not_of(" :", k + 9);
    std::string text;
    if (q != std::string::npos && line[q] == '"' && JsonString(line, q + 1, text) && !text.empty()) out.push_back(text);
  }
  buf.erase(0, start);
  return out;
}
