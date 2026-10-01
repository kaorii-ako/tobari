#pragma once

#include <mutex>
#include <string>

namespace tobari {

// Refreshes the filter lists in $XDG_DATA_HOME/tobari/filters once a week.
//
// Requests go through a separate in-memory request context, so no cookie,
// cache entry or credential from the user's profile is attached; they are
// plain GETs with no query string. A downloaded list replaces the current one
// only if it is non-trivially sized and has not lost more than half its rules,
// which catches truncation and an obviously swapped file. The lists are not
// signed upstream, so authenticity rests on TLS to the list hosts.
class FilterUpdater {
 public:
  static FilterUpdater& Get();

  void ScheduleBackgroundChecks();
  void Start(bool force);
  std::string StateString();

  void OnListDone(const std::string& name, int status, const std::string& body);

 private:
  FilterUpdater() = default;
  void Finish();

  std::mutex mutex_;
  bool running_ = false;
  int pending_ = 0;
  int replaced_ = 0;
  int rejected_ = 0;
  std::string state_ = "idle";
};

}  // namespace tobari
