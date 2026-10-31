// Read-only import of bookmarks and history from other browsers on this computer.
#pragma once
#include <cstdint>
#include <string>
#include <vector>

struct Profile {
  std::string name;  // "Chromium", "Firefox (Flatpak)", ...
  std::string dir;   // profile directory
  bool firefox;
};

struct ImportEntry {
  std::string url, title;
  int64_t last = 0;  // Unix seconds; 0 for bookmarks
  int count = 0;     // visits; 0 for bookmarks
};

// Profiles under home that have something to import: Chrome, Chromium, Brave, Edge, Vivaldi and Firefox,
// native and Flatpak.
std::vector<Profile> FindProfiles(const std::string& home);

// Reads http(s) bookmarks and history. Never writes to the other browser's files. Returns an error message,
// or "" on success.
std::string ReadProfile(const Profile& p, std::vector<ImportEntry>& bookmarks, std::vector<ImportEntry>& history);
