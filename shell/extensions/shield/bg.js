const BRIDGE = "bridge.html";
const IDLE_CLOSE_MS = 30000;
let closeTimer = null;
let opening = null;

async function ensureBridge() {
  const existing = await chrome.runtime.getContexts({ contextTypes: ["OFFSCREEN_DOCUMENT"] });
  if (existing.length) return;
  opening ??= chrome.offscreen.createDocument({
    url: BRIDGE,
    reasons: ["WORKERS"],
    justification: "Relays blocking state from the browser to the toolbar badge.",
  }).finally(() => { opening = null; });
  await opening;
}

async function api(path, body = {}) {
  clearTimeout(closeTimer);
  try {
    await ensureBridge();
    return await chrome.runtime.sendMessage({ target: "tobari-bridge", path, body });
  } catch {
    return null;
  } finally {
    closeTimer = setTimeout(() => chrome.offscreen.closeDocument().catch(() => {}), IDLE_CLOSE_MS);
  }
}

const SIGNAL = "#ff6b3d";
const INK = "#0a0a0c";
const pollers = new Map();

chrome.runtime.onInstalled.addListener(() => {
  chrome.action.setBadgeBackgroundColor({ color: SIGNAL });
  chrome.action.setBadgeTextColor?.({ color: INK });
});

async function refresh(tabId, url) {
  if (!url || !/^https?:/.test(url)) {
    await chrome.action.setBadgeText({ tabId, text: "" });
    return;
  }
  const state = await api("/state", { url });
  if (!state) return;
  const text = state.enabled && state.blocked > 0 ? (state.blocked > 999 ? "999+" : String(state.blocked)) : "";
  await chrome.action.setBadgeText({ tabId, text });
  await chrome.action.setTitle({
    tabId,
    title: state.enabled
      ? `Tobari — ${state.blocked} blocked on ${state.host}`
      : `Tobari — blocking off for ${state.host}`,
  });
}

function stopPolling(tabId) {
  const t = pollers.get(tabId);
  if (t) clearInterval(t);
  pollers.delete(tabId);
}

function pollWhileLoading(tabId) {
  stopPolling(tabId);
  let settled = 0;
  pollers.set(tabId, setInterval(async () => {
    const tab = await chrome.tabs.get(tabId).catch(() => null);
    if (!tab) return stopPolling(tabId);
    await refresh(tabId, tab.url);
    if (tab.status === "complete" && ++settled >= 3) stopPolling(tabId);
  }, 1000));
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === "loading") pollWhileLoading(tabId);
  else if (info.status === "complete") refresh(tabId, tab.url);
});
chrome.tabs.onActivated.addListener(async ({ tabId }) => {
  const tab = await chrome.tabs.get(tabId).catch(() => null);
  if (tab) refresh(tabId, tab.url);
});
chrome.tabs.onRemoved.addListener(stopPolling);
