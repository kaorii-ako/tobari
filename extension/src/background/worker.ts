import { chat, getStatus } from "./native.js";

chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "tobari-explain",
    title: "Explain with Tobari",
    contexts: ["selection"]
  });
  chrome.contextMenus.create({
    id: "tobari-summarize",
    title: "Summarize this page with Tobari",
    contexts: ["page"]
  });
  chrome.contextMenus.create({
    id: "tobari-translate",
    title: "Translate selection with Tobari",
    contexts: ["selection"]
  });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "tobari-explain" && info.selectionText) {
    await openPanel();
    const reply = await ask(`Explain this text in plain language:\n\n${info.selectionText}`);
    void reply;
  }
  if (info.menuItemId === "tobari-translate" && info.selectionText) {
    await openPanel();
    await ask(`Translate this text to English. Return only the translation:\n\n${info.selectionText}`);
  }
  if (info.menuItemId === "tobari-summarize" && tab?.id) {
    await openPanel();
    const page = await extractPage(tab.id);
    await ask(`Summarize this page in five bullets or fewer:\n\n${page.slice(0, 12000)}`);
  }
});

chrome.action.onClicked.addListener(async () => {
  await openPanel();
});

async function openPanel(): Promise<void> {
  const win = await chrome.windows.getCurrent();
  if (win.id !== undefined) {
    await chrome.sidePanel.open({ windowId: win.id });
  }
}

async function extractPage(tabId: number): Promise<string> {
  const res = await chrome.scripting.executeScript({
    target: { tabId },
    func: () => document.documentElement.innerText.slice(0, 20000)
  });
  const first = res[0];
  if (first && typeof first.result === "string") return first.result;
  return "";
}

async function ask(prompt: string): Promise<string> {
  const status = await getStatus();
  if (status.type !== "status" || !status.healthy) {
    throw new Error("tobari-core is not healthy");
  }
  let full = "";
  chat([{ role: "user", content: prompt }], (chunk, done) => {
    full += chunk;
    if (done) chrome.runtime.sendMessage({ kind: "tobari-answer", text: full }).catch(() => {});
  });
  return full;
}
