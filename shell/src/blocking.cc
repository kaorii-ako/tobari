#include "blocking.h"

#include <sys/stat.h>

#include <cstdio>
#include <ctime>
#include <sstream>

#include "include/cef_parser.h"
#include "paths.h"
#include "tobari_blocker.h"

namespace tobari {
namespace {

const char* const kLists[] = {
    "easylist.txt",
    "easyprivacy.txt",
    "ubo-filters.txt",
    "ubo-privacy.txt",
};

std::string DisabledHostsPath() { return DataDir() + "/state/disabled-hosts.json"; }

size_t CountRules(const std::string& path) {
  std::string text;
  if (!ReadFile(path, &text)) return 0;
  size_t rules = 0;
  std::stringstream ss(text);
  std::string line;
  while (std::getline(ss, line)) {
    if (line.empty() || line[0] == '!' || line[0] == '[') continue;
    ++rules;
  }
  return rules;
}

long long Mtime(const std::string& path) {
  struct stat st;
  return stat(path.c_str(), &st) == 0 ? static_cast<long long>(st.st_mtime) : 0;
}

// When the list was published, not when this file was copied. EasyList
// stamps "! Version: YYYYMMDDHHMM" (UTC); lists the updater downloaded are
// dated by their write; bundled lists without a stamp use the snapshot time
// recorded by scripts/update-filters.sh.
long long PublishedAt(const std::string& path, bool user_copy) {
  std::string text;
  if (ReadFile(path, &text)) {
    const std::string key = "! Version: ";
    const size_t at = text.find(key);
    if (at != std::string::npos && at < 2048) {
      const std::string v = text.substr(at + key.size(), 12);
      struct tm t = {};
      if (v.size() == 12 && strptime(v.c_str(), "%Y%m%d%H%M", &t)) {
        return static_cast<long long>(timegm(&t));
      }
    }
  }
  if (user_copy) return Mtime(path);
  std::string snapshot;
  if (ReadFile(ResourcesDir() + "/filters/SNAPSHOT", &snapshot)) {
    const long long when = std::atoll(snapshot.c_str());
    if (when > 0) return when;
  }
  return Mtime(path);
}

}  // namespace

std::string HostOf(const std::string& url) {
  const size_t scheme = url.find("://");
  if (scheme == std::string::npos) return std::string();
  const size_t start = scheme + 3;
  const size_t end = url.find_first_of("/?#", start);
  std::string host = url.substr(start, end == std::string::npos ? std::string::npos : end - start);
  const size_t at = host.find('@');
  if (at != std::string::npos) host = host.substr(at + 1);
  if (!host.empty() && host[0] == '[') {
    const size_t close = host.find(']');
    return close == std::string::npos ? std::string() : host.substr(0, close + 1);
  }
  const size_t colon = host.find(':');
  if (colon != std::string::npos) host = host.substr(0, colon);
  return host;
}

Blocking& Blocking::Get() {
  static Blocking instance;
  return instance;
}

Blocking::~Blocking() {
  std::unique_lock<std::shared_mutex> lock(engine_mutex_);
  if (handle_) tobari_blocker_free(handle_);
  handle_ = nullptr;
}

void Blocking::Load() {
  LoadDisabledHosts();

  const char* disabled = getenv("TOBARI_NO_BLOCKING");
  if (disabled && *disabled && std::string(disabled) != "0") {
    fprintf(stderr, "tobari: blocking disabled by TOBARI_NO_BLOCKING\n");
    return;
  }

  std::vector<ListInfo> lists;
  for (const char* name : kLists) {
    const std::string user_path = FiltersDir() + "/" + name;
    const std::string bundled_path = ResourcesDir() + "/filters/" + name;
    const std::string path = Readable(user_path) ? user_path : (Readable(bundled_path) ? bundled_path : "");
    if (path.empty()) continue;
    lists.push_back({name, path, CountRules(path), PublishedAt(path, path == user_path)});
  }
  if (lists.empty()) {
    fprintf(stderr, "tobari: no filter lists found; blocking is inactive\n");
    return;
  }

  std::vector<const char*> raw;
  for (const ListInfo& l : lists) raw.push_back(l.path.c_str());
  void* fresh = tobari_blocker_new(raw.data(), raw.size());
  if (!fresh) {
    // A downloaded list the engine cannot use must not leave the browser
    // unprotected: fall back to the lists shipped with this build.
    fprintf(stderr, "tobari: filter lists failed to load; using the bundled copies\n");
    lists.clear();
    for (const char* name : kLists) {
      const std::string bundled_path = ResourcesDir() + "/filters/" + name;
      if (Readable(bundled_path)) {
        lists.push_back({name, bundled_path, CountRules(bundled_path), PublishedAt(bundled_path, false)});
      }
    }
    raw.clear();
    for (const ListInfo& l : lists) raw.push_back(l.path.c_str());
    fresh = lists.empty() ? nullptr : tobari_blocker_new(raw.data(), raw.size());
    if (!fresh) return;
  }

  void* old = nullptr;
  {
    std::unique_lock<std::shared_mutex> lock(engine_mutex_);
    old = handle_;
    handle_ = fresh;
    lists_ = lists;
  }
  if (old) tobari_blocker_free(old);
}

bool Blocking::Ready() const {
  std::shared_lock<std::shared_mutex> lock(engine_mutex_);
  return handle_ != nullptr;
}

size_t Blocking::RuleCount() const {
  std::shared_lock<std::shared_mutex> lock(engine_mutex_);
  return handle_ ? tobari_blocker_rule_count(handle_) : 0;
}

std::vector<ListInfo> Blocking::Lists() const {
  std::shared_lock<std::shared_mutex> lock(engine_mutex_);
  return lists_;
}

bool Blocking::ShouldBlock(const std::string& url,
                           const std::string& source_url,
                           const std::string& resource_type,
                           const std::string& method) {
  // adblock-rust is built single-threaded (RefCell/Rc inside the engine), so
  // checks are serialized even though today only the IO thread makes them.
  std::unique_lock<std::shared_mutex> lock(engine_mutex_);
  if (!handle_) return false;
  return tobari_blocker_should_block(handle_, url.c_str(), source_url.c_str(),
                                     resource_type.c_str(), method.c_str()) != 0;
}

void Blocking::LoadDisabledHosts() {
  std::lock_guard<std::mutex> lock(hosts_mutex_);
  if (hosts_loaded_) return;
  hosts_loaded_ = true;
  std::string json;
  if (!ReadFile(DisabledHostsPath(), &json)) return;
  CefRefPtr<CefValue> v = CefParseJSON(json, JSON_PARSER_RFC);
  if (!v || v->GetType() != VTYPE_LIST) return;
  CefRefPtr<CefListValue> list = v->GetList();
  for (size_t i = 0; i < list->GetSize(); ++i) {
    const std::string host = list->GetString(i).ToString();
    if (!host.empty()) disabled_hosts_.insert(host);
  }
}

void Blocking::SaveDisabledHosts() const {
  CefRefPtr<CefListValue> list = CefListValue::Create();
  size_t i = 0;
  for (const std::string& h : disabled_hosts_) list->SetString(i++, h);
  CefRefPtr<CefValue> v = CefValue::Create();
  v->SetList(list);
  WriteFileAtomic(DisabledHostsPath(), CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString());
}

void Blocking::SetHostDisabled(const std::string& host, bool disabled) {
  std::lock_guard<std::mutex> lock(hosts_mutex_);
  if (disabled) disabled_hosts_.insert(host);
  else disabled_hosts_.erase(host);
  SaveDisabledHosts();
}

bool Blocking::HostDisabled(const std::string& host) const {
  std::lock_guard<std::mutex> lock(hosts_mutex_);
  return disabled_hosts_.count(host) > 0;
}

}  // namespace tobari
