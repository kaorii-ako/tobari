#pragma once

#include <cstdlib>
#include <filesystem>
#include <string>
#include <unistd.h>

namespace tobari {

inline std::filesystem::path Home() {
  const char* h = std::getenv("HOME");
  return h && *h ? std::filesystem::path(h) : std::filesystem::path("/tmp");
}

inline std::filesystem::path Xdg(const char* var, const char* fallback) {
  const char* v = std::getenv(var);
  return v && *v ? std::filesystem::path(v) : Home() / fallback;
}

inline std::filesystem::path ProfileDir() {
  return Xdg("XDG_CONFIG_HOME", ".config") / "tobari" / "browser";
}

inline std::filesystem::path CrashDir() {
  return Xdg("XDG_STATE_HOME", ".local/state") / "tobari" / "crashes";
}

inline std::filesystem::path ExeDir() {
  char buf[4096];
  ssize_t n = readlink("/proc/self/exe", buf, sizeof(buf) - 1);
  if (n <= 0) return std::filesystem::current_path();
  buf[n] = 0;
  return std::filesystem::path(buf).parent_path();
}

}
