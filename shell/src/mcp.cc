#include "mcp.h"

#include <map>
#include <memory>

#include "include/cef_browser.h"
#include "include/cef_devtools_message_observer.h"
#include "include/cef_parser.h"
#include "shell.h"

namespace {

using Done = std::function<void(bool, const std::string&)>;
using Dict = CefRefPtr<CefDictionaryValue>;

std::string Write(Dict d) {
  auto v = CefValue::Create();
  v->SetDictionary(d);
  return CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();
}

std::string Quote(const std::string& s) {
  auto v = CefValue::Create();
  v->SetString(s);
  return CefWriteJSON(v, JSON_WRITER_DEFAULT).ToString();
}

// One DevTools call; deletes itself once the answer arrives.
class Call : public CefDevToolsMessageObserver {
 public:
  Call(std::function<void(bool, Dict)> f) : f_(std::move(f)) {}
  void OnDevToolsMethodResult(CefRefPtr<CefBrowser>, int id, bool ok, const void* data, size_t size) override {
    if (id != id_) return;
    auto v = CefParseJSON(data, size, JSON_PARSER_RFC);
    auto f = std::move(f_);
    reg_ = nullptr;  // may drop the last reference to this, so f is already moved out
    f(ok, v && v->GetType() == VTYPE_DICTIONARY ? v->GetDictionary() : CefDictionaryValue::Create());
  }
  int id_ = 0;
  CefRefPtr<CefRegistration> reg_;

 private:
  std::function<void(bool, Dict)> f_;
  IMPLEMENT_REFCOUNTING(Call);
};

int next_id = 1;

void DevTools(CefRefPtr<CefBrowser> b, const std::string& method, Dict params, std::function<void(bool, Dict)> f) {
  CefRefPtr<Call> c = new Call(std::move(f));
  c->reg_ = b->GetHost()->AddDevToolsMessageObserver(c);
  c->id_ = next_id++;
  b->GetHost()->ExecuteDevToolsMethod(c->id_, method, params);
}

void Eval(CefRefPtr<CefBrowser> b, const std::string& js, std::function<void(bool, std::string)> f) {
  auto p = CefDictionaryValue::Create();
  p->SetString("expression", js);
  p->SetBool("returnByValue", true);
  DevTools(b, "Runtime.evaluate", p, [f](bool ok, Dict r) {
    if (!ok || r->HasKey("exceptionDetails")) return f(false, "The page refused: " + (r->HasKey("exceptionDetails") ? std::string("script error") : std::string("no result")));
    auto res = r->GetDictionary("result");
    f(true, res && res->GetType("value") == VTYPE_STRING ? res->GetString("value").ToString() : "");
  });
}

// An MCP tool result: text, or a PNG.
std::string Result(CefRefPtr<CefValue> id, bool ok, const std::string& text, bool image = false) {
  auto item = CefDictionaryValue::Create();
  item->SetString("type", image ? "image" : "text");
  item->SetString(image ? "data" : "text", text);
  if (image) item->SetString("mimeType", "image/png");
  auto content = CefListValue::Create();
  content->SetDictionary(0, item);
  auto res = CefDictionaryValue::Create();
  res->SetList("content", content);
  res->SetBool("isError", !ok);
  auto r = CefDictionaryValue::Create();
  r->SetString("jsonrpc", "2.0");
  r->SetValue("id", id);
  r->SetDictionary("result", res);
  return Write(r);
}

const char kTools[] = R"([
{"name":"tobari_tabs","description":"List open tabs (id, url, title).","inputSchema":{"type":"object","properties":{}}},
{"name":"tobari_open","description":"Open an http(s) URL in a new tab; returns the tab id.","inputSchema":{"type":"object","properties":{"url":{"type":"string"}},"required":["url"]}},
{"name":"tobari_close","description":"Close a tab.","inputSchema":{"type":"object","properties":{"tab":{"type":"integer"}},"required":["tab"]}},
{"name":"tobari_read","description":"Visible text of a tab (default: the current tab).","inputSchema":{"type":"object","properties":{"tab":{"type":"integer"}}}},
{"name":"tobari_click","description":"Click the first element matching a CSS selector.","inputSchema":{"type":"object","properties":{"selector":{"type":"string"},"tab":{"type":"integer"}},"required":["selector"]}},
{"name":"tobari_fill","description":"Type text into the first input matching a CSS selector.","inputSchema":{"type":"object","properties":{"selector":{"type":"string"},"text":{"type":"string"},"tab":{"type":"integer"}},"required":["selector","text"]}},
{"name":"tobari_screenshot","description":"PNG screenshot of a tab's page.","inputSchema":{"type":"object","properties":{"tab":{"type":"integer"}}}}
])";

void Tool(CefRefPtr<CefValue> id, const std::string& name, Dict a, Done done) {
  auto reply = [id, done](bool ok, const std::string& t) { done(true, Result(id, ok, t)); };
  int tab = a->GetType("tab") == VTYPE_INT ? a->GetInt("tab") : 0;
  std::string sel = a->GetString("selector"), text = a->GetString("text");
  Shell* s = Shell::Get();
  // These reuse the CLI commands.
  auto ctl = [&](const char* cmd, const std::string& arg) { s->Ctl(cmd, arg, reply); };
  if (name == "tobari_tabs") return ctl("tabs", "");
  if (name == "tobari_open") return ctl("open", a->GetString("url"));
  if (name == "tobari_close") return ctl("close", std::to_string(tab));
  if (name == "tobari_read") return ctl("text", tab ? std::to_string(tab) : "");
  auto b = s->AgentTab(tab, name.substr(7) + " " + sel);
  if (!b) return reply(false, "No such web page tab, or it is asleep or a built-in page.");
  if (name == "tobari_screenshot") {
    auto p = CefDictionaryValue::Create();
    p->SetString("format", "png");
    return DevTools(b, "Page.captureScreenshot", p, [id, done](bool ok, Dict r) {
      done(true, ok ? Result(id, true, r->GetString("data"), true) : Result(id, false, "Screenshot failed."));
    });
  }
  if (sel.empty()) return reply(false, "selector is required.");
  // shortcut: synthetic DOM events, not trusted input; upgrade to Input.dispatchMouseEvent if a site ignores them.
  std::string js =
      "(()=>{const e=document.querySelector(" + Quote(sel) + ");if(!e)return 'No element matches that selector.';e.scrollIntoView({block:'center'});" +
      (name == "tobari_click"
           ? "e.click();return 'clicked';"
           : "e.focus();const d=Object.getOwnPropertyDescriptor(Object.getPrototypeOf(e),'value');d&&d.set?d.set.call(e,"+ Quote(text) +
                 "):(e.value=" + Quote(text) + ");e.dispatchEvent(new Event('input',{bubbles:true}));e.dispatchEvent(new Event('change',{bubbles:true}));return 'filled';") +
      "})()";
  if (name != "tobari_click" && name != "tobari_fill") return reply(false, "Unknown tool.");
  Eval(b, js, [reply](bool ok, std::string r) { reply(ok && (r == "clicked" || r == "filled"), r); });
}

}  // namespace

void Mcp(const std::string& line, Done done) {
  auto v = CefParseJSON(line, JSON_PARSER_RFC);
  if (!v || v->GetType() != VTYPE_DICTIONARY) return done(true, "");
  Dict m = v->GetDictionary();
  std::string method = m->GetString("method");
  auto id = m->HasKey("id") ? m->GetValue("id")->Copy() : nullptr;
  if (!id) return done(true, "");  // a notification
  auto r = CefDictionaryValue::Create();
  r->SetString("jsonrpc", "2.0");
  r->SetValue("id", id);
  if (method == "tools/call") {
    Dict p = m->GetDictionary("params");
    if (!p) return done(true, "");
    Dict a = p->GetDictionary("arguments");
    return Tool(id, p->GetString("name"), a ? a : CefDictionaryValue::Create(), done);
  }
  auto res = CefDictionaryValue::Create();
  if (method == "initialize") {
    Dict p = m->GetDictionary("params");
    res->SetString("protocolVersion", p && p->HasKey("protocolVersion") ? p->GetString("protocolVersion") : "2024-11-05");
    auto caps = CefDictionaryValue::Create();
    caps->SetDictionary("tools", CefDictionaryValue::Create());
    res->SetDictionary("capabilities", caps);
    auto info = CefDictionaryValue::Create();
    info->SetString("name", "tobari");
    info->SetString("version", "0.6.0");
    res->SetDictionary("serverInfo", info);
  } else if (method == "tools/list") {
    res->SetList("tools", CefParseJSON(kTools, JSON_PARSER_RFC)->GetList());
  } else if (method != "ping") {
    auto e = CefDictionaryValue::Create();
    e->SetInt("code", -32601);
    e->SetString("message", "Method not found");
    r->SetDictionary("error", e);
    return done(true, Write(r));
  }
  r->SetDictionary("result", res);
  done(true, Write(r));
}
