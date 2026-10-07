#include "ai.h"

#include <arpa/inet.h>
#include <fcntl.h>
#include <netinet/in.h>
#include <signal.h>
#include <sys/socket.h>
#include <sys/wait.h>
#include <unistd.h>
#if defined(__linux__)
#include <sys/prctl.h>
#endif

#include <cstdio>
#include <deque>
#include <vector>

#include "include/base/cef_callback.h"
#include "include/cef_parser.h"
#include "include/cef_request_context.h"
#include "include/cef_request_context_handler.h"
#include "include/cef_task.h"
#include "include/cef_urlrequest.h"
#include "include/wrapper/cef_closure_task.h"
#include "paths.h"
#include "tobari_blocker.h"

namespace tobari {
namespace ai {
namespace {

// ------------------------------------------------------------------ catalog

struct Model {
  const char* id;
  const char* name;
  const char* note;
  const char* repo;
  const char* file;
  int64_t size;
  const char* sha256;
  int context;
};

// All Apache-2.0. SHA-256s from the Hugging Face tree API, checked again on
// 2026-10-07; a download whose hash differs is deleted, never loaded.
const Model kModels[] = {
    {"qwen3-4b", "Qwen3 4B Instruct", "Recommended. Good answers on most computers; faster with a GPU.",
     "unsloth/Qwen3-4B-Instruct-2507-GGUF", "Qwen3-4B-Instruct-2507-Q4_K_M.gguf", 2497281120LL,
     "3605803b982cb64aead44f6c1b2ae36e3acdb41d8e46c8a94c6533bc4c67e597", 8192},
    {"qwen3-0.6b", "Qwen3 0.6B", "Small and quick. Fine for grouping tabs; weaker at summaries.",
     "unsloth/Qwen3-0.6B-GGUF", "Qwen3-0.6B-Q4_K_M.gguf", 396705472LL,
     "ac2d97712095a558e31573f62f466a3f9d93990898b0ec79d7c974c1780d524a", 8192},
    {"qwen3-30b-a3b", "Qwen3 30B A3B Instruct", "Best answers. Needs a GPU with 16 GB of memory or more.",
     "unsloth/Qwen3-30B-A3B-Instruct-2507-GGUF", "Qwen3-30B-A3B-Instruct-2507-Q3_K_M.gguf", 14711847328LL,
     "e145c9d2f5d11c9583eb099aa75100b7ab943e77d5240c9a2cd936f81c89ef43", 8192},
};

const Model* FindModel(const std::string& id) {
  for (const Model& m : kModels) {
    if (id == m.id) return &m;
  }
  return nullptr;
}

std::string ModelsDir() { return DataDir() + "/models"; }
std::string ModelPath(const Model& m) { return ModelsDir() + "/" + m.file; }
std::string SelectionPath() { return DataDir() + "/state/ai-model"; }
std::string EnginePath() { return ResourcesDir() + "/ai/llama-server"; }

std::string Selected() {
  std::string id;
  ReadFile(SelectionPath(), &id);
  while (!id.empty() && (id.back() == '\n' || id.back() == ' ')) id.pop_back();
  const Model* m = FindModel(id);
  if (m && Readable(ModelPath(*m))) return id;
  for (const Model& any : kModels) {
    if (Readable(ModelPath(any))) return any.id;
  }
  return std::string();
}

CefRefPtr<CefRequestContext> IsolatedContext() {
  static CefRefPtr<CefRequestContext> ctx;
  if (!ctx) {
    CefRequestContextSettings settings;
    ctx = CefRequestContext::CreateContext(settings, nullptr);
  }
  return ctx;
}

// ------------------------------------------------------------------ download

struct Download {
  std::string model;
  int64_t received = 0;
  int64_t total = 0;
  std::string state = "idle";  // idle | downloading | verifying | failed
  std::string error;
  CefRefPtr<CefURLRequest> request;
  FILE* file = nullptr;
};

Download g_download;

class DownloadClient : public CefURLRequestClient {
 public:
  explicit DownloadClient(const Model& m) : model_(m) {}

  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    if (g_download.file) {
      fclose(g_download.file);
      g_download.file = nullptr;
    }
    const std::string part = ModelPath(model_) + ".part";
    CefRefPtr<CefResponse> response = request->GetResponse();
    const bool ok = request->GetRequestStatus() == UR_SUCCESS && response && response->GetStatus() == 200;
    g_download.request = nullptr;
    if (!ok) {
      unlink(part.c_str());
      if (g_download.state != "idle") {
        g_download.state = "failed";
        g_download.error = request->GetRequestStatus() == UR_CANCELED ? "cancelled" : "download failed";
      }
      return;
    }
    // Hashing a few GB takes seconds; off the UI thread.
    g_download.state = "verifying";
    const Model* m = &model_;
    CefPostTask(TID_FILE_USER_VISIBLE, base::BindOnce(
        [](const Model* m, std::string part) {
          char hex[65] = {0};
          const bool good = tobari_sha256_file(part.c_str(), hex) && std::string(hex) == m->sha256;
          if (good) {
            rename(part.c_str(), ModelPath(*m).c_str());
          } else {
            unlink(part.c_str());
          }
          CefPostTask(TID_UI, base::BindOnce(
              [](const Model* m, bool good) {
                if (good) {
                  g_download.state = "idle";
                  g_download.model.clear();
                  if (Selected().empty() || Selected() == m->id) WriteFileAtomic(SelectionPath(), m->id);
                } else {
                  g_download.state = "failed";
                  g_download.error = "the downloaded file did not match its published hash and was deleted";
                }
              },
              m, good));
        },
        m, part));
  }

  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t current, int64_t total) override {
    g_download.received = current;
    g_download.total = total > 0 ? total : model_.size;
  }
  void OnDownloadData(CefRefPtr<CefURLRequest> request, const void* data, size_t len) override {
    if (!g_download.file || fwrite(data, 1, len, g_download.file) != len) {
      g_download.error = "could not write the model file (disk full?)";
      request->Cancel();
    }
  }
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  const Model& model_;
  IMPLEMENT_REFCOUNTING(DownloadClient);
};

// ------------------------------------------------------------------ engine

struct Engine {
  pid_t pid = 0;
  int port = 0;
  std::string key;
  std::string model;
  bool ready = false;
  int64_t last_used = 0;
  std::deque<base::OnceClosure> waiting;
  std::string error;
};

Engine g_engine;
constexpr int kIdleStopSeconds = 600;

int64_t Now() { return static_cast<int64_t>(time(nullptr)); }

int FreePort() {
  const int fd = socket(AF_INET, SOCK_STREAM, 0);
  if (fd < 0) return 0;
  sockaddr_in addr{};
  addr.sin_family = AF_INET;
  addr.sin_addr.s_addr = htonl(INADDR_LOOPBACK);
  addr.sin_port = 0;
  socklen_t len = sizeof(addr);
  int port = 0;
  if (bind(fd, reinterpret_cast<sockaddr*>(&addr), sizeof(addr)) == 0 &&
      getsockname(fd, reinterpret_cast<sockaddr*>(&addr), &len) == 0) {
    port = ntohs(addr.sin_port);
  }
  close(fd);
  return port;
}

std::string RandomKey() {
  unsigned char bytes[24] = {0};
  const int fd = open("/dev/urandom", O_RDONLY | O_CLOEXEC);
  if (fd >= 0) {
    if (read(fd, bytes, sizeof(bytes)) != static_cast<ssize_t>(sizeof(bytes))) {
      // Fall through with whatever was read; the port is random too.
    }
    close(fd);
  }
  static const char kHex[] = "0123456789abcdef";
  std::string out;
  for (unsigned char b : bytes) {
    out += kHex[b >> 4];
    out += kHex[b & 15];
  }
  return out;
}

void StopEngine() {
  if (g_engine.pid > 0) {
    kill(g_engine.pid, SIGTERM);
    for (int i = 0; i < 20 && waitpid(g_engine.pid, nullptr, WNOHANG) == 0; ++i) usleep(50000);
    if (waitpid(g_engine.pid, nullptr, WNOHANG) == 0) {
      kill(g_engine.pid, SIGKILL);
      waitpid(g_engine.pid, nullptr, 0);
    }
  }
  g_engine.pid = 0;
  g_engine.ready = false;
  g_engine.model.clear();
}

bool EngineAlive() {
  return g_engine.pid > 0 && waitpid(g_engine.pid, nullptr, WNOHANG) == 0;
}

void FailWaiting(const std::string& error) {
  g_engine.error = error;
  auto waiting = std::move(g_engine.waiting);
  g_engine.waiting.clear();
  for (auto& closure : waiting) std::move(closure).Run();
}

class HealthClient : public CefURLRequestClient {
 public:
  explicit HealthClient(int attempt) : attempt_(attempt) {}
  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override;
  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadData(CefRefPtr<CefURLRequest>, const void*, size_t) override {}
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  int attempt_;
  IMPLEMENT_REFCOUNTING(HealthClient);
};

void CheckHealth(int attempt) {
  if (!EngineAlive()) {
    StopEngine();
    FailWaiting("the AI engine stopped while loading the model (see ai.log in Tobari's data folder)");
    return;
  }
  CefRefPtr<CefRequest> r = CefRequest::Create();
  r->SetURL("http://127.0.0.1:" + std::to_string(g_engine.port) + "/health");
  r->SetMethod("GET");
  r->SetFlags(UR_FLAG_DISABLE_CACHE);
  CefURLRequest::Create(r, new HealthClient(attempt), IsolatedContext());
}

void HealthClient::OnRequestComplete(CefRefPtr<CefURLRequest> request) {
  CefRefPtr<CefResponse> response = request->GetResponse();
  if (request->GetRequestStatus() == UR_SUCCESS && response && response->GetStatus() == 200) {
    g_engine.ready = true;
    g_engine.error.clear();
    auto waiting = std::move(g_engine.waiting);
    g_engine.waiting.clear();
    for (auto& closure : waiting) std::move(closure).Run();
    return;
  }
  if (attempt_ > 600) {  // five minutes: a large model on a slow disk
    StopEngine();
    FailWaiting("the AI engine did not become ready");
    return;
  }
  const int next = attempt_ + 1;
  CefPostDelayedTask(TID_UI, base::BindOnce([](int a) { CheckHealth(a); }, next), 500);
}

void IdleCheck() {
  if (g_engine.pid > 0 && Now() - g_engine.last_used >= kIdleStopSeconds) {
    StopEngine();
    return;
  }
  if (g_engine.pid > 0) CefPostDelayedTask(TID_UI, base::BindOnce(&IdleCheck), 60 * 1000);
}

// Runs |then| once the engine serves |model|, starting it if needed.
void EnsureEngine(const std::string& model_id, base::OnceClosure then) {
  g_engine.last_used = Now();
  if (EngineAlive() && g_engine.model == model_id) {
    if (g_engine.ready) {
      std::move(then).Run();
    } else {
      g_engine.waiting.push_back(std::move(then));
    }
    return;
  }
  StopEngine();
  const Model* m = FindModel(model_id);
  if (!m || !Readable(EnginePath())) {
    g_engine.error = Readable(EnginePath()) ? "no model" : "this build of Tobari does not include the AI engine";
    std::move(then).Run();
    return;
  }
  g_engine.port = FreePort();
  g_engine.key = RandomKey();
  g_engine.model = model_id;
  g_engine.error.clear();
  g_engine.waiting.push_back(std::move(then));

  // Everything the child needs is prepared before fork(); after it, only
  // async-signal-safe calls until exec.
  const std::string bin = EnginePath();
  const std::string log = DataDir() + "/state/ai.log";
  std::vector<std::string> args = {
      bin, "--model", ModelPath(*m), "--host", "127.0.0.1", "--port", std::to_string(g_engine.port),
      "--api-key", g_engine.key, "--ctx-size", std::to_string(m->context), "--n-gpu-layers", "99",
      "--jinja", "--no-webui", "--parallel", "1",
  };
  std::vector<char*> argv;
  for (std::string& a : args) argv.push_back(a.data());
  argv.push_back(nullptr);
  EnsureDir(DataDir() + "/state");

  const pid_t pid = fork();
  if (pid == 0) {
#if defined(__linux__)
    prctl(PR_SET_PDEATHSIG, SIGKILL);
#endif
    setpgid(0, 0);
    sigset_t none;
    sigemptyset(&none);
    sigprocmask(SIG_SETMASK, &none, nullptr);
    // The browser's sockets, files and IPC channels stay with the browser.
    for (int i = 3, max = static_cast<int>(sysconf(_SC_OPEN_MAX)); i < max && i < 65536; ++i) close(i);
    const int fd = open(log.c_str(), O_WRONLY | O_CREAT | O_TRUNC | O_CLOEXEC, 0600);
    if (fd >= 0) {
      dup2(fd, 1);
      dup2(fd, 2);
    }
    execv(argv[0], argv.data());
    _exit(127);
  }
  if (pid < 0) {
    FailWaiting("could not start the AI engine");
    return;
  }
  g_engine.pid = pid;
  CefPostDelayedTask(TID_UI, base::BindOnce([] { CheckHealth(0); }), 300);
  CefPostDelayedTask(TID_UI, base::BindOnce(&IdleCheck), 60 * 1000);
}

// ------------------------------------------------------------------ chat

class ChatClient : public CefURLRequestClient {
 public:
  ChatClient(CefRefPtr<Sink> sink, bool stream) : sink_(sink), stream_(stream) {}

  void OnDownloadData(CefRefPtr<CefURLRequest>, const void* data, size_t len) override {
    buffer_.append(static_cast<const char*>(data), len);
    if (!stream_) return;
    size_t nl;
    while ((nl = buffer_.find('\n')) != std::string::npos) {
      std::string line = buffer_.substr(0, nl);
      buffer_.erase(0, nl + 1);
      if (line.rfind("data: ", 0) != 0) continue;
      line.erase(0, 6);
      if (line == "[DONE]") continue;
      CefRefPtr<CefValue> v = CefParseJSON(line, JSON_PARSER_RFC);
      if (!v || v->GetType() != VTYPE_DICTIONARY) continue;
      CefRefPtr<CefListValue> choices = v->GetDictionary()->GetList("choices");
      if (!choices || !choices->GetSize()) continue;
      CefRefPtr<CefDictionaryValue> delta = choices->GetDictionary(0)->GetDictionary("delta");
      if (!delta) continue;
      const std::string text = delta->GetString("content").ToString();
      if (!text.empty()) Emit(text);
    }
  }

  void OnRequestComplete(CefRefPtr<CefURLRequest> request) override {
    g_engine.last_used = Now();
    CefRefPtr<CefResponse> response = request->GetResponse();
    if (request->GetRequestStatus() != UR_SUCCESS || !response || response->GetStatus() != 200) {
      sink_->OnDone("the AI engine did not answer");
      return;
    }
    if (!stream_) {
      CefRefPtr<CefValue> v = CefParseJSON(buffer_, JSON_PARSER_RFC);
      CefRefPtr<CefListValue> choices = v && v->GetType() == VTYPE_DICTIONARY
                                            ? v->GetDictionary()->GetList("choices")
                                            : nullptr;
      if (!choices || !choices->GetSize()) {
        sink_->OnDone("the AI engine sent an unreadable answer");
        return;
      }
      Emit(choices->GetDictionary(0)->GetDictionary("message")->GetString("content").ToString());
    }
    sink_->OnDone(std::string());
  }

  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  // Qwen3's small model can still emit an empty <think></think> block.
  void Emit(const std::string& text) {
    std::string t = text;
    if (!seen_text_) {
      const size_t open = t.find("<think>");
      const size_t close = t.find("</think>");
      if (open != std::string::npos && close != std::string::npos) t.erase(open, close + 8 - open);
      while (!t.empty() && (t[0] == '\n' || t[0] == ' ')) t.erase(0, 1);
      if (t.empty()) return;
      seen_text_ = true;
    }
    sink_->OnText(t);
  }

  CefRefPtr<Sink> sink_;
  const bool stream_;
  std::string buffer_;
  bool seen_text_ = false;
  IMPLEMENT_REFCOUNTING(ChatClient);
};

}  // namespace

// ------------------------------------------------------------------ public

CefRefPtr<CefDictionaryValue> State() {
  CefRefPtr<CefDictionaryValue> d = CefDictionaryValue::Create();
  const std::string selected = Selected();
  CefRefPtr<CefListValue> models = CefListValue::Create();
  size_t i = 0;
  for (const Model& m : kModels) {
    CefRefPtr<CefDictionaryValue> x = CefDictionaryValue::Create();
    x->SetString("id", m.id);
    x->SetString("name", m.name);
    x->SetString("note", m.note);
    x->SetDouble("size", static_cast<double>(m.size));
    x->SetBool("installed", Readable(ModelPath(m)));
    x->SetBool("selected", selected == m.id);
    models->SetDictionary(i++, x);
  }
  d->SetList("models", models);
  d->SetString("selected", selected);
  d->SetBool("engineIncluded", Readable(EnginePath()));
  d->SetString("engine", EngineAlive() ? (g_engine.ready ? "ready" : "loading") : "stopped");
  d->SetString("engineError", g_engine.error);
  CefRefPtr<CefDictionaryValue> dl = CefDictionaryValue::Create();
  dl->SetString("model", g_download.model);
  dl->SetString("state", g_download.state);
  dl->SetString("error", g_download.error);
  dl->SetDouble("received", static_cast<double>(g_download.received));
  dl->SetDouble("total", static_cast<double>(g_download.total));
  d->SetDictionary("download", dl);
  d->SetString("modelsDir", ModelsDir());
  return d;
}

CefRefPtr<CefDictionaryValue> StartDownload(const std::string& model_id) {
  const Model* m = FindModel(model_id);
  if (!m || g_download.state == "downloading" || g_download.state == "verifying") return State();
  EnsureDir(ModelsDir());
  const std::string part = ModelPath(*m) + ".part";
  g_download = Download();
  g_download.file = fopen(part.c_str(), "wb");
  if (!g_download.file) {
    g_download.state = "failed";
    g_download.error = "cannot write to " + ModelsDir();
    return State();
  }
  g_download.model = m->id;
  g_download.state = "downloading";
  g_download.total = m->size;
  CefRefPtr<CefRequest> r = CefRequest::Create();
  r->SetURL(std::string("https://huggingface.co/") + m->repo + "/resolve/main/" + m->file);
  r->SetMethod("GET");
  r->SetFlags(UR_FLAG_DISABLE_CACHE);
  g_download.request = CefURLRequest::Create(r, new DownloadClient(*m), IsolatedContext());
  return State();
}

CefRefPtr<CefDictionaryValue> CancelDownload() {
  if (g_download.request) {
    g_download.state = "idle";
    g_download.request->Cancel();
  }
  return State();
}

CefRefPtr<CefDictionaryValue> RemoveModel(const std::string& model_id) {
  const Model* m = FindModel(model_id);
  if (m) {
    if (g_engine.model == m->id) StopEngine();
    unlink(ModelPath(*m).c_str());
  }
  return State();
}

CefRefPtr<CefDictionaryValue> SelectModel(const std::string& model_id) {
  const Model* m = FindModel(model_id);
  if (m && Readable(ModelPath(*m))) WriteFileAtomic(SelectionPath(), m->id);
  return State();
}

void Chat(CefRefPtr<CefListValue> messages, int max_tokens, const std::string& json_schema,
          CefRefPtr<Sink> sink) {
  const std::string model = Selected();
  if (model.empty()) {
    sink->OnDone("No AI model is installed yet. Open tobari://ai to download one.");
    return;
  }
  EnsureEngine(model, base::BindOnce(
      [](CefRefPtr<CefListValue> messages, int max_tokens, std::string schema, CefRefPtr<Sink> sink) {
        if (!g_engine.ready) {
          sink->OnDone(g_engine.error.empty() ? "the AI engine is not running" : g_engine.error);
          return;
        }
        const bool stream = schema.empty();
        CefRefPtr<CefDictionaryValue> body = CefDictionaryValue::Create();
        body->SetList("messages", messages);
        body->SetBool("stream", stream);
        body->SetInt("max_tokens", max_tokens);
        body->SetDouble("temperature", 0.3);
        CefRefPtr<CefDictionaryValue> kwargs = CefDictionaryValue::Create();
        kwargs->SetBool("enable_thinking", false);
        body->SetDictionary("chat_template_kwargs", kwargs);
        if (!schema.empty()) {
          CefRefPtr<CefValue> parsed = CefParseJSON(schema, JSON_PARSER_RFC);
          if (parsed && parsed->GetType() == VTYPE_DICTIONARY) {
            CefRefPtr<CefDictionaryValue> fmt = CefDictionaryValue::Create();
            fmt->SetString("type", "json_schema");
            CefRefPtr<CefDictionaryValue> js = CefDictionaryValue::Create();
            js->SetString("name", "result");
            js->SetDictionary("schema", parsed->GetDictionary());
            fmt->SetDictionary("json_schema", js);
            body->SetDictionary("response_format", fmt);
          }
        }
        CefRefPtr<CefValue> v = CefValue::Create();
        v->SetDictionary(body);
        const std::string json = CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();

        CefRefPtr<CefRequest> r = CefRequest::Create();
        r->SetURL("http://127.0.0.1:" + std::to_string(g_engine.port) + "/v1/chat/completions");
        r->SetMethod("POST");
        CefRequest::HeaderMap headers;
        headers.insert({"Authorization", "Bearer " + g_engine.key});
        headers.insert({"Content-Type", "application/json"});
        r->SetHeaderMap(headers);
        CefRefPtr<CefPostData> post = CefPostData::Create();
        CefRefPtr<CefPostDataElement> element = CefPostDataElement::Create();
        element->SetToBytes(json.size(), json.data());
        post->AddElement(element);
        r->SetPostData(post);
        r->SetFlags(UR_FLAG_DISABLE_CACHE);
        CefURLRequest::Create(r, new ChatClient(sink, stream), IsolatedContext());
      },
      messages, max_tokens, json_schema, sink));
}

void Shutdown() { StopEngine(); }

}  // namespace ai
}  // namespace tobari
