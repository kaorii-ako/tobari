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
// ~/.local/share/tobari. The default profile lives here; others under profiles/<name>/ with their own everything.
std::string DataRoot();
// The profile this process runs, "" for the default. Set once from --profile=NAME before CEF starts.
const std::string& CurrentProfile();
bool SetProfile(const std::string& name);
bool ValidProfile(const std::string& name);
// "Default" first, then the others by name.
std::vector<std::string> Profiles();
// Bang keys that can be the default search engine; SetSearch picks one for FixupInput's fallback.
const std::vector<std::string>& SearchEngines();
bool SetSearch(const std::string& key);

// $HOME, or "" when unset.
std::string Home();

// The XDG download directory from ~/.config/user-dirs.dirs, or ~/Downloads.
std::string DownloadDir();

// Writes through a temporary file (mode 0600) so a crash mid-write can't leave a truncated file.
void WriteFile(const std::string& path, const std::string& data);

// OpenAI-compatible streaming: takes the complete lines out of buf (a partial last line stays) and returns
// the choices[0].delta.content text of each "data:" event. Sets done on "data: [DONE]".
std::vector<std::string> SseDeltas(std::string& buf, bool& done);
