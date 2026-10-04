#pragma once

namespace tobari {

// The setup flow in a window of its own: a native window holding one
// browser that shows tobari://welcome, with no tabs or address bar. Opened on
// a profile's first launch and from the toolbar's "Search & look". All
// functions run on the UI thread.

// Opens the window, or brings it forward if it is already open.
void ShowWelcomeWindow();

// Closes it if open. With |then_quit|, the message loop ends once it has
// closed (used when the last browser window goes first).
void CloseWelcomeWindow(bool then_quit);

bool WelcomeWindowOpen();

}  // namespace tobari
