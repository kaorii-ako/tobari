#include "ai.h"

#include <cstring>
#include <fstream>
#include <sstream>

#include "block.h"
#include "include/cef_task.h"
#include "include/cef_parser.h"
#include "include/cef_urlrequest.h"
#include "util.h"

namespace {

struct Config {
  std::string url = "http://127.0.0.1:11434/v1", model, key;  // Ollama's default port
};

std::string ConfigPath() { return DataDir() + "/ai.json"; }

Config Load() {
  Config c;
  std::ifstream f(ConfigPath());
  std::stringstream ss;
  ss << f.rdbuf();
  auto v = CefParseJSON(ss.str(), JSON_PARSER_RFC);
  if (!v || v->GetType() != VTYPE_DICTIONARY) return c;
  auto d = v->GetDictionary();
  if (d->HasKey("url")) c.url = d->GetString("url");
  c.model = d->GetString("model");
  c.key = d->GetString("key");
  return c;
}

bool IsLocal(const std::string& url) {
  for (const char* p : {"http://127.0.0.1", "http://localhost", "http://[::1]"})
    if (url.rfind(p, 0) == 0 && (url.size() == strlen(p) || strchr(":/", url[strlen(p)]))) return true;
  return false;
}

// Collects a response; for a stream it hands each piece of text on as it arrives.
class Call : public CefURLRequestClient {
 public:
  Call(bool stream, std::function<void(const std::string&)> on_text,
       std::function<void(int, const std::string&, const std::string&)> on_done)
      : stream_(stream), on_text_(std::move(on_text)), on_done_(std::move(on_done)) {}
  void OnRequestComplete(CefRefPtr<CefURLRequest> r) override {
    auto res = r->GetResponse();
    int status = res ? res->GetStatus() : 0;
    std::string err;
    if (r->GetRequestStatus() == UR_CANCELED) err = "Stopped.";
    else if (r->GetRequestStatus() != UR_SUCCESS) err = "Can't reach the model server.";
    on_done_(status, err, body_);
  }
  void OnDownloadData(CefRefPtr<CefURLRequest> r, const void* data, size_t n) override {
    auto res = r->GetResponse();
    if (!stream_ || !res || res->GetStatus() != 200) {
      if (body_.size() < (4 << 20)) body_.append(static_cast<const char*>(data), n);
      return;
    }
    buf_.append(static_cast<const char*>(data), n);
    bool done = false;
    for (auto& t : SseDeltas(buf_, done)) on_text_(t);
  }
  void OnUploadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  void OnDownloadProgress(CefRefPtr<CefURLRequest>, int64_t, int64_t) override {}
  bool GetAuthCredentials(bool, const CefString&, int, const CefString&, const CefString&,
                          CefRefPtr<CefAuthCallback>) override {
    return false;
  }

 private:
  bool stream_;
  std::string buf_, body_;
  std::function<void(const std::string&)> on_text_;
  std::function<void(int, const std::string&, const std::string&)> on_done_;
  IMPLEMENT_REFCOUNTING(Call);
};

CefRefPtr<CefURLRequest> g_chat, g_models;
int g_gen = 0;

CefRefPtr<CefRequest> Request(const Config& c, const std::string& path) {
  auto req = CefRequest::Create();
  req->SetURL(c.url + path);
  CefRequest::HeaderMap h;
  if (!c.key.empty()) h.insert({"Authorization", "Bearer " + c.key});
  req->SetHeaderMap(h);
  // No cookies either way: the request carries only what the user typed and the key.
  req->SetFlags(UR_FLAG_DISABLE_CACHE | UR_FLAG_SKIP_CACHE);
  return req;
}

// The server's error message from an OpenAI-style {"error": {"message": ...}} body, or the HTTP status.
std::string ErrorText(int status, const std::string& body) {
  auto v = CefParseJSON(body, JSON_PARSER_RFC);
  if (v && v->GetType() == VTYPE_DICTIONARY) {
    auto e = v->GetDictionary()->GetValue("error");
    if (e && e->GetType() == VTYPE_DICTIONARY) return e->GetDictionary()->GetString("message");
    if (e && e->GetType() == VTYPE_STRING) return e->GetString();
  }
  return "The model server answered " + std::to_string(status) + ".";
}

}  // namespace

CefRefPtr<CefDictionaryValue> AiConfig() {
  Config c = Load();
  auto d = CefDictionaryValue::Create();
  d->SetString("url", c.url);
  d->SetString("model", c.model);
  d->SetBool("hasKey", !c.key.empty());
  d->SetBool("local", IsLocal(c.url));
  d->SetString("host", UrlHost(c.url).empty() ? "this device" : UrlHost(c.url));
  return d;
}

std::string AiSetConfig(const std::string& url_in, const std::string& model, const std::string* key) {
  std::string url = url_in;
  while (!url.empty() && url.back() == '/') url.pop_back();
  if (!IsLocal(url) && (url.rfind("https://", 0) != 0 || UrlHost(url).empty()))
    return "Use an https:// address, or http:// only for this computer (127.0.0.1 or localhost).";
  Config c = Load();
  c.url = url;
  c.model = model;
  if (key) c.key = *key;
  auto d = CefDictionaryValue::Create();
  d->SetString("url", c.url);
  d->SetString("model", c.model);
  d->SetString("key", c.key);
  auto v = CefValue::Create();
  v->SetDictionary(d);
  // shortcut: the key is stored in plain text, readable only by this user (0600) like ~/.ssh keys; move it to
  // the Secret Service (libsecret) when other secrets need encrypting at rest too.
  WriteFile(ConfigPath(), CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString());
  return "";
}

void AiChat(CefRefPtr<CefListValue> messages, std::function<void(const std::string&)> on_text,
            std::function<void(const std::string&)> on_done) {
  AiStop();
  Config c = Load();
  if (c.model.empty()) return on_done("Choose a model first.");
  auto body = CefDictionaryValue::Create();
  body->SetString("model", c.model);
  body->SetBool("stream", true);
  body->SetList("messages", messages);
  auto v = CefValue::Create();
  v->SetDictionary(body);
  auto req = Request(c, "/chat/completions");
  req->SetMethod("POST");
  auto h = CefRequest::HeaderMap();
  req->GetHeaderMap(h);
  h.insert({"Content-Type", "application/json"});
  req->SetHeaderMap(h);
  auto post = CefPostData::Create();
  auto el = CefPostDataElement::Create();
  std::string json = CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();
  el->SetToBytes(json.size(), json.data());
  post->AddElement(el);
  req->SetPostData(post);
  // A cancelled chat can still call back after the next one starts; only the current one may speak.
  int gen = ++g_gen;
  auto text = [gen, on_text](const std::string& t) { if (gen == g_gen) on_text(t); };
  g_chat = CefURLRequest::Create(req, new Call(true, text, [gen, on_done](int status, const std::string& err,
                                                                          const std::string& body) {
    if (gen != g_gen) return;
    g_chat = nullptr;
    on_done(!err.empty() ? err : status == 200 ? "" : ErrorText(status, body));
  }), nullptr);
}

void AiStop() {
  ++g_gen;
  if (g_chat) g_chat->Cancel();
  g_chat = nullptr;
}

void AiModels(std::function<void(CefRefPtr<CefListValue>)> done) {
  auto req = Request(Load(), "/models");
  req->SetMethod("GET");
  g_models = CefURLRequest::Create(req, new Call(false, nullptr, [done](int status, const std::string&,
                                                                        const std::string& body) {
    g_models = nullptr;
    auto ids = CefListValue::Create();
    auto v = CefParseJSON(body, JSON_PARSER_RFC);
    if (status == 200 && v && v->GetType() == VTYPE_DICTIONARY) {
      auto data = v->GetDictionary()->GetList("data");
      for (size_t i = 0; data && i < data->GetSize(); ++i)
        ids->SetString(ids->GetSize(), data->GetDictionary(i)->GetString("id"));
    }
    done(ids);
  }), nullptr);
}
