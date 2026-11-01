// Everything that differs between Linux and Windows lives in platform.cc; other files stay free of OS
// #ifdefs (main.cc's entry point and cli_main.cc excepted). No CEF dependency, so tobari-cli links it too.
// Strings are UTF-8. On Windows the executables carry an activeCodePage=UTF-8 manifest, so narrow
// std::fstream/std::filesystem paths are UTF-8 there as well.
#pragma once
#include <cstddef>
#include <cstdint>
#include <string>
#include <vector>

// Absolute path of the running executable (on Windows: tobari.exe, CEF's bootstrap that loads tobari.dll).
std::string ExePath();
// Environment variable, "" when unset.
std::string Env(const char* name);
// $HOME, or %USERPROFILE%.
std::string HomeDir();
// Where per-user app data goes: $XDG_DATA_HOME or ~/.local/share, or %LOCALAPPDATA%.
std::string AppDataBase();
// The user's Downloads folder when the OS says where it is (Windows known folder), else "".
std::string KnownDownloads();
// The process arguments as UTF-8 (Windows reads them from GetCommandLineW).
std::vector<std::string> Utf8Args(int argc, char* argv[]);

// Creates one directory readable only by this user (0700). Windows: a folder under %LOCALAPPDATA% already
// is per-user by its ACL, so nothing more is set.
void MakeDir(const std::string& path);
// chmod 0600 on Linux; a no-op on Windows for the same reason.
void MakePrivate(const std::string& file);
// Starts argv[0] with the rest as arguments, detached so it outlives this process.
bool Launch(const std::vector<std::string>& argv);
void SleepMs(int ms);

// A local stream socket at a file path (AF_UNIX on both; Windows 10 1803+ has it).
using Sock = intptr_t;
constexpr Sock kNoSock = -1;
Sock SockListen(const std::string& path);  // replaces a stale socket file; Linux sets it to 0600
Sock SockAccept(Sock s);                   // kNoSock when the listener is gone
Sock SockConnect(const std::string& path);
void SockSendAll(Sock s, const std::string& data);
long SockRecv(Sock s, char* buf, size_t n);  // <= 0 on end or error
void SockTimeout(Sock s, int seconds);
void SockClose(Sock s);

// The system SQLite: libsqlite3.so.0, or winsqlite3.dll (in System32 since Windows 10).
const char* SqliteLibName();
void* LoadLib(const char* name);
void* LibSym(void* lib, const char* name);
