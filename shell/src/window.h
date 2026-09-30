#pragma once

#include <map>
#include <string>
#include <vector>

#include "include/cef_browser.h"
#include "include/cef_drag_handler.h"
#include "include/cef_client.h"
#include "include/views/cef_browser_view.h"
#include "include/views/cef_browser_view_delegate.h"
#include "include/views/cef_panel.h"
#include "include/views/cef_panel_delegate.h"
#include "include/views/cef_window.h"
#include "include/views/cef_window_delegate.h"
#include "include/wrapper/cef_message_router.h"

namespace tobari {

inline constexpr int kChromeHeight = 72;

class FixedHeightDelegate : public CefPanelDelegate {
 public:
  explicit FixedHeightDelegate(int height) : height_(height) {}

  void SetHeight(int height) { height_ = height; }

  CefSize GetPreferredSize(CefRefPtr<CefView> view) override {
    return CefSize(1, height_);
  }
  CefSize GetMinimumSize(CefRefPtr<CefView> view) override {
    return CefSize(1, height_);
  }
  CefSize GetMaximumSize(CefRefPtr<CefView> view) override {
    return CefSize(100000, height_);
  }

 private:
  int height_;

  IMPLEMENT_REFCOUNTING(FixedHeightDelegate);
  DISALLOW_COPY_AND_ASSIGN(FixedHeightDelegate);
};

class BrowserWindow;

struct Tab {
  int id = 0;
  CefRefPtr<CefBrowserView> view;
  CefRefPtr<CefBrowser> browser;
  std::string url;
  std::string title;
  bool loading = false;
  bool can_go_back = false;
  bool can_go_forward = false;
};

class BrowserWindow : public CefBaseRefCounted {
 public:
  static void CreateNew();

  BrowserWindow();

  void OnWindowReady(CefRefPtr<CefWindow> window);
  void OnWindowGone();

  void NewTab(const std::string& url);
  void CloseTab(int id);
  void SelectTab(int id);
  void Navigate(const std::string& url);
  void GoBack();
  void GoForward();
  void Reload();
  void SetPanelOpen(bool open);
  void SetChromeHeight(int height);
  void SetDraggableRegions(const std::vector<CefDraggableRegion>& regions);
  void MinimizeWindow();
  void ToggleMaximizeWindow();
  void CloseWindow();
  bool IsMaximized() const;

  void OnContentBrowserCreated(int tab_id, CefRefPtr<CefBrowser> browser);
  void OnContentBrowserClosing(int tab_id);
  void OnTabStateChanged(int tab_id);
  void SetTabTitle(int tab_id, const std::string& title);
  void SetTabUrl(int tab_id, const std::string& url);
  void SetTabLoading(int tab_id, bool loading, bool back, bool forward);
  void NoteBlockedRequest();
  void FlushBlockedCount();
  void ToggleBlocking();
  void ReloadUi();

  void SetUiBrowser(CefRefPtr<CefBrowser> browser);
  CefRefPtr<CefWindow> window() const { return window_; }

 private:
  Tab* FindTab(int id);
  Tab* ActiveTab();
  void PushState();
  void ApplyVisibility();

  CefRefPtr<CefWindow> window_;
  CefRefPtr<CefBrowserView> ui_view_;
  CefRefPtr<CefPanel> ui_panel_;
  CefRefPtr<FixedHeightDelegate> chrome_height_delegate_;
  CefRefPtr<CefBrowser> ui_browser_;
  CefRefPtr<CefPanel> content_panel_;

  std::vector<Tab> tabs_;
  int active_id_ = 0;
  int next_id_ = 1;
  int blocked_count_ = 0;
  bool panel_open_ = false;
  bool blocking_enabled_ = true;
  bool push_pending_ = false;
  bool ui_ready_ = false;

  IMPLEMENT_REFCOUNTING(BrowserWindow);
  DISALLOW_COPY_AND_ASSIGN(BrowserWindow);
};

}  // namespace tobari
