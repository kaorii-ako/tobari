#include "store.h"

#include <sys/stat.h>
#include <sys/types.h>

#include <algorithm>
#include <chrono>
#include <fstream>
#include <sstream>

#include "include/base/cef_logging.h"
#include "include/cef_parser.h"

namespace tobari {
namespace {

constexpr size_t kHistoryCap = 3000;

std::string ProfileDir() {
  const char* xdg = getenv("XDG_DATA_HOME");
  std::string base;
  if (xdg && *xdg) {
    base = std::string(xdg) + "/tobari";
  } else {
    const char* home = getenv("HOME");
    base = std::string(home ? home : ".") + "/.local/share/tobari";
  }
  return base + "/profiles/default";
}

void EnsureDir(const std::string& path) {
  std::string acc;
  std::stringstream ss(path);
  std::string part;
  while (std::getline(ss, part, '/')) {
    if (part.empty()) {
      acc += "/";
      continue;
    }
    acc += part + "/";
    mkdir(acc.c_str(), 0700);
  }
}

double Now() {
  using namespace std::chrono;
  return duration_cast<milliseconds>(system_clock::now().time_since_epoch()).count() / 1000.0;
}

}  // namespace

Store& Store::Get() {
  static Store instance;
  return instance;
}

std::string Store::PathFor(const std::string& kind) const {
  return ProfileDir() + "/" + kind + ".json";
}

const std::vector<Entry>* Store::ListFor(const std::string& kind) const {
  if (kind == "bookmarks") return &bookmarks_;
  if (kind == "history") return &history_;
  if (kind == "reading") return &reading_;
  return nullptr;
}

std::vector<Entry>* Store::ListFor(const std::string& kind) {
  return const_cast<std::vector<Entry>*>(
      static_cast<const Store*>(this)->ListFor(kind));
}

void Store::Load() {
  if (loaded_) {
    return;
  }
  loaded_ = true;
  EnsureDir(ProfileDir());

  for (const char* kind : {"bookmarks", "history", "reading"}) {
    std::ifstream in(PathFor(kind));
    if (!in) {
      continue;
    }
    std::stringstream buffer;
    buffer << in.rdbuf();
    CefRefPtr<CefValue> parsed = CefParseJSON(buffer.str(), JSON_PARSER_RFC);
    if (!parsed || parsed->GetType() != VTYPE_LIST) {
      continue;
    }
    CefRefPtr<CefListValue> list = parsed->GetList();
    std::vector<Entry>* target = ListFor(kind);
    if (!target) {
      continue;
    }
    for (size_t i = 0; i < list->GetSize(); ++i) {
      CefRefPtr<CefDictionaryValue> d = list->GetDictionary(i);
      if (!d) {
        continue;
      }
      Entry e;
      e.url = d->GetString("url").ToString();
      e.title = d->GetString("title").ToString();
      e.stamp = d->GetDouble("stamp");
      if (!e.url.empty()) {
        target->push_back(std::move(e));
      }
    }
  }
}

void Store::Save(const std::string& kind) const {
  const std::vector<Entry>* list = ListFor(kind);
  if (!list) {
    return;
  }
  EnsureDir(ProfileDir());
  CefRefPtr<CefListValue> out = CefListValue::Create();
  for (size_t i = 0; i < list->size(); ++i) {
    CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
    d->SetString("url", (*list)[i].url);
    d->SetString("title", (*list)[i].title);
    d->SetDouble("stamp", (*list)[i].stamp);
    out->SetDictionary(i, d);
  }
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetList(out);
  const std::string json = CefWriteJSON(value, JSON_WRITER_DEFAULT).ToString();

  const std::string path = PathFor(kind);
  const std::string tmp = path + ".tmp";
  {
    std::ofstream file(tmp, std::ios::trunc);
    if (!file) {
      LOG(ERROR) << "tobari: cannot write " << tmp;
      return;
    }
    file << json;
  }
  rename(tmp.c_str(), path.c_str());
}

bool Store::IsBookmarked(const std::string& url) const {
  return std::any_of(bookmarks_.begin(), bookmarks_.end(),
                     [&url](const Entry& e) { return e.url == url; });
}

bool Store::ToggleBookmark(const std::string& url, const std::string& title) {
  if (url.empty()) {
    return false;
  }
  auto it = std::find_if(bookmarks_.begin(), bookmarks_.end(),
                         [&url](const Entry& e) { return e.url == url; });
  bool added;
  if (it == bookmarks_.end()) {
    bookmarks_.push_back({url, title, Now()});
    added = true;
  } else {
    bookmarks_.erase(it);
    added = false;
  }
  Save("bookmarks");
  return added;
}

void Store::ToggleReading(const std::string& url, const std::string& title) {
  if (url.empty()) {
    return;
  }
  auto it = std::find_if(reading_.begin(), reading_.end(),
                         [&url](const Entry& e) { return e.url == url; });
  if (it == reading_.end()) {
    reading_.push_back({url, title, Now()});
  } else {
    reading_.erase(it);
  }
  Save("reading");
}

void Store::RecordVisit(const std::string& url, const std::string& title) {
  if (url.empty() || url.rfind("tobari://", 0) == 0 || url == "about:blank") {
    return;
  }
  if (!history_.empty() && history_.back().url == url) {
    history_.back().title = title;
    return;
  }
  history_.push_back({url, title, Now()});
  if (history_.size() > kHistoryCap) {
    history_.erase(history_.begin(), history_.begin() + (history_.size() - kHistoryCap));
  }
  Save("history");
}

void Store::Remove(const std::string& kind, const std::string& url) {
  std::vector<Entry>* list = ListFor(kind);
  if (!list) {
    return;
  }
  list->erase(std::remove_if(list->begin(), list->end(),
                             [&url](const Entry& e) { return e.url == url; }),
              list->end());
  Save(kind);
}

void Store::Clear(const std::string& kind) {
  std::vector<Entry>* list = ListFor(kind);
  if (!list) {
    return;
  }
  list->clear();
  Save(kind);
}

std::string Store::ToJson(const std::string& kind) const {
  const std::vector<Entry>* list = ListFor(kind);
  if (!list) {
    return "[]";
  }
  CefRefPtr<CefListValue> out = CefListValue::Create();
  size_t index = 0;
  for (auto it = list->rbegin(); it != list->rend(); ++it, ++index) {
    CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
    d->SetString("url", it->url);
    d->SetString("title", it->title);
    d->SetDouble("stamp", it->stamp);
    out->SetDictionary(index, d);
  }
  CefRefPtr<CefValue> value = CefValue::Create();
  value->SetList(out);
  return CefWriteJSON(value, JSON_WRITER_DEFAULT).ToString();
}

}  // namespace tobari
