import { chat, getStatus } from "../background/native.js";

const log = document.getElementById("log") as HTMLElement;
const form = document.getElementById("form") as HTMLFormElement;
const input = document.getElementById("input") as HTMLTextAreaElement;
const statusEl = document.getElementById("status") as HTMLElement;

function add(role: string, text: string): HTMLElement {
  const div = document.createElement("div");
  div.className = `msg ${role}`;
  div.textContent = text;
  log.appendChild(div);
  log.scrollTop = log.scrollHeight;
  return div;
}

async function refreshStatus(): Promise<void> {
  try {
    const s = await getStatus();
    if (s.type === "status") {
      statusEl.textContent = `${s.backend} · ${s.model} · ${s.healthy ? "ready" : "starting"}`;
    }
  } catch {
    statusEl.textContent = "sidecar unreachable";
  }
}

function currentStream(): HTMLElement {
  return add("model", "");
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  const text = input.value.trim();
  if (!text) return;
  input.value = "";
  add("user", text);
  const bubble = currentStream();
  chat([{ role: "user", content: text }], (chunk, done) => {
    if (!done) bubble.textContent += chunk;
  });
});

document.getElementById("page")?.addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) return;
  const res = await chrome.scripting.executeScript({
    target: { tabId: tab.id },
    func: () => document.documentElement.innerText.slice(0, 12000)
  });
  const text = res[0]?.result;
  if (typeof text === "string" && text.length > 0) {
    input.value = `Here is the page text. My question follows after ---.\n\n${text}\n\n---\n`;
    input.focus();
  }
});

document.getElementById("sum")?.addEventListener("click", () => {
  input.value = "Summarize this page in five bullets or fewer. Page text follows after ---.\n\n";
  document.getElementById("page")?.dispatchEvent(new Event("click"));
});

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.kind === "tobari-answer" && typeof msg.text === "string") {
    add("model", msg.text);
  }
});

void refreshStatus();
setInterval(() => void refreshStatus(), 10000);
