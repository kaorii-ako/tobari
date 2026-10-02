#include "filters_update.h"

#include <ctime>
#include <sstream>

#include "blocking.h"
#include "include/base/cef_callback.h"
#include "include/cef_request_context.h"
#include "include/cef_request_context_handler.h"
#include "include/cef_task.h"
#include "include/cef_urlrequest.h"
#include "include/wrapper/cef_closure_task.h"
#include "paths.h"

namespace tobari {
namespace {

struct Source {
  const char* name;
  const char* url;
};

const Source kSources[] = {
    {"easylist.txt", "https://easylist.to/easylist/easylist.txt"},
    {"easyprivacy.txt", "https://easylist.to/easylist/easyprivacy.txt"},
    {"ubo-filters.txt", "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/filters.txt"},
    {"ubo-privacy.txt", "https://raw.githubusercontent.com/uBlockOrigin/uAssets/master/filters/privacy.txt"},
};

constexpr long long kWeek = 7LL * 24 * 3600;
constexpr int64_t kDayMs = 24LL * 3600 * 1000;
constexpr size_t kMinBytes = 20 * 1024;
constexpr size_t kMinRules = 1000;
// About 4x the largest list today. A host that streams more than this is
// broken or hostile; either way the download is abandoned.
constexpr size_t kMaxBytes = 16 * 1024 * 1024;

std::string StampPath() { return DataDir() + "/state/filters-updated"; }

long long LastUpdated() {
  std::string text;
  return ReadFile(StampPath(), &text) ? std::atoll(text.c_str()) : 0;
}

size_t Rules(const std::string& text) {
  size_t n = 0;
  std::stringstream ss(text);
  std::string line;
  while (std::getline(ss, line)) {
    if (!line.empty() && line[0] != '!' && line[0] != '[') ++n;
  }
  return n;
}

size_t CurrentRules(const std::string& name) {
  for (const ListInfo& l : Blocking::Get().Lists()) {
    if (l.name == name) return l.rules;
  }
  return 0;
}

class ListClient : public CefURLRequestClient {
 public:
  explicit ListClient(std::string name) : name_(std::move(name)) {}

  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    CefRefPtr<CefResponse> response = request->GetResponse();
    // Redirects are not followed (UR_FLAG_STOP_ON_REDIRECT), so anything but
    // a direct 200 from the pinned URL counts as a failure.
    const int status = !overflow_ && request->GetRequestStatus() == UR_SUCCESS && response
                           ? response->GetStatus()
                           : 0;
    FilterUpdater::Get().OnListDone(name_, status, body_);
  }
  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadData(CefRefPtr<CefURLRequest> request, const void* data, size_t len) override {
    if (overflow_) return;
    if (body_.size() + len > kMaxBytes) {
      overflow_ = true;
      body_.clear();
      request->Cancel();
      return;
    }
    body_.append(static_cast<const char*>(data), len);
  }
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  std::string name_;
  std::string body_;
  bool overflow_ = false;

  IMPLEMENT_REFCOUNTING(ListClient);
};

CefRefPtr<CefRequestContext> IsolatedContext() {
  static CefRefPtr<CefRequestContext> ctx;
  if (!ctx) {
    CefRequestContextSettings settings;
    ctx = CefRequestContext::CreateContext(settings, nullptr);
  }
  return ctx;
}

}  // namespace

FilterUpdater& FilterUpdater::Get() {
  static FilterUpdater instance;
  return instance;
}

void FilterUpdater::ScheduleBackgroundChecks() {
  CefPostDelayedTask(TID_UI, base::BindOnce([] {
    FilterUpdater::Get().Start(false);
    FilterUpdater::Get().ScheduleBackgroundChecks();
  }), kDayMs);
}

void FilterUpdater::Start(bool force) {
  if (!CefCurrentlyOn(TID_UI)) {
    CefPostTask(TID_UI, base::BindOnce([](bool f) { FilterUpdater::Get().Start(f); }, force));
    return;
  }
  {
    std::lock_guard<std::mutex> lock(mutex_);
    if (running_) return;
    if (!force && std::time(nullptr) - LastUpdated() < kWeek) return;
    running_ = true;
    pending_ = static_cast<int>(sizeof(kSources) / sizeof(kSources[0]));
    replaced_ = 0;
    rejected_ = 0;
    state_ = "running";
  }
  for (const Source& s : kSources) {
    CefRefPtr<CefRequest> request = CefRequest::Create();
    request->SetURL(s.url);
    request->SetMethod("GET");
    request->SetFlags(UR_FLAG_DISABLE_CACHE | UR_FLAG_STOP_ON_REDIRECT);
    CefURLRequest::Create(request, new ListClient(s.name), IsolatedContext());
  }
}

void FilterUpdater::OnListDone(const std::string& name, int status, const std::string& body) {
  bool accept = false;
  if (status == 200 && body.size() >= kMinBytes) {
    const size_t fresh = Rules(body);
    const size_t current = CurrentRules(name);
    // Lists change by a few percent a week. Halving or tripling overnight
    // means the host is serving something else.
    accept = fresh >= kMinRules && fresh * 2 >= current && (current == 0 || fresh <= current * 3);
  }
  if (accept) {
    EnsureDir(FiltersDir());
    accept = WriteFileAtomic(FiltersDir() + "/" + name, body);
  }
  bool done = false;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    (accept ? replaced_ : rejected_) += 1;
    done = --pending_ == 0;
  }
  if (done) Finish();
}

void FilterUpdater::Finish() {
  int replaced = 0;
  int rejected = 0;
  {
    std::lock_guard<std::mutex> lock(mutex_);
    replaced = replaced_;
    rejected = rejected_;
  }
  if (replaced > 0) {
    WriteFileAtomic(StampPath(), std::to_string(static_cast<long long>(std::time(nullptr))) + "\n");
  }
  CefPostTask(TID_FILE_USER_BLOCKING, base::BindOnce([](int replaced, int rejected) {
    if (replaced > 0) Blocking::Get().Load();
    FilterUpdater& u = FilterUpdater::Get();
    std::lock_guard<std::mutex> lock(u.mutex_);
    u.running_ = false;
    std::ostringstream s;
    s << "updated " << replaced << ", rejected " << rejected;
    u.state_ = s.str();
  }, replaced, rejected));
}

std::string FilterUpdater::StateString() {
  std::lock_guard<std::mutex> lock(mutex_);
  return state_;
}

}  // namespace tobari
