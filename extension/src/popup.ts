import { core } from "./lib/core";
import { $, MenuItem, setIcon, showMenu } from "./lib/ui";
import { applyClusters, clusterByHeuristic, discardIdleTabs, hostOf, listWorkspaces, switchWorkspace } from "./lib/tabs";

setIcon($("#lead"), "search");
const q = $<HTMLInputElement>("#q");
const results = $("#results");
let ctl: ReturnType<typeof showMenu> | null = null;
let skills: { name: string; description: string }[] = [];
core("skills.list").then((r) => (skills = r.skills)).catch(() => {});

async function openPanelWith(ask: string, skill?: string) {
  const win = await chrome.windows.getCurrent();
  await chrome.storage.session.set({ pendingAsk: ask, pendingSkill: skill ?? null });
  if (win.id !== undefined) await chrome.sidePanel.open({ windowId: win.id });
  window.close();
}

async function splitWith(tab: chrome.tabs.Tab) {
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const win = await chrome.windows.getCurrent();
  const w = win.width ?? screen.availWidth;
  const left = win.left ?? 0;
  const top = win.top ?? 0;
  const height = win.height ?? screen.availHeight;
  await chrome.windows.update(win.id!, { state: "normal", left, top, width: Math.floor(w / 2), height });
  await chrome.windows.create({ tabId: tab.id, left: left + Math.floor(w / 2), top, width: Math.ceil(w / 2), height, focused: true });
  if (active?.id) chrome.tabs.update(active.id, { active: true });
  window.close();
}

async function build(text: string): Promise<MenuItem[]> {
  const t = text.trim();
  const lower = t.toLowerCase();
  const items: MenuItem[] = [];
  if (t.startsWith("/")) {
    const s = lower.slice(1);
    for (const k of skills.filter((k) => k.name.includes(s) || k.description.toLowerCase().includes(s))) {
      items.push({ group: "Skills", label: `/${k.name}`, hint: k.description, icon: "slash", run: () => openPanelWith(`Run /${k.name}.`, k.name) });
    }
    return items;
  }
  if (t.startsWith("?")) {
    return [{ group: "Ask", label: t.slice(1).trim() || "Ask Tobari…", icon: "spark", run: () => openPanelWith(t.slice(1).trim()) }];
  }
  const tabs = await chrome.tabs.query({});
  const tabHits = tabs.filter((x) => /^(https?|file):/.test(x.url ?? "")).filter((x) => !lower || `${x.title} ${x.url}`.toLowerCase().includes(lower)).slice(0, lower ? 8 : 5);
  for (const x of tabHits) {
    items.push({ group: "Switch to tab", label: x.title || x.url || "Tab", hint: hostOf(x.url), img: x.favIconUrl, icon: "globe", run: async () => { await chrome.tabs.update(x.id!, { active: true }); await chrome.windows.update(x.windowId, { focused: true }); window.close(); } });
  }
  const commands: MenuItem[] = [
    { label: "Ask Tobari about this page", icon: "spark", run: () => openPanelWith("Summarize this page.", "summarize-page") },
    { label: "Group tabs by site", icon: "wand", run: async () => { const w = await chrome.windows.getCurrent(); await applyClusters(clusterByHeuristic(await chrome.tabs.query({ windowId: w.id }))); window.close(); } },
    { label: "Group tabs by task (AI)", icon: "spark", run: () => openPanelWith("Group my open tabs by task.", "cluster-tabs") },
    { label: "Put idle tabs to sleep", icon: "sleep", run: async () => { await discardIdleTabs(0); window.close(); } },
    { label: "Open Tobari panel", icon: "tabs", hint: "Alt J", run: async () => { const w = await chrome.windows.getCurrent(); await chrome.sidePanel.open({ windowId: w.id! }); window.close(); } },
    { label: "Import from Chrome, Brave or Firefox", icon: "download", run: () => { chrome.tabs.create({ url: chrome.runtime.getURL("settings.html#import") }); window.close(); } },
    { label: "Settings", icon: "gear", run: () => { chrome.runtime.openOptionsPage(); window.close(); } },
  ];
  const { list, current } = await listWorkspaces();
  for (const w of list.filter((w) => w.id !== current)) {
    commands.push({ label: `Switch to workspace: ${w.name}`, icon: "layers", run: async () => { const win = await chrome.windows.getCurrent(); await switchWorkspace(w.id, win.id!); window.close(); } });
  }
  for (const x of tabs.filter((x) => !x.active && /^https?:/.test(x.url ?? "")).slice(0, 4)) {
    commands.push({ label: `Split view with: ${x.title}`, icon: "split", run: () => splitWith(x) });
  }
  items.push(...commands.filter((c) => !lower || c.label.toLowerCase().includes(lower)).map((c) => ({ ...c, group: "Commands" })));
  if (t) {
    const isUrl = /^[a-z][a-z0-9+.-]*:\/\//i.test(t) || (/^[\w-]+(\.[\w-]+)+(\/\S*)?$/.test(t) && !/\s/.test(t));
    const { settings } = (await chrome.storage.local.get("settings") as Record<string, any>);
    const engine: string = settings?.searchEngine ?? "https://duckduckgo.com/?q=%s";
    items.push({ group: "Go", label: isUrl ? `Open ${t}` : `Search the web for “${t}”`, icon: isUrl ? "globe" : "search", run: () => { chrome.tabs.create({ url: isUrl ? (t.includes("://") ? t : `https://${t}`) : engine.replace("%s", encodeURIComponent(t)) }); window.close(); } });
    items.push({ group: "Go", label: `Ask Tobari: “${t}”`, icon: "spark", run: () => openPanelWith(t) });
  }
  return items;
}

async function refresh() {
  ctl = showMenu(results, await build(q.value));
  results.hidden = false;
}

q.addEventListener("input", refresh);
q.addEventListener("keydown", (e) => {
  if (!ctl) return;
  if (e.key === "ArrowDown") { e.preventDefault(); ctl.move(1); }
  if (e.key === "ArrowUp") { e.preventDefault(); ctl.move(-1); }
  if (e.key === "Enter") { e.preventDefault(); ctl.pick(); }
});
refresh();
