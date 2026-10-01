import { api } from "./api.js";

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  if (msg?.target !== "tobari-bridge") return false;
  api(msg.path, msg.body).then(reply);
  return true;
});
