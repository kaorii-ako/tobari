#include "paths.h"

#include <sys/stat.h>
#include <unistd.h>

#include <cstdio>
#include <cstdlib>
#include <fstream>
#include <sstream>

namespace tobari {
namespace {

std::string Home() {
  const char* home = getenv("HOME");
  return home && *home ? home : ".";
}

std::string Xdg(const char* var, const char* fallback) {
  const char* v = getenv(var);
  if (v && *v) return v;
  return Home() + "/" + fallback;
}

}  // namespace

std::string ExecutablePath() {
  char buffer[4096];
  const ssize_t len = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (len <= 0) return "./tobari";
  buffer[len] = '\0';
  return buffer;
}

std::string ExecutableDir() {
  const std::string path = ExecutablePath();
  const size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string DataDir() { return Xdg("XDG_DATA_HOME", ".local/share") + "/tobari"; }
std::string ProfileDir() { return DataDir() + "/profiles/default"; }
std::string ExtensionsDir() { return DataDir() + "/extensions"; }
std::string FiltersDir() { return DataDir() + "/filters"; }

std::string DownloadsDir() {
  const char* v = getenv("XDG_DOWNLOAD_DIR");
  if (v && *v) return v;
  std::string dirs;
  if (ReadFile(Xdg("XDG_CONFIG_HOME", ".config") + "/user-dirs.dirs", &dirs)) {
    std::stringstream ss(dirs);
    std::string line;
    while (std::getline(ss, line)) {
      const std::string key = "XDG_DOWNLOAD_DIR=\"";
      if (line.rfind(key, 0) != 0) continue;
      std::string value = line.substr(key.size());
      if (!value.empty() && value.back() == '"') value.pop_back();
      const std::string token = "$HOME";
      if (value.rfind(token, 0) == 0) value = Home() + value.substr(token.size());
      if (!value.empty()) return value;
    }
  }
  return Home() + "/Downloads";
}

void EnsureDir(const std::string& path) {
  std::string acc;
  std::stringstream ss(path);
  std::string part;
  if (!path.empty() && path[0] == '/') acc = "/";
  while (std::getline(ss, part, '/')) {
    if (part.empty()) continue;
    acc += part + "/";
    mkdir(acc.c_str(), 0700);
  }
}

bool Readable(const std::string& path) { return access(path.c_str(), R_OK) == 0; }

bool ReadFile(const std::string& path, std::string* out) {
  std::ifstream in(path, std::ios::binary);
  if (!in) return false;
  std::stringstream buffer;
  buffer << in.rdbuf();
  *out = buffer.str();
  return true;
}

bool WriteFileAtomic(const std::string& path, const std::string& data) {
  const size_t slash = path.find_last_of('/');
  if (slash != std::string::npos) EnsureDir(path.substr(0, slash));
  const std::string tmp = path + ".tmp";
  {
    std::ofstream file(tmp, std::ios::binary | std::ios::trunc);
    if (!file) return false;
    file << data;
    if (!file.good()) return false;
  }
  return rename(tmp.c_str(), path.c_str()) == 0;
}

}  // namespace tobari
