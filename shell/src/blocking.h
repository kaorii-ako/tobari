#pragma once

#include <mutex>
#include <set>
#include <string>

namespace tobari {

class Blocking {
 public:
  static Blocking& Get();

  void Load();
  bool Ready() const { return handle_ != nullptr; }
  size_t RuleCount() const;

  bool ShouldBlock(const std::string& url,
                   const std::string& source_url,
                   const std::string& resource_type,
                   const std::string& method);

  void SetHostDisabled(const std::string& host, bool disabled);
  bool HostDisabled(const std::string& host) const;

 private:
  Blocking() = default;
  ~Blocking();

  void* handle_ = nullptr;
  mutable std::mutex mutex_;
  std::set<std::string> disabled_hosts_;
};

std::string HostOf(const std::string& url);

}  // namespace tobari
