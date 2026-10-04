#pragma once

#include <mutex>
#include <set>
#include <shared_mutex>
#include <string>
#include <vector>

namespace tobari {

struct ListInfo {
  std::string name;
  std::string path;
  size_t rules = 0;
  long long modified = 0;
};

class Blocking {
 public:
  static Blocking& Get();

  // Builds the engine from the user's filter directory, falling back to the
  // lists shipped beside the binary. Safe to call again: the new engine is
  // built off to the side and swapped in, so lookups never wait on a parse.
  void Load();
  bool Ready() const;
  size_t RuleCount() const;
  std::vector<ListInfo> Lists() const;

  bool ShouldBlock(const std::string& url,
                   const std::string& source_url,
                   const std::string& resource_type,
                   const std::string& method);

  void SetHostDisabled(const std::string& host, bool disabled);
  bool HostDisabled(const std::string& host) const;
  std::vector<std::string> DisabledHosts() const;

 private:
  Blocking() = default;
  ~Blocking();

  void LoadDisabledHosts();
  void SaveDisabledHosts() const;

  mutable std::shared_mutex engine_mutex_;
  void* handle_ = nullptr;
  std::vector<ListInfo> lists_;

  mutable std::mutex hosts_mutex_;
  std::set<std::string> disabled_hosts_;
  bool hosts_loaded_ = false;
};

std::string HostOf(const std::string& url);

}  // namespace tobari
