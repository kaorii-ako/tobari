// Assistant backend: chat with any OpenAI-compatible server. Local (Ollama, llama.cpp, LM Studio) or a provider
// with the user's own key. Tobari starts no process and holds no model; nothing runs until a message is sent.
#pragma once
#include <functional>
#include <string>

#include "include/cef_values.h"

// {url, model, hasKey, local} for the UI. The key itself never goes back to a page.
CefRefPtr<CefDictionaryValue> AiConfig();
// Saves the endpoint. Returns an error for a URL that would send prompts or the key in the clear. key==nullptr
// keeps the stored key; "" removes it.
std::string AiSetConfig(const std::string& url, const std::string& model, const std::string* key);
// Streams one reply to messages ([{role, content}]). on_text gets each piece; on_done gets "" or an error.
// UI thread. Starting a chat cancels the one before.
void AiChat(CefRefPtr<CefListValue> messages, std::function<void(const std::string&)> on_text,
            std::function<void(const std::string&)> on_done);
void AiStop();
// The server's model ids (GET url/models), or an empty list.
void AiModels(std::function<void(CefRefPtr<CefListValue>)> done);
