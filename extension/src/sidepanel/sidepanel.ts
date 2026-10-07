import { chat, getStatus, installDeps } from "../background/native.js";
import { parseCookies } from "./cookies.js";

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
    if (s.type === "status" && s.missing?.length) {
      showSetup(s.missing);
      statusEl.textContent = "setup needed";
      return;
    }
    if (s.type === "status") {
      setupEl.hidden = true;
      statusEl.textContent = `${s.backend} · ${s.model} · ${s.healthy ? "ready" : "starting"}`;
    }
  } catch {
    statusEl.textContent = "sidecar unreachable";
  }
}

const setupEl = document.getElementById("setup") as HTMLElement;
const setupText = document.getElementById("setup-text") as HTMLElement;
const setupGo = document.getElementById("setup-go") as HTMLButtonElement;
let installing = false;

function showSetup(missing: string[]): void {
  if (installing) return;
  setupText.textContent = `Tobari needs to download: ${missing.join(", ")}. Install now?`;
  setupEl.hidden = false;
}

setupGo.addEventListener("click", async () => {
  installing = true;
  setupGo.disabled = true;
  setupText.textContent = "Downloading… this can take a while.";
  try {
    await installDeps();
    setupEl.hidden = true;
  } catch (e) {
    setupText.textContent = `Install failed: ${(e as Error).message}`;
  } finally {
    installing = false;
    setupGo.disabled = false;
    void refreshStatus();
  }
});

const cookieFile = document.getElementById("cookie-file") as HTMLInputElement;

document.getElementById("import-cookies")?.addEventListener("click", async () => {
  // Ask for site access only when importing; Tobari holds none otherwise.
  const ok = await chrome.permissions.request({ permissions: ["cookies"], origins: ["<all_urls>"] });
  if (ok) cookieFile.click();
});

cookieFile.addEventListener("change", async () => {
  const file = cookieFile.files?.[0];
  cookieFile.value = "";
  if (!file) return;
  let cookies;
  try {
    cookies = parseCookies(await file.text());
  } catch (e) {
    add("model", `Could not read ${file.name}: ${(e as Error).message}`);
    return;
  }
  let done = 0;
  for (const c of cookies) {
    try {
      if (await chrome.cookies.set(c)) done++;
    } catch {
      // skip cookies Chrome rejects (expired, bad domain)
    }
  }
  add("model", `Imported ${done} of ${cookies.length} cookies from ${file.name}.`);
});

document.getElementById("import-browser")?.addEventListener("click", () => {
  // Chrome's own importer covers bookmarks, history, passwords, autofill.
  void chrome.tabs.create({ url: "chrome://settings/importData" });
});

const autogroup = document.getElementById("autogroup") as HTMLInputElement;
chrome.storage.local.get({ autogroup: true }).then((v) => (autogroup.checked = v.autogroup));
autogroup.addEventListener("change", () => void chrome.storage.local.set({ autogroup: autogroup.checked }));

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
