#pragma once

#include <string>
#include <vector>

namespace tobari {

struct Entry {
  std::string url;
  std::string title;
  double stamp = 0;
};

class Store {
 public:
  static Store& Get();

  void Load();

  const std::vector<Entry>& Bookmarks() const { return bookmarks_; }
  const std::vector<Entry>& History() const { return history_; }
  const std::vector<Entry>& Reading() const { return reading_; }

  bool ToggleBookmark(const std::string& url, const std::string& title);
  bool IsBookmarked(const std::string& url) const;
  void ToggleReading(const std::string& url, const std::string& title);
  void RecordVisit(const std::string& url, const std::string& title);
  void Remove(const std::string& kind, const std::string& url);
  void Clear(const std::string& kind);

  std::string ToJson(const std::string& kind) const;

 private:
  Store() = default;

  std::string PathFor(const std::string& kind) const;
  void Save(const std::string& kind) const;
  const std::vector<Entry>* ListFor(const std::string& kind) const;
  std::vector<Entry>* ListFor(const std::string& kind);

  std::vector<Entry> bookmarks_;
  std::vector<Entry> history_;
  std::vector<Entry> reading_;
  bool loaded_ = false;
};

}  // namespace tobari
