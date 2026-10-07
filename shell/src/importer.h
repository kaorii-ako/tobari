#pragma once

#include <string>

namespace tobari {

// Import from other browsers (blocker/src/import.rs does the reading). Each
// returns JSON for the toolbar extension's import page. They block on disk
// and keyring access, so they must not run on the UI thread.

std::string ImportSources();

// Reads the source's cookies and writes them into Tobari's own cookie store,
// so sites you are signed in to stay signed in.
std::string ImportCookies(const std::string& source_id);

// Bookmarks, history and the extension list are returned to the page, which
// writes them through the extension APIs Chromium provides for that.
std::string ImportData(const std::string& op, const std::string& source_id);

}  // namespace tobari
