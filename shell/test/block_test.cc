// Checks for shell/src/block.cc. Run: build/block_test
#include <cassert>
#include <cstdio>

#include "../src/block.h"

int main() {
  Filter f;
  size_t used = f.Add(
      "[Adblock Plus 2.0]\n"
      "! comment\n"
      "||ads.example^\n"
      "||tracker.net^$third-party\n"
      "||cdn.tracker.net^\r\n"
      "@@||ok.ads.example^\n"
      "||narrow.com^$script\n"     // skipped: narrower than the whole host
      "||path.com/ad.js\n"         // skipped: path rule
      "example.org##.banner\n"     // skipped: cosmetic
      "||wild*.com^\n"             // skipped: wildcard
      "@@||x.tracker.net^$third-party\n");  // skipped: odd exception
  assert(used == 4);
  assert(f.Blocks("ads.example", "news.com"));
  assert(f.Blocks("a.b.ads.example", "news.com"));
  assert(!f.Blocks("ok.ads.example", "news.com"));
  assert(!f.Blocks("sub.ok.ads.example", "news.com"));
  assert(!f.Blocks("notads.example", "news.com"));
  assert(f.Blocks("tracker.net", "news.com"));
  assert(!f.Blocks("tracker.net", "www.tracker.net"));  // first party
  assert(f.Blocks("cdn.tracker.net", "tracker.net"));   // plain rule blocks first party too
  assert(!f.Blocks("narrow.com", "news.com"));
  assert(!f.Blocks("path.com", "news.com"));

  assert(Site("a.b.example.com") == "example.com");
  assert(Site("example.com") == "example.com");
  assert(Site("www.bbc.co.uk") == "bbc.co.uk");
  assert(Site("bbc.co.uk") == "bbc.co.uk");
  assert(Site("kaorii-ako.github.io") == "kaorii-ako.github.io");
  assert(Site("localhost") == "localhost");
  assert(Site("co.uk") == "co.uk");

  assert(UrlHost("https://User@WWW.Example.com:8443/p?q#f") == "www.example.com");
  assert(UrlHost("http://127.0.0.1/") == "127.0.0.1");
  assert(UrlHost("http://[::1]:80/") == "[::1]");
  assert(UrlHost("tobari://about/") == "");
  assert(UrlHost("data:text/html,x") == "");
  puts("block_test: all checks passed");
}
