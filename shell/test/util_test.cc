// Checks for shell/src/util.cc. Run: build/util_test
#include <cassert>
#include <cstdio>
#include <set>

#include "../src/util.h"

int main() {
  assert(FixupInput("  example.com ") == "https://example.com");
  assert(FixupInput("github.com/torvalds/linux") == "https://github.com/torvalds/linux");
  assert(FixupInput("http://a.b") == "http://a.b");
  assert(FixupInput("tobari://about") == "tobari://about");
  assert(FixupInput("localhost:8080/x") == "http://localhost:8080/x");
  assert(FixupInput("192.168.1.1") == "http://192.168.1.1");
  assert(FixupInput("3.5") == "https://duckduckgo.com/?q=3.5");
  assert(FixupInput("what is cef") == "https://duckduckgo.com/?q=what%20is%20cef");
  assert(FixupInput("javascript:alert(1)") == "https://duckduckgo.com/?q=javascript%3Aalert%281%29");
  assert(FixupInput("東京 天気") == "https://duckduckgo.com/?q=%E6%9D%B1%E4%BA%AC%20%E5%A4%A9%E6%B0%97");
  assert(FixupInput("") == "");
  assert(FixupInput("!w tokyo tower") == "https://en.wikipedia.org/w/index.php?search=tokyo%20tower");
  assert(FixupInput("tokyo tower !W") == "https://en.wikipedia.org/w/index.php?search=tokyo%20tower");
  assert(FixupInput("rust !gh async") == "https://github.com/search?q=rust%20async");
  assert(FixupInput("!wth กรุงเทพ") == "https://th.wikipedia.org/w/index.php?search=%E0%B8%81%E0%B8%A3%E0%B8%B8%E0%B8%87%E0%B9%80%E0%B8%97%E0%B8%9E");
  assert(FixupInput("!nope x") == "https://duckduckgo.com/?q=%21nope%20x");
  assert(FixupInput("!yt") == "https://www.youtube.com/results?search_query=");

  assert(UiPath("ui", "/") == "ui.html");
  assert(UiPath("about", "/") == "about.html");
  assert(UiPath("ui", "/ui.css") == "ui.css");
  assert(UiPath("ui", "/../etc/passwd") == "");
  assert(UiPath("ui", "//etc/passwd") == "");
  assert(UiPath("ui", "/a\\b") == "");
  assert(UiPath("", "/") == "");

  std::set<std::string> have = {"/d/a.pdf", "/d/a (1).pdf", "/d/README"};
  auto exists = [&](const std::string& p) { return have.count(p) > 0; };
  assert(FreeName("/d", "a.pdf", exists) == "/d/a (2).pdf");
  assert(FreeName("/d", "README", exists) == "/d/README (1)");
  assert(FreeName("/d", "../../.bashrc", exists) == "/d/bashrc");
  assert(FreeName("/d", "", exists) == "/d/download");
  {  // SseDeltas: split chunks, escapes, Thai, surrogate pairs, [DONE], partial line kept
    bool done = false;
    std::string buf = "data: {\"choices\":[{\"delta\":{\"role\":\"assistant\",\"content\":\"Hi \\\"x\\\"\\n\"}}]}\n\n"
                      ": ping\ndata: {\"choices\":[{\"delta\":{\"content\":\"\u0e2a\u0e27\u0e31\\ud83d\\ude00\"}}]}\ndata: {\"choi";
    auto d = SseDeltas(buf, done);
    assert(d.size() == 2 && d[0] == "Hi \"x\"\n" && !done);
    assert(d[1] == "\u0e2a\u0e27\u0e31\U0001F600");
    assert(buf == "data: {\"choi");
    buf += "ces\":[{\"delta\":{}}]}\ndata: [DONE]\n";
    assert(SseDeltas(buf, done).empty() && done && buf.empty());
  }
  puts("util_test: all checks passed");
}
