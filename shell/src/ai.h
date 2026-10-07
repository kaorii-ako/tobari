#pragma once

#include <string>

#include "include/cef_base.h"
#include "include/cef_values.h"

namespace tobari {
namespace ai {

// Tobari's local AI: a llama.cpp server started on demand on this computer,
// with a model the user chose and downloaded in tobari://ai. Nothing is sent
// anywhere: the server listens only on 127.0.0.1, on a random port, behind a
// random key, and is stopped after ten idle minutes and when Tobari quits.
// The only network traffic is the model download the user starts, from
// Hugging Face, checked against a pinned SHA-256.
//
// All functions run on the UI thread unless noted.

// Models offered, what is installed and selected, download and engine state.
CefRefPtr<CefDictionaryValue> State();

CefRefPtr<CefDictionaryValue> StartDownload(const std::string& model_id);
CefRefPtr<CefDictionaryValue> CancelDownload();
CefRefPtr<CefDictionaryValue> RemoveModel(const std::string& model_id);
CefRefPtr<CefDictionaryValue> SelectModel(const std::string& model_id);

// Receives a reply as it is generated. Called on the UI thread.
class Sink : public virtual CefBaseRefCounted {
 public:
  virtual void OnText(const std::string& text) = 0;
  // |error| is empty on success.
  virtual void OnDone(const std::string& error) = 0;
};

// Runs a chat completion. |messages| is an OpenAI-style list of
// {role, content}. With a non-empty |json_schema| the reply is constrained to
// that schema.
void Chat(CefRefPtr<CefListValue> messages, int max_tokens, const std::string& json_schema,
          CefRefPtr<Sink> sink);

// Stops the engine. Called when Tobari quits.
void Shutdown();

}  // namespace ai
}  // namespace tobari
