#include "bangs.h"

#include <cctype>
#include <map>
#include <vector>

#include "include/cef_parser.h"
#include "paths.h"

namespace tobari {
namespace {

struct Bang {
  std::string url;
  bool raw = false;
};

std::map<std::string, Bang>& Table() {
  static std::map<std::string, Bang> table;
  return table;
}

struct Engine {
  const char* host;
  const char* path;
  const char* param;
};

const Engine kEngines[] = {
    {"www.google.com", "/search", "q"},
    {"google.com", "/search", "q"},
    {"duckduckgo.com", "/", "q"},
    {"html.duckduckgo.com", "/html", "q"},
    {"www.bing.com", "/search", "q"},
    {"search.brave.com", "/search", "q"},
    {"www.startpage.com", "/sp/search", "query"},
    {"www.startpage.com", "/do/search", "query"},
    {"search.yahoo.com", "/search", "p"},
    {"www.ecosia.org", "/search", "q"},
    {"kagi.com", "/search", "q"},
};

std::string Lower(std::string s) {
  for (char& c : s) c = static_cast<char>(std::tolower(static_cast<unsigned char>(c)));
  return s;
}

std::string Encode(const std::string& value, bool keep_slash) {
  static const char* hex = "0123456789ABCDEF";
  std::string out;
  for (unsigned char c : value) {
    if (std::isalnum(c) || c == '-' || c == '_' || c == '.' || c == '~' || (keep_slash && c == '/')) {
      out += static_cast<char>(c);
    } else {
      out += '%';
      out += hex[c >> 4];
      out += hex[c & 15];
    }
  }
  return out;
}

std::string Decode(const std::string& value) {
  std::string plus = value;
  for (char& c : plus) if (c == '+') c = ' ';
  return CefURIDecode(plus, true,
                      static_cast<cef_uri_unescape_rule_t>(UU_SPACES | UU_URL_SPECIAL_CHARS_EXCEPT_PATH_SEPARATORS))
      .ToString();
}

}  // namespace

void LoadBangs() {
  std::string json;
  if (!ReadFile(ExecutableDir() + "/extensions/newtab/bangs.json", &json)) return;
  CefRefPtr<CefValue> parsed = CefParseJSON(json, JSON_PARSER_RFC);
  if (!parsed || parsed->GetType() != VTYPE_LIST) return;
  CefRefPtr<CefListValue> list = parsed->GetList();
  for (size_t i = 0; i < list->GetSize(); ++i) {
    CefRefPtr<CefDictionaryValue> d = list->GetDictionary(i);
    if (!d) continue;
    Bang b;
    b.url = d->GetString("url").ToString();
    b.raw = d->HasKey("raw") && d->GetBool("raw");
    Table()[Lower(d->GetString("token").ToString())] = b;
  }
}

size_t BangCount() { return Table().size(); }

bool ResolveBangText(const std::string& text, std::string* target) {
  std::vector<std::string> words;
  std::string cur;
  for (char c : text) {
    if (std::isspace(static_cast<unsigned char>(c))) {
      if (!cur.empty()) words.push_back(cur), cur.clear();
    } else {
      cur += c;
    }
  }
  if (!cur.empty()) words.push_back(cur);

  for (size_t i = 0; i < words.size(); ++i) {
    if (words[i].size() < 2 || words[i][0] != '!') continue;
    const std::string token = words[i].substr(1);
    std::string query;
    for (size_t j = 0; j < words.size(); ++j) {
      if (j == i) continue;
      if (!query.empty()) query += ' ';
      query += words[j];
    }

    std::string pattern;
    bool raw = false;
    if (token.size() > 2 && token[0] == 'r' && token[1] == '/') {
      const std::string sub = token.substr(2);
      bool ok = !sub.empty();
      for (char c : sub) ok = ok && (std::isalnum(static_cast<unsigned char>(c)) || c == '_');
      if (!ok) continue;
      pattern = "https://www.reddit.com/r/" + sub + "/search/?restrict_sr=1&q={}";
    } else {
      auto it = Table().find(Lower(token));
      if (it == Table().end()) continue;
      pattern = it->second.url;
      raw = it->second.raw;
    }

    const size_t slot = pattern.find("{}");
    if (slot == std::string::npos) continue;
    if (query.empty()) {
      const size_t scheme = pattern.find("://");
      const size_t path = pattern.find('/', scheme == std::string::npos ? 0 : scheme + 3);
      *target = path == std::string::npos ? pattern.substr(0, slot) : pattern.substr(0, path + 1);
    } else {
      *target = pattern.substr(0, slot) + Encode(query, raw) + pattern.substr(slot + 2);
    }
    return true;
  }
  return false;
}

bool ResolveBangSearch(const std::string& url, std::string* target) {
  if (url.find('!') == std::string::npos && url.find("%21") == std::string::npos) return false;
  CefURLParts parts;
  if (!CefParseURL(url, parts)) return false;
  const std::string host = Lower(CefString(&parts.host).ToString());
  const std::string path = CefString(&parts.path).ToString();
  const std::string query = CefString(&parts.query).ToString();

  for (const Engine& e : kEngines) {
    if (host != e.host || path != e.path) continue;
    size_t pos = 0;
    while (pos <= query.size()) {
      size_t amp = query.find('&', pos);
      if (amp == std::string::npos) amp = query.size();
      const std::string pair = query.substr(pos, amp - pos);
      const size_t eq = pair.find('=');
      if (eq != std::string::npos && pair.substr(0, eq) == e.param) {
        return ResolveBangText(Decode(pair.substr(eq + 1)), target);
      }
      pos = amp + 1;
    }
  }
  return false;
}

}  // namespace tobari
