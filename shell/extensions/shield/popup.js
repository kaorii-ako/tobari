import { api } from "./api.js";
import { autoGroupEnabled, setAutoGroup, groupBySite, ungroupOurs, applyGroups, regroupableTabs } from "./groups.js";

const el = (id) => document.getElementById(id);
const card = document.querySelector(".card");
const nf = new Intl.NumberFormat();

let tabUrl = "";

function age(seconds) {
  if (!seconds) return "—";
  const elapsed = Date.now() / 1000 - seconds;
  // Compact on purpose: the readout column is about 11 characters wide.
  if (elapsed < 3600) return "<1h";
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h`;
  return `${Math.floor(elapsed / 86400)}d`;
}

function paint(state, stats) {
  if (state) {
    el("host").textContent = state.applicable ? state.host : "This page";
    el("toggle").disabled = !state.applicable;
    el("toggle").setAttribute("aria-checked", String(state.applicable && state.enabled));
    card.dataset.off = String(state.applicable && !state.enabled);
    if (!state.applicable) {
      el("count").textContent = "—";
      el("caption").textContent = "Nothing to block on this page.";
    } else if (!state.enabled) {
      el("count").textContent = "0";
      el("caption").textContent = `Blocking is off for ${state.host}.`;
    } else {
      el("count").textContent = nf.format(state.blocked);
      el("caption").textContent = state.blocked === 1 ? "request blocked on this page" : "requests blocked on this page";
    }
    el("jit").disabled = !state.applicable;
    el("jit").setAttribute("aria-checked", String(state.applicable && state.fastJs));
    el("jitHint").textContent = !state.applicable
      ? "Only applies to websites."
      : state.fastJs
        ? "On for this site: faster, more attack surface."
        : "Off: the V8 optimizer stays disabled here.";
    el("total").textContent = nf.format(state.total);
    el("rules").textContent = nf.format(state.rules);
  }
  if (stats) {
    const newest = Math.max(0, ...stats.lists.map((l) => l.modified));
    el("lists").textContent = `${stats.lists.length} · ${age(newest)}`;
    const running = stats.updateState === "running";
    el("update").disabled = running;
    el("status").textContent = running ? "updating…" : (stats.updateState.startsWith("updated") ? stats.updateState : "");
  }
}

async function load() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabUrl = tab?.url ?? "";
  const [state, stats] = await Promise.all([api("/state", { url: tabUrl }), api("/stats")]);
  if (!state && !stats) {
    el("caption").textContent = "Tobari's blocker is not responding.";
    return;
  }
  paint(state, stats);
}

el("toggle").addEventListener("click", async () => {
  const state = await api("/toggle", { url: tabUrl });
  paint(state, null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.reload(tab.id, { bypassCache: true });
});

el("jit").addEventListener("click", async () => {
  const state = await api("/fastjs", { url: tabUrl });
  paint(state, null);
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab) chrome.tabs.reload(tab.id);
});

el("setup").addEventListener("click", async () => {
  await api("/setup/show");
  window.close();
});

el("import").addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("import.html") });
  window.close();
});

async function currentWindowId() {
  return (await chrome.windows.getCurrent()).id;
}

async function paintAutoGroup() {
  el("autogroup").setAttribute("aria-checked", String(await autoGroupEnabled()));
}
el("autogroup").addEventListener("click", async () => {
  const on = !(await autoGroupEnabled());
  await setAutoGroup(on);
  paintAutoGroup();

// The assistant lives in the side panel; where Chromium offers none, in a
// small window of its own that reads this tab.
el("askAi").addEventListener("click", async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  try {
    await chrome.sidePanel.open({ windowId: tab.windowId });
  } catch {
    await chrome.windows.create({
      url: chrome.runtime.getURL(`assistant.html?tab=${tab.id}`),
      type: "popup",
      width: 420,
      height: 640,
    });
  }
  window.close();
});
  if (on) groupBySite(await currentWindowId());
});
el("groupNow").addEventListener("click", async () => {
  const n = await groupBySite(await currentWindowId());
  el("status").textContent = n ? `${n} group${n === 1 ? "" : "s"}` : "nothing to group";
});
el("ungroup").addEventListener("click", async () => {
  await ungroupOurs(await currentWindowId());
  el("status").textContent = "ungrouped";
});
// Topic grouping by the local AI model (tobari://ai). The titles and
// addresses of the tabs go to the model on this computer, nowhere else.
el("groupAi").addEventListener("click", async () => {
  const windowId = await currentWindowId();
  const tabs = await regroupableTabs(windowId);
  if (tabs.length < 2) { el("status").textContent = "nothing to organize"; return; }
  el("groupAi").disabled = true;
  el("status").textContent = "organizing…";
  const r = await api("/ai/group", { tabs: tabs.map((t) => ({ id: t.id, title: t.title || "", url: t.url })) });
  el("groupAi").disabled = false;
  if (!r || r.error) { el("status").textContent = r?.error || "AI is not set up — see tobari://ai"; return; }
  const n = await applyGroups(windowId, r.groups || []);
  el("status").textContent = `${n} group${n === 1 ? "" : "s"}`;
});
paintAutoGroup();

el("update").addEventListener("click", async () => {
  paint(null, await api("/update"));
  const poll = setInterval(async () => {
    const stats = await api("/stats");
    paint(null, stats);
    if (!stats || stats.updateState !== "running") clearInterval(poll);
  }, 1500);
});

load();
