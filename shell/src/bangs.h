#pragma once

#include <string>

namespace tobari {

void LoadBangs();
size_t BangCount();

// If |url| is a search-results URL from a known engine and the query carries a
// !bang, writes the bang's destination to |target| and returns true. The
// engine is never contacted for such a query.
bool ResolveBangSearch(const std::string& url, std::string* target);

// Resolves raw omnibox-style text ("rust !docsrs") directly.
bool ResolveBangText(const std::string& text, std::string* target);

}  // namespace tobari
