#include "platform.h"

#include <cstdlib>
#include <cstring>
#include <chrono>
#include <thread>

#ifdef _WIN32
#define WIN32_LEAN_AND_MEAN
#define NOMINMAX
#include <winsock2.h>
#include <windows.h>
#include <afunix.h>
#include <shellapi.h>
#include <shlobj.h>
#else
#include <dlfcn.h>
#include <spawn.h>
#include <sys/socket.h>
#include <sys/stat.h>
#include <sys/un.h>
#include <sys/wait.h>
#include <unistd.h>
#include <cerrno>
#endif

#ifdef _WIN32

namespace {
std::string Narrow(const wchar_t* w, int len = -1) {
  int n = WideCharToMultiByte(CP_UTF8, 0, w, len, nullptr, 0, nullptr, nullptr);
  std::string s(n > 0 ? n : 0, '\0');
  if (n > 0) WideCharToMultiByte(CP_UTF8, 0, w, len, s.data(), n, nullptr, nullptr);
  if (len < 0 && !s.empty()) s.pop_back();  // the terminator
  return s;
}
std::wstring Wide(const std::string& s) {
  int n = MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, nullptr, 0);
  std::wstring w(n > 0 ? n : 0, L'\0');
  if (n > 0) MultiByteToWideChar(CP_UTF8, 0, s.c_str(), -1, w.data(), n);
  if (!w.empty()) w.pop_back();
  return w;
}
std::string Slashes(std::string s) {
  for (char& c : s)
    if (c == '\\') c = '/';
  return s;
}
void WinsockOnce() {
  static bool done = [] { WSADATA d; return WSAStartup(MAKEWORD(2, 2), &d) == 0; }();
  (void)done;
}
}  // namespace

std::string ExePath() {
  wchar_t buf[32768];
  DWORD n = GetModuleFileNameW(nullptr, buf, 32768);
  return Slashes(Narrow(buf, static_cast<int>(n)));
}

std::string Env(const char* name) {
  const wchar_t* v = _wgetenv(Wide(name).c_str());
  return v ? Narrow(v) : "";
}

std::string HomeDir() { return Slashes(Env("USERPROFILE")); }

std::string AppDataBase() {
  std::string x = Env("LOCALAPPDATA");
  return Slashes(x.empty() ? HomeDir() + "/AppData/Local" : x);
}

std::string KnownDownloads() {
  PWSTR p = nullptr;
  std::string out;
  if (SHGetKnownFolderPath(FOLDERID_Downloads, 0, nullptr, &p) == S_OK) out = Slashes(Narrow(p));
  CoTaskMemFree(p);
  return out;
}

std::vector<std::string> Utf8Args(int, char*[]) {
  int n = 0;
  wchar_t** w = CommandLineToArgvW(GetCommandLineW(), &n);
  std::vector<std::string> out;
  for (int i = 0; i < n; ++i) out.push_back(Narrow(w[i]));
  LocalFree(w);
  return out;
}

void MakeDir(const std::string& path) { CreateDirectoryW(Wide(path).c_str(), nullptr); }
void MakePrivate(const std::string&) {}

bool Launch(const std::vector<std::string>& argv) {
  // Each argument quoted the way CommandLineToArgvW reads it back.
  std::wstring cmd;
  for (auto& a : argv) {
    std::wstring w = Wide(a), q = L"\"";
    size_t bs = 0;
    for (wchar_t c : w) {
      if (c == L'\\') { ++bs; continue; }
      q.append(c == L'"' ? bs * 2 + 1 : bs, L'\\');
      bs = 0;
      q += c;
    }
    q.append(bs * 2, L'\\');
    cmd += q + L"\" ";
  }
  STARTUPINFOW si{sizeof si};
  PROCESS_INFORMATION pi{};
  if (!CreateProcessW(Wide(argv[0]).c_str(), cmd.data(), nullptr, nullptr, FALSE,
                      DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP, nullptr, nullptr, &si, &pi))
    return false;
  CloseHandle(pi.hThread);
  CloseHandle(pi.hProcess);
  return true;
}

void SleepMs(int ms) { Sleep(static_cast<DWORD>(ms)); }

namespace {
bool Address(const std::string& p, sockaddr_un& a) {
  a = {};
  a.sun_family = AF_UNIX;
  if (p.size() >= sizeof a.sun_path) return false;
  memcpy(a.sun_path, p.c_str(), p.size() + 1);
  return true;
}
}  // namespace

Sock SockListen(const std::string& path) {
  WinsockOnce();
  sockaddr_un a;
  SOCKET s = socket(AF_UNIX, SOCK_STREAM, 0);
  if (s == INVALID_SOCKET) return kNoSock;
  DeleteFileW(Wide(path).c_str());
  if (!Address(path, a) || bind(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || listen(s, 8) != 0) {
    closesocket(s);
    return kNoSock;
  }
  return static_cast<Sock>(s);
}

Sock SockAccept(Sock s) {
  SOCKET c = accept(static_cast<SOCKET>(s), nullptr, nullptr);
  return c == INVALID_SOCKET ? kNoSock : static_cast<Sock>(c);
}

Sock SockConnect(const std::string& path) {
  WinsockOnce();
  sockaddr_un a;
  SOCKET s = socket(AF_UNIX, SOCK_STREAM, 0);
  if (s == INVALID_SOCKET) return kNoSock;
  if (!Address(path, a) || connect(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) {
    closesocket(s);
    return kNoSock;
  }
  return static_cast<Sock>(s);
}

void SockSendAll(Sock s, const std::string& d) {
  for (size_t at = 0; at < d.size();) {
    int n = send(static_cast<SOCKET>(s), d.data() + at, static_cast<int>(d.size() - at), 0);
    if (n <= 0) return;
    at += n;
  }
}

long SockRecv(Sock s, char* buf, size_t n) { return recv(static_cast<SOCKET>(s), buf, static_cast<int>(n), 0); }

void SockTimeout(Sock s, int seconds) {
  DWORD ms = seconds * 1000;
  setsockopt(static_cast<SOCKET>(s), SOL_SOCKET, SO_RCVTIMEO, reinterpret_cast<const char*>(&ms), sizeof ms);
}

void SockClose(Sock s) { closesocket(static_cast<SOCKET>(s)); }

const char* SqliteLibName() { return "winsqlite3.dll"; }
void* LoadLib(const char* name) { return reinterpret_cast<void*>(LoadLibraryA(name)); }
void* LibSym(void* lib, const char* name) {
  return reinterpret_cast<void*>(GetProcAddress(static_cast<HMODULE>(lib), name));
}

#else  // Linux

std::string ExePath() {
  char buf[4096];
  ssize_t n = readlink("/proc/self/exe", buf, sizeof buf - 1);
  return std::string(buf, n > 0 ? n : 0);
}

std::string Env(const char* name) {
  const char* v = getenv(name);
  return v ? v : "";
}

std::string HomeDir() { return Env("HOME"); }

std::string AppDataBase() {
  std::string x = Env("XDG_DATA_HOME");
  return x.empty() ? HomeDir() + "/.local/share" : x;
}

std::string KnownDownloads() { return ""; }  // util.cc reads user-dirs.dirs

std::vector<std::string> Utf8Args(int argc, char* argv[]) { return std::vector<std::string>(argv, argv + argc); }

void MakeDir(const std::string& path) { mkdir(path.c_str(), 0700); }
void MakePrivate(const std::string& file) { chmod(file.c_str(), 0600); }

bool Launch(const std::vector<std::string>& args) {
  std::vector<char*> argv;
  for (auto& s : args) argv.push_back(const_cast<char*>(s.c_str()));
  argv.push_back(nullptr);
  // Double fork so the new process isn't our child: it outlives us and leaves no zombie.
  pid_t pid = fork();
  if (pid == 0) {
    setsid();
    if (fork() == 0) execv(argv[0], argv.data());
    _exit(0);
  }
  if (pid > 0) waitpid(pid, nullptr, 0);
  return pid > 0;
}

void SleepMs(int ms) { std::this_thread::sleep_for(std::chrono::milliseconds(ms)); }

namespace {
bool Address(const std::string& p, sockaddr_un& a) {
  a = {};
  a.sun_family = AF_UNIX;
  if (p.size() >= sizeof a.sun_path) return false;
  memcpy(a.sun_path, p.c_str(), p.size() + 1);
  return true;
}
}  // namespace

Sock SockListen(const std::string& path) {
  sockaddr_un a;
  int s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (s < 0) return kNoSock;
  // A socket left by a crash. Chromium's process singleton already makes this the only running browser.
  unlink(path.c_str());
  if (!Address(path, a) || bind(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0 || chmod(a.sun_path, 0600) != 0 ||
      listen(s, 8) != 0) {
    close(s);
    return kNoSock;
  }
  return s;
}

Sock SockAccept(Sock s) {
  for (;;) {
    int c = accept4(static_cast<int>(s), nullptr, nullptr, SOCK_CLOEXEC);
    if (c >= 0) return c;
    if (errno != EINTR && errno != ECONNABORTED) return kNoSock;
  }
}

Sock SockConnect(const std::string& path) {
  sockaddr_un a;
  int s = socket(AF_UNIX, SOCK_STREAM | SOCK_CLOEXEC, 0);
  if (s < 0) return kNoSock;
  if (!Address(path, a) || connect(s, reinterpret_cast<sockaddr*>(&a), sizeof a) != 0) {
    close(s);
    return kNoSock;
  }
  return s;
}

void SockSendAll(Sock s, const std::string& d) {
  for (size_t at = 0; at < d.size();) {
    ssize_t n = send(static_cast<int>(s), d.data() + at, d.size() - at, MSG_NOSIGNAL);
    if (n <= 0 && errno != EINTR) return;
    if (n > 0) at += n;
  }
}

long SockRecv(Sock s, char* buf, size_t n) {
  for (;;) {
    ssize_t r = read(static_cast<int>(s), buf, n);
    if (r >= 0 || errno != EINTR) return static_cast<long>(r);
  }
}

void SockTimeout(Sock s, int seconds) {
  timeval tv{seconds, 0};
  setsockopt(static_cast<int>(s), SOL_SOCKET, SO_RCVTIMEO, &tv, sizeof tv);
}

void SockClose(Sock s) { close(static_cast<int>(s)); }

const char* SqliteLibName() { return "libsqlite3.so.0"; }
void* LoadLib(const char* name) { return dlopen(name, RTLD_NOW | RTLD_LOCAL); }
void* LibSym(void* lib, const char* name) { return dlsym(lib, name); }

#endif
