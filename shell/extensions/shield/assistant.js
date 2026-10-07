// Ask AI: summarize or question the page in the active tab, with Tobari's
// local model. Opens in the side panel, or in a small window where there is
// none (then ?tab= names the tab it reads).
import { api, streamApi } from "./api.js";

const el = (id) => document.getElementById(id);
const light = window.matchMedia("(prefers-color-scheme: light)");
const theme = () => (document.documentElement.dataset.theme = light.matches ? "daybreak" : "night");
theme();
light.addEventListener("change", theme);

const pinnedTab = Number(new URLSearchParams(location.search).get("tab")) || null;
let page = { url: "", title: "" };
// One conversation per page address, kept while the panel is open, so going
// back to a tab finds its summary still there.
const conversations = new Map();
let conv = { history: [], nodes: [] };
let controller = null;

async function currentTab() {
  if (pinnedTab) return chrome.tabs.get(pinnedTab).catch(() => null);
  const [tab] = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
  return tab || null;
}

function show(url) {
  for (const n of conv.nodes) n.remove();
  conv = conversations.get(url) || { history: [], nodes: [] };
  conversations.delete(url);
  conversations.set(url, conv);
  if (conversations.size > 20) conversations.delete(conversations.keys().next().value);
  el("log").append(...conv.nodes);
  el("empty").hidden = !el("setup").hidden || conv.nodes.length > 0;
  conv.nodes.at(-1)?.scrollIntoView({ block: "end" });
}

function reset() {
  if (conv.controller) {
    conv.controller.abort();
    conv.controller = null;
    controller = null;
  }
  for (const n of conv.nodes) n.remove();
  conv.history = [];
  conv.nodes = [];
  el("empty").hidden = !el("setup").hidden;
  busy(false);
}

async function follow() {
  const tab = await currentTab();
  const next = { url: tab?.url || "", title: tab?.title || "" };
  el("title").textContent = next.title || next.url || "—";
  if (next.url !== page.url) {
    page = next;
    show(page.url);
  }
  page.title = next.title;
  const web = /^https?:/.test(page.url);
  el("summarize").disabled = !web;
  el("input").placeholder = web ? "Ask about this page…" : "Open a web page to ask about it";
}

function busy(on) {
  el("send").disabled = on;
  el("summarize").disabled = on;
}

// Model output as plain DOM: "- " lines become a list, **bold** markers are
// dropped. Never innerHTML; the text is shaped by an untrusted page.
function render(node, text) {
  node.textContent = "";
  let list = null;
  for (const raw of text.split("\n")) {
    const line = raw.replace(/\*\*(.+?)\*\*/g, "$1");
    const item = /^\s*(?:[-*•]|\d+[.)])\s+(.*)$/.exec(line);
    if (item) {
      if (!list) node.append((list = document.createElement("ul")));
      const li = document.createElement("li");
      li.textContent = item[1];
      list.append(li);
    } else if (line.trim()) {
      list = null;
      const p = document.createElement("p");
      p.textContent = line;
      node.append(p);
    }
  }
}

function bubble(role, text) {
  el("empty").hidden = true;
  const p = document.createElement("div");
  p.className = `msg ${role}`;
  p.textContent = text;
  el("log").append(p);
  conv.nodes.push(p);
  p.scrollIntoView({ block: "end" });
  return p;
}

async function run(mode, question) {
  if (controller || !/^https?:/.test(page.url)) return;
  const mine = conv;
  if (question) bubble("user", question);
  const out = bubble("assistant", "");
  out.classList.add("pending");
  controller = new AbortController();
  mine.controller = controller;
  busy(true);
  let reply = "";
  const body = { url: page.url, title: page.title, mode, question, history: mine.history };
  for await (const ev of streamApi("/ai/page", body, controller.signal)) {
    if (ev.t) {
      reply += ev.t;
      render(out, reply);
      out.scrollIntoView({ block: "end" });
    }
    if (ev.done && ev.error) {
      out.classList.add("error");
      out.textContent = ev.error;
      if (/model/i.test(ev.error)) checkSetup();
    }
  }
  out.classList.remove("pending");
  if (reply) {
    mine.history.push({ role: "user", content: question || "Summarize this page." });
    mine.history.push({ role: "assistant", content: reply });
  }
  mine.controller = null;
  controller = null;
  busy(false);
}

async function checkSetup() {
  const s = await api("/ai/state");
  const ready = !!(s && s.selected && s.engineIncluded);
  el("setup").hidden = ready;
  el("empty").hidden = !ready || document.querySelector(".msg") !== null;
  el("input").disabled = !ready;
}

el("summarize").addEventListener("click", () => run("summary", ""));
el("form").addEventListener("submit", (e) => {
  e.preventDefault();
  const q = el("input").value.trim();
  if (!q) return;
  el("input").value = "";
  el("input").style.height = "";
  run("ask", q);
});
el("input").addEventListener("keydown", (e) => {
  if (e.key === "Enter" && !e.shiftKey) {
    e.preventDefault();
    el("form").requestSubmit();
  }
});
el("input").addEventListener("input", () => {
  const t = el("input");
  t.style.height = "";
  t.style.height = `${Math.min(t.scrollHeight, 140)}px`;
});
el("clear").addEventListener("click", reset);
el("openAi").addEventListener("click", () => api("/ai/open"));

chrome.tabs.onActivated.addListener(follow);
chrome.tabs.onUpdated.addListener((id, info) => {
  if (info.url || info.title || info.status === "complete") follow();
});
chrome.windows.onFocusChanged.addListener(() => follow());
// Re-check after the model is set up in tobari://ai.
document.addEventListener("visibilitychange", () => document.visibilityState === "visible" && checkSetup());

await checkSetup();
await follow();
