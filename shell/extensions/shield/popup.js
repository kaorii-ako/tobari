import { api } from "./api.js";

const el = (id) => document.getElementById(id);
const card = document.querySelector(".card");
const nf = new Intl.NumberFormat();

let tabUrl = "";

function age(seconds) {
  if (!seconds) return "—";
  const elapsed = Date.now() / 1000 - seconds;
  if (elapsed < 3600) return "just now";
  if (elapsed < 86400) return `${Math.floor(elapsed / 3600)}h ago`;
  return `${Math.floor(elapsed / 86400)}d ago`;
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

el("update").addEventListener("click", async () => {
  paint(null, await api("/update"));
  const poll = setInterval(async () => {
    const stats = await api("/stats");
    paint(null, stats);
    if (!stats || stats.updateState !== "running") clearInterval(poll);
  }, 1500);
});

load();
