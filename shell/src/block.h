// Network-layer blocking from Adblock-style lists. Pure code with no CEF dependency, so
// shell/test/block_test.cc can check it.
#pragma once
#include <string>
#include <unordered_set>

// shortcut: only host rules (||host^, @@||host^, optional $third-party) are used, which is the bulk of
// EasyList and EasyPrivacy network rules; path and $domain= rules and cosmetic filters are skipped.
// Upgrade to a full matcher (adblock-rust) if blocking misses become a complaint.
struct Filter {
  std::unordered_set<std::string> block, block3p, allow;

  // Adds the rules of one list. Returns how many were used.
  size_t Add(const std::string& list);
  // host: the request's host. site: the host of the top-level page (first party).
  bool Blocks(const std::string& host, const std::string& site) const;
  size_t Size() const { return block.size() + block3p.size() + allow.size(); }
};

// The registrable part of a host: "a.b.example.co.uk" → "example.co.uk".
// shortcut: knows only common two-part suffixes, not the full Public Suffix List; upgrade if
// third-party detection is wrong for a site that matters.
std::string Site(const std::string& host);

// Lower-cased host of an http(s) URL, or "" for anything else.
std::string UrlHost(const std::string& url);
