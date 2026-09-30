#include "blocking.h"

#include <unistd.h>

#include <vector>

#include "include/base/cef_logging.h"
#include "tobari_blocker.h"

namespace tobari {
namespace {

const char* const kLists[] = {
    "easylist.txt",
    "easyprivacy.txt",
    "ubo-filters.txt",
    "ubo-privacy.txt",
};

std::string ExecutableDir() {
  char buffer[4096];
  const ssize_t len = readlink("/proc/self/exe", buffer, sizeof(buffer) - 1);
  if (len <= 0) {
    return ".";
  }
  buffer[len] = '\0';
  std::string path(buffer);
  const size_t slash = path.find_last_of('/');
  return slash == std::string::npos ? std::string(".") : path.substr(0, slash);
}

std::string UserFilterDir() {
  const char* xdg = getenv("XDG_DATA_HOME");
  if (xdg && *xdg) {
    return std::string(xdg) + "/tobari/filters";
  }
  const char* home = getenv("HOME");
  return std::string(home ? home : ".") + "/.local/share/tobari/filters";
}

bool Readable(const std::string& path) {
  return access(path.c_str(), R_OK) == 0;
}

}  // namespace

std::string HostOf(const std::string& url) {
  const size_t scheme = url.find("://");
  if (scheme == std::string::npos) {
    return std::string();
  }
  const size_t start = scheme + 3;
  const size_t end = url.find_first_of("/?#", start);
  std::string host = url.substr(start, end == std::string::npos ? std::string::npos : end - start);
  const size_t at = host.find('@');
  if (at != std::string::npos) {
    host = host.substr(at + 1);
  }
  const size_t colon = host.find(':');
  if (colon != std::string::npos) {
    host = host.substr(0, colon);
  }
  return host;
}

Blocking& Blocking::Get() {
  static Blocking instance;
  return instance;
}

Blocking::~Blocking() {
  if (handle_) {
    tobari_blocker_free(handle_);
    handle_ = nullptr;
  }
}

void Blocking::Load() {
  std::lock_guard<std::mutex> lock(mutex_);
  if (handle_) {
    return;
  }

  const char* disabled = getenv("TOBARI_NO_BLOCKING");
  if (disabled && *disabled && std::string(disabled) != "0") {
    LOG(WARNING) << "tobari: blocking disabled by TOBARI_NO_BLOCKING";
    return;
  }

  const std::string user_dir = UserFilterDir();
  const std::string bundled_dir = ExecutableDir() + "/filters";

  std::vector<std::string> paths;
  for (const char* name : kLists) {
    const std::string user_path = user_dir + "/" + name;
    const std::string bundled_path = bundled_dir + "/" + name;
    if (Readable(user_path)) {
      paths.push_back(user_path);
    } else if (Readable(bundled_path)) {
      paths.push_back(bundled_path);
    }
  }

  if (paths.empty()) {
    LOG(ERROR) << "tobari: no filter lists found; blocking is inactive";
    return;
  }

  std::vector<const char*> raw;
  raw.reserve(paths.size());
  for (const std::string& p : paths) {
    raw.push_back(p.c_str());
  }

  handle_ = tobari_blocker_new(raw.data(), raw.size());
  if (handle_) {
    LOG(INFO) << "tobari: blocking engine loaded " << tobari_blocker_rule_count(handle_)
              << " rules from " << paths.size() << " lists";
  }
}

size_t Blocking::RuleCount() const {
  return handle_ ? tobari_blocker_rule_count(handle_) : 0;
}

bool Blocking::ShouldBlock(const std::string& url,
                           const std::string& source_url,
                           const std::string& resource_type,
                           const std::string& method) {
  if (!handle_) {
    return false;
  }
  return tobari_blocker_should_block(handle_, url.c_str(), source_url.c_str(),
                                     resource_type.c_str(), method.c_str()) != 0;
}

void Blocking::SetHostDisabled(const std::string& host, bool disabled) {
  std::lock_guard<std::mutex> lock(mutex_);
  if (disabled) {
    disabled_hosts_.insert(host);
  } else {
    disabled_hosts_.erase(host);
  }
}

bool Blocking::HostDisabled(const std::string& host) const {
  std::lock_guard<std::mutex> lock(mutex_);
  return disabled_hosts_.count(host) > 0;
}

}  // namespace tobari
