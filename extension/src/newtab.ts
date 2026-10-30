import { core } from "./lib/core";
import { $, favicon, h, setIcon } from "./lib/ui";
import { listWorkspaces, switchWorkspace } from "./lib/tabs";

type Mode = "search" | "ask";
let mode: Mode = "search";
const q = $<HTMLInputElement>("#q");

function setMode(m: Mode) {
  mode = m;
  document.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) => b.classList.toggle("on", b.dataset.mode === m));
  setIcon($("#lead"), m === "ask" ? "spark" : "search");
  q.placeholder = m === "ask" ? "Ask Tobari anything" : "Search or type a URL";
  q.focus();
}
document.querySelectorAll<HTMLButtonElement>(".mode").forEach((b) => (b.onclick = () => setMode(b.dataset.mode as Mode)));
q.addEventListener("keydown", (e) => {
  if (e.key === "Tab") {
    e.preventDefault();
    setMode(mode === "search" ? "ask" : "search");
  }
});
setMode("search");

export function toUrl(text: string, engine: string): string {
  const t = text.trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return t;
  if (/^(localhost|[\w-]+(\.[\w-]+)+)(:\d+)?(\/\S*)?$/i.test(t) && !/\s/.test(t)) return `https://${t}`;
  return engine.replace("%s", encodeURIComponent(t));
}

$("#bar").addEventListener("submit", async (e) => {
  e.preventDefault();
  const text = q.value.trim();
  if (!text) return;
  if (mode === "ask") {
    const tab = await chrome.tabs.getCurrent();
    await chrome.storage.session.set({ pendingAsk: text });
    if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
    q.value = "";
    return;
  }
  const { settings } = (await chrome.storage.local.get("settings") as Record<string, any>);
  location.href = toUrl(text, settings?.searchEngine ?? "https://duckduckgo.com/?q=%s");
});

chrome.topSites.get().then((sites) => {
  const box = $("#tiles");
  for (const s of sites.slice(0, 8)) {
    let host = s.url;
    try {
      host = new URL(s.url).hostname.replace(/^www\./, "");
    } catch {}
    const fav = `chrome-extension://${chrome.runtime.id}/_favicon/?pageUrl=${encodeURIComponent(s.url)}&size=32`;
    box.append(h("a", { class: "tile", href: s.url, title: s.title }, h("span", { class: "ic" }, favicon(fav)), h("span", {}, s.title || host)));
  }
});

listWorkspaces().then(({ list, current }) => {
  const box = $("#ws");
  for (const w of list) {
    const row = h("div", { class: "line" }, h("span", { class: "sw", style: `background:${w.color}` }), h("span", { class: "t" }, w.name), h("span", { class: "n" }, w.id === current ? "open" : `${w.tabs.length} tabs`));
    row.onclick = async () => {
      const win = await chrome.windows.getCurrent();
      if (win.id !== undefined) await switchWorkspace(w.id, win.id);
    };
    box.append(row);
  }
});

core("memory.list")
  .then((notes: { name: string; modified: number }[]) => {
    if (!notes.length) return;
    const box = $("#mem");
    box.innerHTML = "";
    for (const n of notes.slice(0, 5)) {
      const row = h("div", { class: "line", title: "Open in the panel" }, h("span", { class: "t" }, n.name), h("span", { class: "n" }, new Date(n.modified * 1000).toLocaleDateString()));
      row.onclick = async () => {
        const tab = await chrome.tabs.getCurrent();
        await chrome.storage.session.set({ pendingAsk: `What did I save in my note "${n.name}"?`, pendingMemory: n.name });
        if (tab?.windowId !== undefined) await chrome.sidePanel.open({ windowId: tab.windowId });
      };
      box.append(row);
    }
  })
  .catch(() => {});
