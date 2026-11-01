#pragma once
#include <string>
#include <vector>

// The CLI for outside agents: `tobari tabs | open URL | text [ID] | close ID` talks to the running browser over a
// local socket in the data dir (only this user can reach it). Request: "cmd\targ\n". Reply: "ok\n" or
// "error\n", then the body.

// The socket's path for the current profile.
std::string CtlPath();
// Browser side (ctl.cc): listens on a thread and hands each request to Shell::Ctl on the UI thread.
void CtlServe();
// Client side (ctl_client.cc, no CEF), before CEF starts. args[0] is the program. Returns the exit code, or -1
// when the args aren't a CLI command.
int CtlClient(std::vector<std::string> args);
