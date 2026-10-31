// Pure helpers with no CEF dependency, so shell/test/util_test.cc can check them.
#pragma once
#include <functional>
#include <string>
#include <vector>

// What the user typed in the address or command bar, turned into a URL to load.
// Anything that doesn't look like an address becomes a DuckDuckGo search.
std::string FixupInput(const std::string& text);

// !bangs, resolved on this device: "!w tokyo" or "tokyo !w" goes straight to the site's search.
struct Bang {
  const char *key, *name, *url;  // url has one %s for the encoded query
};
const std::vector<Bang>& Bangs();

// Path under ui/ for a tobari:// request, or "" if the request must be refused.
// tobari://<host>/ maps to <host>.html; any other path maps to itself.
std::string UiPath(const std::string& host, const std::string& path);

// Download file name that won't overwrite an existing file: "a.pdf", then "a (1).pdf", ...
std::string FreeName(const std::string& dir, std::string name,
                     const std::function<bool(const std::string&)>& exists);

// $XDG_DATA_HOME/tobari, or ~/.local/share/tobari.
std::string DataDir();

// The XDG download directory from ~/.config/user-dirs.dirs, or ~/Downloads.
std::string DownloadDir();

// Writes through a temporary file (mode 0600) so a crash mid-write can't leave a truncated file.
void WriteFile(const std::string& path, const std::string& data);
