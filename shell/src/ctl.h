#pragma once

// The CLI for outside agents: `tobari tabs | open URL | text [ID] | close ID` talks to the running browser over a
// Unix socket in the data dir (only this user can reach it). Request: "cmd\targ\n". Reply: "ok\n" or
// "error\n", then the body.

// Browser side: listens on a thread and hands each request to Shell::Ctl on the UI thread.
void CtlServe();
// Client side, before CEF starts. Returns the exit code, or -1 when argv isn't a CLI command.
int CtlClient(int argc, char* argv[]);
