import { clusterByHeuristic, applyClusters, discardIdleTabs } from "./lib/tabs";

const HOST = "dev.tobari.core";

type Route = { ui: chrome.runtime.Port; uiId: number };

let native: chrome.runtime.Port | null = null;
let nseq = 0;
const routes = new Map<string, Route>();
const parts = new Map<string, string[]>();
const uiPorts = new Set<chrome.runtime.Port>();

function broadcast(msg: unknown) {
  for (const p of uiPorts) {
    try {
      p.postMessage(msg);
    } catch {}
  }
}

function connectNative(): chrome.runtime.Port {
  if (native) return native;
  const port = chrome.runtime.connectNative(HOST);
  native = port;
  port.onMessage.addListener((raw: any) => {
    let msg = raw;
    if (msg.type === "part") {
      const list = parts.get(msg.id) ?? [];
      list[msg.seq] = msg.data;
      parts.set(msg.id, list);
      if (list.filter((x) => x !== undefined).length < msg.count) return;
      parts.delete(msg.id);
      msg = JSON.parse(list.join(""));
    }
    if (msg.type === "browser") {
      handleBrowserOp(msg.op, msg.args ?? {})
        .then((data) => port.postMessage({ type: "browser_result", id: msg.id, data }))
        .catch((e) => port.postMessage({ type: "browser_result", id: msg.id, data: { error: String(e?.message ?? e) } }));
      return;
    }
    const route = routes.get(msg.id);
    if (!route) return;
    if (msg.type === "result" || msg.type === "error") routes.delete(msg.id);
    try {
      route.ui.postMessage({ ...msg, id: route.uiId });
    } catch {}
  });
  port.onDisconnect.addListener(() => {
    const err = chrome.runtime.lastError?.message ?? "Tobari core stopped";
    native = null;
    for (const [id, r] of routes) {
      routes.delete(id);
      try {
        r.ui.postMessage({ id: r.uiId, type: "error", message: err });
      } catch {}
    }
    broadcast({ type: "event", event: "core-down", message: err });
  });
  return port;
}

chrome.runtime.onConnect.addListener((ui) => {
  if (ui.name !== "core") return;
  uiPorts.add(ui);
  ui.onDisconnect.addListener(() => {
    uiPorts.delete(ui);
    for (const [id, r] of routes) if (r.ui === ui) routes.delete(id);
  });
  ui.onMessage.addListener((msg: any) => {
    const id = `b${++nseq}`;
    routes.set(id, { ui, uiId: msg.id });
    try {
      connectNative().postMessage({ ...msg, id });
    } catch (e: any) {
      routes.delete(id);
      ui.postMessage({ id: msg.id, type: "error", message: String(e?.message ?? e) });
    }
  });
});

async function handleBrowserOp(op: string, args: any): Promise<unknown> {
  if (op === "ping") return "pong";
  if (op === "tabs.list") {
    const tabs = await chrome.tabs.query({});
    return tabs.map((t) => ({ id: t.id, windowId: t.windowId, title: t.title, url: t.url, active: t.active, pinned: t.pinned, discarded: t.discarded, groupId: t.groupId }));
  }
  if (op === "tabs.open") {
    const urls: string[] = (args.urls ?? []).filter((u: string) => /^(https?|file):/i.test(u) || u === "tobari://newtab");
    const opened = [];
    for (const u of urls) {
      const t = await chrome.tabs.create({ url: u === "tobari://newtab" ? undefined : u });
      opened.push(t.id);
    }
    return { opened };
  }
  if (op === "tabs.discard") {
    return { discarded: await discardIdleTabs(Number(args.minutes ?? 0)) };
  }
  if (op === "tabs.focus") {
    const t = await chrome.tabs.update(Number(args.id), { active: true });
    if (t?.windowId) await chrome.windows.update(t.windowId, { focused: true });
    return true;
  }
  throw new Error(`unknown op ${op}`);
}

chrome.runtime.onInstalled.addListener(async () => {
  await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: false }).catch(() => {});
  chrome.contextMenus.create({ id: "ask-selection", title: "Ask Tobari about “%s”", contexts: ["selection"] });
  chrome.contextMenus.create({ id: "ask-page", title: "Ask Tobari about this page", contexts: ["page"] });
  chrome.alarms.create("discard", { periodInMinutes: 1 });
  const { settings } = (await chrome.storage.local.get("settings") as Record<string, any>);
  if (!settings) await chrome.storage.local.set({ settings: { adblock: true, discardMinutes: 30 } });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (!tab?.windowId) return;
  await chrome.sidePanel.open({ windowId: tab.windowId });
  const pendingContext = info.menuItemId === "ask-selection"
    ? { kind: "highlight", text: info.selectionText ?? "", tabId: tab.id, title: tab.title, url: tab.url }
    : { kind: "tab", tabId: tab.id, title: tab.title, url: tab.url };
  await chrome.storage.session.set({ pendingContext });
  broadcast({ type: "event", event: "pending-context" });
});

chrome.commands.onCommand.addListener(async (command, tab) => {
  if (command === "toggle-panel") {
    const w = tab?.windowId ?? (await chrome.windows.getCurrent()).id;
    if (w !== undefined) await chrome.sidePanel.open({ windowId: w });
  }
  if (command === "organize-tabs") {
    const w = (await chrome.windows.getCurrent()).id;
    const tabs = await chrome.tabs.query({ windowId: w });
    await applyClusters(clusterByHeuristic(tabs));
  }
});

chrome.alarms.onAlarm.addListener(async (a) => {
  if (a.name !== "discard") return;
  const { settings } = (await chrome.storage.local.get("settings") as Record<string, any>);
  const minutes = Number(settings?.discardMinutes ?? 30);
  if (minutes > 0) await discardIdleTabs(minutes);
});

chrome.storage.onChanged.addListener(async (changes) => {
  if (changes.settings) {
    const on = (changes.settings.newValue as { adblock?: boolean } | undefined)?.adblock !== false;
    await chrome.declarativeNetRequest.updateEnabledRulesets(on ? { enableRulesetIds: ["trackers"] } : { disableRulesetIds: ["trackers"] });
  }
});

chrome.tabs.onCreated.addListener(() => broadcast({ type: "event", event: "tabs" }));
chrome.tabs.onRemoved.addListener(() => broadcast({ type: "event", event: "tabs" }));
chrome.tabs.onUpdated.addListener((_id, info) => {
  if (info.title || info.status === "complete" || info.favIconUrl || info.discarded !== undefined || info.groupId !== undefined || info.pinned !== undefined) {
    broadcast({ type: "event", event: "tabs" });
  }
});
chrome.tabs.onActivated.addListener(() => broadcast({ type: "event", event: "tabs" }));
chrome.tabs.onMoved.addListener(() => broadcast({ type: "event", event: "tabs" }));
chrome.tabGroups.onUpdated.addListener(() => broadcast({ type: "event", event: "tabs" }));

try {
  connectNative();
} catch {}
