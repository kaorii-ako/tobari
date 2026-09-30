import { parseBang, applyBang, suggestBangs, bangCount } from "./bangs.js";
import { EASE, DUR, track, kill, killPrefix, wake, settle, animate, prefersReducedMotion } from "./motion.js";
import { loadPrefs, savePref } from "./prefs.js";

const gsap = window.gsap;
const DEFAULT_SEARCH = "https://duckduckgo.com/?q={}";
const NEWTAB_URL = "tobari://ui/newtab.html";
const CHROME_BASE = 72;

const el = (id) => document.getElementById(id);
const ui = {
  tabs: el("tabs"), newtab: el("newtab"), back: el("back"), forward: el("forward"),
  reload: el("reload"), reloadGlyph: el("reloadGlyph"), omnibox: el("omnibox"),
  input: el("input"), scheme: el("scheme"), bangchip: el("bangchip"),
  dropdown: el("dropdown"), shield: el("shield"), blockcount: el("blockcount"),
  progress: el("progress"), progressBar: el("progressBar"), panel: el("panel"),
  panelBody: el("panelBody"), panelTabs: el("panelTabs"), panelToggle: el("panelToggle"),
  panelClose: el("panelClose"), menu: el("menu"), menuBtn: el("menuBtn"),
  themeLabel: el("themeLabel"), ptabSettings: el("ptabSettings"), curtain: el("curtain"),
};

let state = { tabs: [], activeId: null, blocked: 0 };
let prefs = loadPrefs();
let panelOpen = false;
let panelView = "bookmarks";
let menuOpen = false;
let rows = [];
let sel = -1;
let chromeHeight = CHROME_BASE;
let focusedTabIndex = 0;

/* ------------------------------------------------------------ native bridge */

function native(payload) {
  return new Promise((resolve) => {
    if (!window.cefQuery) { resolve(null); return; }
    window.cefQuery({
      request: JSON.stringify(payload),
      onSuccess: (r) => { try { resolve(r ? JSON.parse(r) : null); } catch { resolve(null); } },
      onFailure: () => resolve(null),
    });
  });
}

/* ------------------------------------------------------------ url resolution */

function looksLikeUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
  if (/^(about|tobari|chrome|file|data|view-source):/i.test(t)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true;
  if (/^\d{1,3}(\.\d{1,3}){3}(:\d+)?(\/|$)/.test(t)) return true;
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(t);
}

function resolveInput(text) {
  const raw = text.trim();
  if (!raw) return null;
  const bang = parseBang(raw);
  if (bang) {
    if (!bang.query) return { url: bang.url.replace(/[?&][^=]*=\{\}.*$/, "").replace(/\{\}.*$/, ""), via: bang.name };
    return { url: applyBang(bang, bang.query), via: bang.name };
  }
  if (looksLikeUrl(raw)) {
    return { url: /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : "https://" + raw, via: null };
  }
  return { url: DEFAULT_SEARCH.replace("{}", encodeURIComponent(raw)), via: "Search" };
}

/* ------------------------------------------------------------ tabs */

function activeTab() { return state.tabs.find((t) => t.id === state.activeId); }

function buildTab(tab, index) {
  const node = document.createElement("button");
  node.type = "button";
  node.className = "tab";
  node.setAttribute("role", "tab");
  node.setAttribute("aria-selected", String(tab.id === state.activeId));
  node.tabIndex = index === focusedTabIndex ? 0 : -1;
  node.dataset.id = String(tab.id);

  const mark = document.createElement("span");
  mark.className = "tab__mark";
  mark.setAttribute("aria-hidden", "true");
  if (tab.loading) {
    const spinner = document.createElement("span");
    spinner.className = "tab__spinner";
    mark.replaceChildren(spinner);
    spinTo(spinner, `tab-spin-${tab.id}`);
  } else {
    mark.textContent = markLetter(tab);
  }

  const title = document.createElement("span");
  title.className = "tab__title";
  title.textContent = tab.title || prettyUrl(tab.url) || "New tab";

  const close = document.createElement("span");
  close.className = "tab__close";
  close.setAttribute("role", "button");
  close.setAttribute("aria-label", `Close ${title.textContent}`);
  close.tabIndex = -1;
  close.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
  close.addEventListener("click", (e) => { e.stopPropagation(); closeTab(tab.id); });

  node.append(mark, title, close);
  node.addEventListener("click", () => selectTab(tab.id));
  node.addEventListener("auxclick", (e) => { if (e.button === 1) { e.preventDefault(); closeTab(tab.id); } });
  return node;
}

function markLetter(tab) {
  const source = tab.title || prettyUrl(tab.url) || "?";
  const letter = source.trim().charAt(0);
  return letter ? letter.toUpperCase() : "?";
}

function prettyUrl(url) {
  if (!url || url === "about:blank" || url === NEWTAB_URL) return "";
  try { return new URL(url).host.replace(/^www\./, ""); } catch { return url; }
}

function spinTo(node, key) {
  if (prefersReducedMotion()) return;
  wake();
  track(key, gsap.to(node, { rotation: 360, duration: 0.7, ease: "none", repeat: -1 }));
}

function renderTabs() {
  const previous = new Set([...ui.tabs.children].map((n) => n.dataset.id));
  killPrefix("tab-spin-");
  ui.tabs.replaceChildren();
  state.tabs.forEach((tab, index) => {
    const node = buildTab(tab, index);
    ui.tabs.appendChild(node);
    if (!previous.has(String(tab.id))) enterTab(node);
  });
}

function enterTab(node) {
  if (prefersReducedMotion()) return;
  wake();
  gsap.fromTo(node, { opacity: 0, scale: 0.94 }, { opacity: 1, scale: 1, duration: DUR.d2, ease: EASE.snap, clearProps: "transform", onComplete: settle });
}

/* ------------------------------------------------------------ omnibox */

function renderOmnibox() {
  const tab = activeTab();
  const typing = document.activeElement === ui.input;

  if (!typing) {
    const url = tab?.url ?? "";
    ui.input.value = url === "about:blank" || url === NEWTAB_URL ? "" : url;
    let scheme = "";
    let stateAttr = "";
    try {
      const parsed = new URL(url);
      if (parsed.protocol === "https:") { scheme = "https"; stateAttr = "secure"; }
      else if (parsed.protocol === "http:") { scheme = "http"; stateAttr = "insecure"; }
      else { scheme = parsed.protocol.replace(":", ""); }
    } catch { scheme = ""; }
    ui.scheme.textContent = scheme;
    ui.scheme.dataset.state = stateAttr;
  }

  ui.back.disabled = !tab?.canGoBack;
  ui.forward.disabled = !tab?.canGoForward;
  setLoading(Boolean(tab?.loading));
}

let progressTween = null;
let reloadTween = null;

function setLoading(loading) {
  if (loading) {
    if (!reloadTween && !prefersReducedMotion()) {
      wake();
      reloadTween = gsap.to(ui.reloadGlyph, { rotation: 360, duration: 0.8, ease: "none", repeat: -1, transformOrigin: "50% 50%" });
    }
    if (!progressTween) {
      wake();
      gsap.set(ui.progress, { opacity: 1 });
      progressTween = prefersReducedMotion()
        ? null
        : gsap.fromTo(ui.progressBar, { xPercent: -110 }, { xPercent: 420, duration: 1.1, ease: "none", repeat: -1 });
    }
  } else {
    if (reloadTween) { reloadTween.kill(); reloadTween = null; gsap.set(ui.reloadGlyph, { rotation: 0 }); }
    if (progressTween) { progressTween.kill(); progressTween = null; }
    gsap.to(ui.progress, { opacity: 0, duration: DUR.d1, ease: EASE.out, onComplete: settle });
  }
}

/* ------------------------------------------------------------ dropdown */

function hideDropdown() {
  if (ui.dropdown.hidden) return;
  kill("dropdown");
  ui.dropdown.hidden = true;
  ui.dropdown.replaceChildren();
  ui.input.setAttribute("aria-expanded", "false");
  ui.input.removeAttribute("aria-activedescendant");
  rows = [];
  sel = -1;
  requestChromeHeight(CHROME_BASE);
}

function makeRow({ kind, primary, secondary, bang, onPick }, index) {
  const row = document.createElement("button");
  row.type = "button";
  row.className = "row";
  row.id = `row-${index}`;
  row.setAttribute("role", "option");
  row.setAttribute("aria-selected", "false");
  row.dataset.kind = kind;
  row.tabIndex = -1;

  const kindEl = document.createElement("span");
  kindEl.className = "row__kind";
  kindEl.textContent = kind;

  const primaryEl = document.createElement("span");
  primaryEl.className = "row__primary";
  if (bang) {
    const b = document.createElement("span");
    b.className = "row__bang";
    b.textContent = `!${bang} `;
    primaryEl.append(b, document.createTextNode(primary));
  } else {
    primaryEl.textContent = primary;
  }

  row.append(kindEl, primaryEl);
  if (secondary) {
    const secondaryEl = document.createElement("span");
    secondaryEl.className = "row__secondary";
    secondaryEl.textContent = secondary;
    row.appendChild(secondaryEl);
  }
  row.addEventListener("click", onPick);
  return { node: row, pick: onPick, kind };
}

function updateDropdown() {
  const text = ui.input.value;
  const trimmed = text.trim();
  ui.dropdown.replaceChildren();
  rows = [];
  sel = -1;

  if (!trimmed) { hideDropdown(); return; }

  const bangPrefix = trimmed.match(/(?:^|\s)!([A-Za-z0-9_/]*)$/);
  if (bangPrefix) {
    const label = document.createElement("div");
    label.className = "dropdown__label u-caps";
    label.textContent = `${bangCount()} bangs · resolved on this machine`;
    ui.dropdown.appendChild(label);
    const before = trimmed.slice(0, bangPrefix.index).trim();
    suggestBangs(bangPrefix[1]).forEach((s, i) => {
      const row = makeRow({
        kind: "bang", primary: s.name, secondary: before || "then type a query", bang: s.token,
        onPick: () => {
          ui.input.value = `${before ? before + " " : ""}!${s.token} `;
          ui.input.focus();
          updateDropdown();
        },
      }, i);
      rows.push(row);
      ui.dropdown.appendChild(row.node);
    });
  } else {
    const bang = parseBang(trimmed);
    const resolved = resolveInput(trimmed);
    if (resolved) {
      const row = makeRow({
        kind: bang ? "bang" : looksLikeUrl(trimmed) ? "open" : "find",
        primary: bang ? bang.query || bang.name : trimmed,
        secondary: bang ? `via ${bang.name}` : resolved.url,
        bang: bang ? bang.token : null,
        onPick: commit,
      }, 0);
      rows.push(row);
      ui.dropdown.appendChild(row.node);
    }
  }

  if (!rows.length) { hideDropdown(); return; }

  ui.dropdown.hidden = false;
  ui.input.setAttribute("aria-expanded", "true");
  setSel(0);

  if (!prefersReducedMotion()) {
    wake();
    track("dropdown", gsap.fromTo(ui.dropdown, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: DUR.d2, ease: EASE.out }));
    gsap.fromTo(rows.map((r) => r.node), { opacity: 0, x: -4 },
      { opacity: 1, x: 0, duration: DUR.d2, ease: EASE.out, stagger: 0.018, clearProps: "transform", onComplete: settle });
  }
  requestAnimationFrame(syncChromeHeight);
}

function setSel(index) {
  if (!rows.length) return;
  sel = (index + rows.length) % rows.length;
  rows.forEach((r, i) => {
    r.node.setAttribute("aria-selected", String(i === sel));
    if (i === sel) {
      ui.input.setAttribute("aria-activedescendant", r.node.id);
      r.node.scrollIntoView({ block: "nearest" });
    }
  });
}

function commit() {
  const resolved = resolveInput(ui.input.value);
  if (!resolved) return;
  hideDropdown();
  ui.input.blur();
  navigate(resolved.url);
}

function requestChromeHeight(height) {
  const next = Math.max(CHROME_BASE, Math.min(Math.round(height), 640));
  if (next === chromeHeight) return;
  chromeHeight = next;
  native({ type: "chrome_height", height: next });
}

function syncChromeHeight() {
  if (ui.dropdown.hidden) { requestChromeHeight(CHROME_BASE); return; }
  requestChromeHeight(ui.dropdown.getBoundingClientRect().bottom + 8);
}

/* ------------------------------------------------------------ actions */

function newTab(url) { native({ type: "new_tab", url: url ?? NEWTAB_URL }); }
function selectTab(id) { native({ type: "select_tab", id }); }
function navigate(url) { native({ type: "navigate", url }); }

function closeTab(id) {
  const node = ui.tabs.querySelector(`[data-id="${id}"]`);
  kill(`tab-spin-${id}`);
  if (!node || prefersReducedMotion()) { native({ type: "close_tab", id }); return; }
  wake();
  gsap.to(node, {
    opacity: 0, scale: 0.94, duration: DUR.d1, ease: EASE.in,
    onComplete: () => { native({ type: "close_tab", id }); settle(); },
  });
}

/* ------------------------------------------------------------ panel */

function setPanel(open) {
  panelOpen = open;
  ui.panelToggle.setAttribute("aria-pressed", String(open));
  if (open) {
    ui.panel.hidden = false;
    renderPanel();
    if (!prefersReducedMotion()) {
      wake();
      track("panel", gsap.fromTo(ui.panel, { opacity: 0, x: 18 }, { opacity: 1, x: 0, duration: DUR.d3, ease: EASE.out, clearProps: "transform", onComplete: settle }));
    }
  } else if (!ui.panel.hidden) {
    if (prefersReducedMotion()) { ui.panel.hidden = true; }
    else {
      track("panel", gsap.to(ui.panel, {
        opacity: 0, x: 18, duration: DUR.d2, ease: EASE.in,
        onComplete: () => { ui.panel.hidden = true; gsap.set(ui.panel, { clearProps: "all" }); settle(); },
      }));
    }
  }
  native({ type: "panel", open });
}

function setPanelView(view) {
  panelView = view;
  for (const t of ui.panelTabs.querySelectorAll(".ptab")) {
    t.setAttribute("aria-selected", String(t.dataset.panel === view));
  }
  ui.ptabSettings.hidden = view !== "settings";
  renderPanel();
}

function renderPanel() {
  ui.panelBody.replaceChildren();
  if (panelView === "settings") { renderSettings(); return; }
  const copy = {
    bookmarks: "Nothing saved yet. Bookmarks stay on this machine.",
    history: "No history recorded in this session.",
    reading: "Reading list is empty.",
  };
  const empty = document.createElement("p");
  empty.className = "empty";
  empty.textContent = copy[panelView] ?? "";
  ui.panelBody.appendChild(empty);
}

function renderSettings() {
  const fields = [
    { key: "theme", name: "Appearance", hint: `Currently ${prefs.theme}. Follows the system when set to system.`, kind: "theme" },
    { key: "newtabMotion", name: "New-tab background", hint: "Animated background on the new-tab page. Off by default; costs GPU while visible.", kind: "switch" },
    { key: "smoothScroll", name: "Smooth scrolling on new tab", hint: "Eased scrolling on the new-tab page only. Never applied to web pages.", kind: "switch" },
  ];
  for (const f of fields) {
    const field = document.createElement("div");
    field.className = "field";
    const text = document.createElement("div");
    text.className = "field__text";
    const name = document.createElement("div");
    name.className = "field__name";
    name.textContent = f.name;
    const hint = document.createElement("div");
    hint.className = "field__hint";
    hint.textContent = f.hint;
    text.append(name, hint);
    field.appendChild(text);

    if (f.kind === "switch") {
      const sw = document.createElement("button");
      sw.type = "button";
      sw.className = "switch";
      sw.setAttribute("role", "switch");
      sw.setAttribute("aria-checked", String(Boolean(prefs[f.key])));
      sw.setAttribute("aria-label", f.name);
      const dot = document.createElement("span");
      dot.className = "switch__dot";
      sw.appendChild(dot);
      gsap.set(dot, { x: prefs[f.key] ? 16 : 0 });
      sw.addEventListener("click", () => {
        const next = !prefs[f.key];
        prefs[f.key] = next;
        savePref(f.key, next);
        sw.setAttribute("aria-checked", String(next));
        if (prefersReducedMotion()) gsap.set(dot, { x: next ? 16 : 0 });
        else { wake(); gsap.to(dot, { x: next ? 16 : 0, duration: DUR.d2, ease: EASE.snap, onComplete: settle }); }
      });
      field.appendChild(sw);
    } else {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "menu__item";
      btn.style.width = "auto";
      btn.textContent = prefs.theme;
      btn.addEventListener("click", () => { cycleTheme(); renderSettings(); });
      field.appendChild(btn);
    }
    ui.panelBody.appendChild(field);
  }
}

/* ------------------------------------------------------------ theme */

const THEMES = ["night", "daybreak", "system"];

function resolveTheme(choice) {
  if (choice !== "system") return choice;
  return window.matchMedia("(prefers-color-scheme: light)").matches ? "daybreak" : "night";
}

function applyTheme() {
  document.documentElement.dataset.theme = resolveTheme(prefs.theme);
  ui.themeLabel.textContent = prefs.theme;
}

function cycleTheme() {
  prefs.theme = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
  savePref("theme", prefs.theme);
  applyTheme();
}

window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
  if (prefs.theme === "system") applyTheme();
});

/* ------------------------------------------------------------ menu */

function setMenu(open) {
  menuOpen = open;
  ui.menuBtn.setAttribute("aria-expanded", String(open));
  if (open) {
    ui.menu.hidden = false;
    if (!prefersReducedMotion()) {
      wake();
      track("menu", gsap.fromTo(ui.menu, { opacity: 0, y: -6 }, { opacity: 1, y: 0, duration: DUR.d2, ease: EASE.out, clearProps: "transform", onComplete: settle }));
    }
    ui.menu.querySelector(".menu__item")?.focus();
  } else {
    ui.menu.hidden = true;
  }
}

ui.menu.addEventListener("click", (e) => {
  const item = e.target.closest(".menu__item");
  if (!item) return;
  setMenu(false);
  const action = item.dataset.action;
  if (action === "new-tab") newTab();
  else if (action === "panel") setPanel(!panelOpen);
  else if (action === "settings") { setPanelView("settings"); if (!panelOpen) setPanel(true); }
  else if (action === "theme") cycleTheme();
});

ui.menu.addEventListener("keydown", (e) => {
  const items = [...ui.menu.querySelectorAll(".menu__item")];
  const i = items.indexOf(document.activeElement);
  if (e.key === "ArrowDown") { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === "ArrowUp") { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === "Escape") { e.preventDefault(); setMenu(false); ui.menuBtn.focus(); }
});

/* ------------------------------------------------------------ wiring */

ui.input.addEventListener("focus", () => { ui.omnibox.classList.add("is-focused"); ui.input.select(); updateDropdown(); });
ui.input.addEventListener("blur", () => {
  ui.omnibox.classList.remove("is-focused");
  setTimeout(() => { hideDropdown(); renderOmnibox(); }, 120);
});
ui.input.addEventListener("input", () => {
  const bang = parseBang(ui.input.value);
  if (bang) {
    const changed = ui.bangchip.hidden || ui.bangchip.textContent !== `!${bang.token}`;
    ui.bangchip.hidden = false;
    ui.bangchip.textContent = `!${bang.token}`;
    if (changed && !prefersReducedMotion()) {
      wake();
      gsap.fromTo(ui.bangchip, { opacity: 0, scale: 0.8 }, { opacity: 1, scale: 1, duration: DUR.d2, ease: EASE.snap, clearProps: "transform", onComplete: settle });
    }
  } else {
    ui.bangchip.hidden = true;
  }
  updateDropdown();
});

ui.input.addEventListener("keydown", (e) => {
  if (e.key === "ArrowDown") { e.preventDefault(); setSel(sel + 1); }
  else if (e.key === "ArrowUp") { e.preventDefault(); setSel(sel - 1); }
  else if (e.key === "Tab" && !ui.dropdown.hidden && rows[sel]?.kind === "bang") { e.preventDefault(); rows[sel].pick(); }
  else if (e.key === "Enter") {
    e.preventDefault();
    const row = rows[sel];
    if (row && row.kind === "bang" && /!\S*$/.test(ui.input.value)) row.pick();
    else commit();
  } else if (e.key === "Escape") { e.preventDefault(); hideDropdown(); ui.input.blur(); }
});

ui.tabs.addEventListener("keydown", (e) => {
  const nodes = [...ui.tabs.querySelectorAll(".tab")];
  if (!nodes.length) return;
  const current = nodes.indexOf(document.activeElement);
  if (e.key === "ArrowRight" || e.key === "ArrowLeft") {
    e.preventDefault();
    const next = (current + (e.key === "ArrowRight" ? 1 : -1) + nodes.length) % nodes.length;
    focusedTabIndex = next;
    nodes.forEach((n, i) => { n.tabIndex = i === next ? 0 : -1; });
    nodes[next].focus();
  } else if (e.key === "Delete" || (e.key === "w" && (e.ctrlKey || e.metaKey))) {
    e.preventDefault();
    const id = Number(document.activeElement?.dataset.id);
    if (id) closeTab(id);
  }
});

ui.panelTabs.addEventListener("click", (e) => {
  const t = e.target.closest(".ptab");
  if (t) setPanelView(t.dataset.panel);
});

ui.newtab.addEventListener("click", () => newTab());
ui.back.addEventListener("click", () => native({ type: "back" }));
ui.forward.addEventListener("click", () => native({ type: "forward" }));
ui.reload.addEventListener("click", () => native({ type: "reload" }));
ui.shield.addEventListener("click", () => native({ type: "toggle_blocking" }));
ui.panelToggle.addEventListener("click", () => setPanel(!panelOpen));
ui.panelClose.addEventListener("click", () => { setPanel(false); ui.panelToggle.focus(); });
ui.menuBtn.addEventListener("click", () => setMenu(!menuOpen));

document.addEventListener("click", (e) => {
  if (menuOpen && !ui.menu.contains(e.target) && e.target !== ui.menuBtn) setMenu(false);
});

document.addEventListener("keydown", (e) => {
  const mod = e.ctrlKey || e.metaKey;
  if (mod && e.key === "t") { e.preventDefault(); newTab(); }
  else if (mod && e.key === "w") { e.preventDefault(); if (state.activeId) closeTab(state.activeId); }
  else if (mod && e.key === "l") { e.preventDefault(); ui.input.focus(); }
  else if (mod && e.key === "r") { e.preventDefault(); native({ type: "reload" }); }
  else if (mod && e.key === "b") { e.preventDefault(); setPanel(!panelOpen); }
  else if (e.key === "F5") { e.preventDefault(); native({ type: "reload" }); }
  else if (e.key === "Escape" && menuOpen) { setMenu(false); ui.menuBtn.focus(); }
  else if (e.altKey && e.key === "ArrowLeft") { e.preventDefault(); native({ type: "back" }); }
  else if (e.altKey && e.key === "ArrowRight") { e.preventDefault(); native({ type: "forward" }); }
});

window.addEventListener("blur", () => { progressTween?.pause(); reloadTween?.pause(); });
window.addEventListener("focus", () => { progressTween?.resume(); reloadTween?.resume(); });

/* ------------------------------------------------------------ native -> UI */

window.tobari = {
  setState(next) {
    try {
      const previousBlocked = state.blocked;
      state = Object.assign(state, next);
      focusedTabIndex = Math.min(focusedTabIndex, Math.max(state.tabs.length - 1, 0));
      renderTabs();
      renderOmnibox();
      if (typeof next.blocked === "number") {
        ui.blockcount.textContent = String(next.blocked);
        ui.shield.dataset.active = String(next.blocked > 0);
        if (next.blocked > previousBlocked && !prefersReducedMotion()) {
          wake();
          gsap.fromTo(ui.shield.querySelector("svg"), { scale: 1 },
            { scale: 1.22, duration: DUR.d1, ease: EASE.out, yoyo: true, repeat: 1, clearProps: "transform", onComplete: settle });
        }
      }
    } catch (err) {
      native({ type: "ui_error", message: String(err && err.stack ? err.stack : err) });
    }
  },
  focusOmnibox() { ui.input.focus(); },
};

/* ------------------------------------------------------------ boot */

applyTheme();
renderTabs();
renderOmnibox();
setPanelView(panelView);

if (prefersReducedMotion()) {
  ui.curtain.remove();
} else {
  wake();
  gsap.to(ui.curtain, {
    scaleY: 0, transformOrigin: "50% 0%", duration: DUR.d4, ease: EASE.inOut,
    onComplete: () => { ui.curtain.remove(); settle(); },
  });
}

native({ type: "ready" });
