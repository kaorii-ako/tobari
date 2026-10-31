#include "block.h"

#include <cctype>
#include <sstream>

namespace {

bool HostChars(const std::string& h) {
  if (h.empty() || h.find('.') == std::string::npos) return false;
  for (char c : h)
    if (!islower(static_cast<unsigned char>(c)) && !isdigit(static_cast<unsigned char>(c)) && c != '.' && c != '-')
      return false;
  return true;
}

}  // namespace

size_t Filter::Add(const std::string& list) {
  std::istringstream in(list);
  std::string line;
  size_t used = 0;
  while (std::getline(in, line)) {
    if (!line.empty() && line.back() == '\r') line.pop_back();
    bool exception = line.rfind("@@", 0) == 0;
    if (exception) line.erase(0, 2);
    if (line.rfind("||", 0) != 0) continue;
    size_t caret = line.find('^');
    if (caret == std::string::npos) continue;
    std::string host = line.substr(2, caret - 2);
    std::string rest = line.substr(caret + 1);
    if (!rest.empty() && rest[0] == '|') rest.erase(0, 1);
    bool third = false, ok = HostChars(host);
    if (!rest.empty()) {
      if (rest[0] != '$') continue;
      std::istringstream opts(rest.substr(1));
      std::string o;
      while (ok && std::getline(opts, o, ',')) {
        if (o == "third-party" || o == "3p") third = true;
        else if (o != "important" && o != "all") ok = false;  // anything narrower would over-block
      }
    }
    if (!ok || (exception && third)) continue;
    (exception ? allow : third ? block3p : block).insert(host);
    ++used;
  }
  return used;
}

bool Filter::Blocks(const std::string& host, const std::string& site) const {
  // Check "a.b.c", then "b.c", then "c"; an exception for any of them wins.
  bool hit = false;
  bool third = Site(host) != Site(site);
  for (size_t at = 0; at != std::string::npos;) {
    std::string h = host.substr(at);
    if (allow.count(h)) return false;
    hit = hit || block.count(h) || (third && block3p.count(h));
    at = host.find('.', at);
    if (at != std::string::npos) ++at;
  }
  return hit;
}

std::string Site(const std::string& host) {
  static const std::unordered_set<std::string> two = {
      "co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp", "or.jp", "ac.jp",
      "co.th", "ac.th", "go.th", "in.th", "or.th", "com.br", "com.cn", "com.tw", "co.kr", "co.nz", "co.in",
      "github.io", "gitlab.io", "pages.dev", "vercel.app", "netlify.app", "blogspot.com", "appspot.com"};
  size_t last = host.rfind('.');
  if (last == std::string::npos || last == 0) return host;
  size_t second = host.rfind('.', last - 1);
  if (second == std::string::npos) return host;
  if (!two.count(host.substr(second + 1))) return host.substr(second + 1);
  size_t third = second == 0 ? std::string::npos : host.rfind('.', second - 1);
  return third == std::string::npos ? host : host.substr(third + 1);
}

std::string UrlHost(const std::string& url) {
  size_t s = url.find("://");
  if (s == std::string::npos) return "";
  std::string scheme = url.substr(0, s);
  if (scheme != "http" && scheme != "https") return "";
  std::string h = url.substr(s + 3, url.find_first_of("/?#", s + 3) - s - 3);
  h = h.substr(h.find('@') + 1);  // npos + 1 == 0
  if (!h.empty() && h[0] == '[') return h.substr(0, h.find(']') + 1);
  h = h.substr(0, h.find(':'));
  for (char& c : h) c = static_cast<char>(tolower(static_cast<unsigned char>(c)));
  return h;
}
