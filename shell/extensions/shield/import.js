// Import page. Reading the other browser happens in Tobari's native code
// through the bridge; writing bookmarks and history happens here, through
// Chromium's own extension APIs. Cookies are written natively.

import { api } from "./api.js";

const $ = (s) => document.querySelector(s);
const nf = new Intl.NumberFormat();
const light = window.matchMedia("(prefers-color-scheme: light)");
const theme = () => (document.documentElement.dataset.theme = light.matches ? "daybreak" : "night");
theme();
light.addEventListener("change", theme);

let sources = [];
let chosen = null;

function renderSources() {
  const box = $("[data-sources]");
  box.textContent = "";
  if (!sources.length) {
    const p = document.createElement("p");
    p.className = "muted";
    p.textContent = "No other browser profiles were found. Tobari looks for Chrome, Chromium, Brave, Edge, Vivaldi and Firefox, installed normally or as Flatpaks.";
    box.append(p);
    return;
  }
  for (const s of sources) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "source";
    b.setAttribute("role", "radio");
    b.setAttribute("aria-checked", String(chosen === s.id));
    const tile = document.createElement("span");
    tile.className = "mono-tile";
    tile.textContent = s.browser.charAt(0);
    const text = document.createElement("span");
    const name = document.createElement("strong");
    name.textContent = s.browser;
    const prof = document.createElement("small");
    prof.textContent = `Profile: ${s.profile}`;
    text.append(name, prof);
    const tag = document.createElement("span");
    tag.className = "tag";
    tag.textContent = s.flatpak ? "flatpak" : "";
    b.append(tile, text, tag);
    b.addEventListener("click", () => {
      chosen = s.id;
      renderSources();
      $("[data-start]").disabled = false;
      $("[data-what='extensions']").closest(".opt").querySelector("small").textContent = s.firefox
        ? "A list of what you had; Firefox add-ons are not Chrome extensions, so each links to a Web Store search."
        : "A list of what you had, each one a click away in the Chrome Web Store.";
    });
    box.append(b);
  }
}

async function createTree(parentId, nodes) {
  let count = 0;
  for (const n of nodes) {
    if (n.url) {
      try {
        await chrome.bookmarks.create({ parentId, title: n.title || n.url, url: n.url });
        count++;
      } catch { /* a URL Chromium will not bookmark (javascript:, data:) */ }
    } else if (n.children) {
      const folder = await chrome.bookmarks.create({ parentId, title: n.title || "Folder" });
      count += await createTree(folder.id, n.children);
    }
  }
  return count;
}

function addResult(label, note) {
  const li = document.createElement("li");
  const a = document.createElement("span");
  a.textContent = label;
  const b = document.createElement("span");
  b.className = "note";
  b.textContent = note;
  li.append(a, b);
  $("[data-result-list]").append(li);
}

async function start() {
  const src = sources.find((s) => s.id === chosen);
  if (!src) return;
  const what = Object.fromEntries([...document.querySelectorAll("[data-what]")].map((i) => [i.dataset.what, i.checked]));
  const status = $("[data-status]");
  $("[data-start]").disabled = true;
  $("[data-result-list]").textContent = "";
  $("[data-results]").hidden = false;

  if (what.cookies) {
    status.textContent = "Importing cookies…";
    const r = await api("/import/cookies", { source: src.id });
    if (!r || r.error) addResult("Cookies", r?.error || "failed");
    else {
      let note = `${nf.format(r.imported)} imported`;
      if (r.undecryptable) note += `, ${nf.format(r.undecryptable)} could not be decrypted`;
      if (r.expired) note += `, ${nf.format(r.expired)} already expired`;
      addResult("Cookies", note);
    }
  }
  if (what.bookmarks) {
    status.textContent = "Importing bookmarks…";
    const r = await api("/import/bookmarks", { source: src.id });
    if (!r || r.error) addResult("Bookmarks", r?.error || "failed");
    else {
      const folder = await chrome.bookmarks.create({ parentId: "1", title: `From ${src.browser}` });
      const n = await createTree(folder.id, r.roots);
      addResult("Bookmarks", `${nf.format(n)} into "From ${src.browser}" on the bookmarks bar`);
    }
  }
  if (what.history) {
    status.textContent = "Importing history…";
    const r = await api("/import/history", { source: src.id });
    if (!r || r.error) addResult("History", r?.error || "failed");
    else {
      const entries = r.entries || [];
      for (let i = 0; i < entries.length; i += 100) {
        await Promise.all(entries.slice(i, i + 100).map((e) => chrome.history.addUrl({ url: e.url }).catch(() => {})));
        status.textContent = `Importing history… ${nf.format(Math.min(i + 100, entries.length))} of ${nf.format(entries.length)}`;
      }
      addResult("History", `${nf.format(entries.length)} pages`);
    }
  }
  if (what.extensions) {
    status.textContent = "Listing extensions…";
    const r = await api("/import/extensions", { source: src.id });
    const list = r?.extensions || [];
    addResult("Extensions", list.length ? `${list.length} found, below` : (r?.error || "none found"));
    const ul = $("[data-ext-list]");
    ul.textContent = "";
    for (const e of list) {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = e.name;
      const b = document.createElement("button");
      b.className = "link";
      b.type = "button";
      b.textContent = r.chromeStore ? "Get it" : "Search the Web Store";
      b.addEventListener("click", () => chrome.tabs.create({ url: e.store }));
      li.append(name, b);
      ul.append(li);
    }
    $("[data-ext-wrap]").hidden = list.length === 0;
  }
  status.textContent = "Done.";
  $("[data-start]").disabled = false;
}

for (const b of document.querySelectorAll("[data-open]")) {
  b.addEventListener("click", () => chrome.tabs.create({ url: b.dataset.open }));
}
$("[data-start]").addEventListener("click", start);

const r = await api("/import/sources");
sources = r?.sources || [];
if (sources.length) chosen = sources[0].id;
$("[data-start]").disabled = !chosen;
renderSources();
