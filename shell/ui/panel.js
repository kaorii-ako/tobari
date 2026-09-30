import { EASE, DUR, wake, settle, prefersReducedMotion } from "./motion.js";
import { loadPrefs, savePref } from "./prefs.js";

const gsap = window.gsap;
let prefs = loadPrefs();
let view = "bookmarks";

const el = (id) => document.getElementById(id);
const ui = { tabs: el("panelTabs"), body: el("panelBody"), close: el("panelClose") };

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

function applyTheme() {
  const choice = prefs.theme;
  document.documentElement.dataset.theme = choice === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "daybreak" : "night")
    : choice;
}

const EMPTY_COPY = {
  bookmarks: "Nothing saved yet. Bookmarks stay on this machine.",
  history: "No pages visited yet.",
  reading: "Reading list is empty. Add the current page from the menu.",
};

async function render() {
  ui.body.replaceChildren();
  if (view === "settings") { renderSettings(); return; }

  const entries = (await native({ type: "list_get", kind: view })) ?? [];
  if (!entries.length) {
    const empty = document.createElement("p");
    empty.className = "empty";
    empty.textContent = EMPTY_COPY[view] ?? "";
    ui.body.appendChild(empty);
    return;
  }

  const frag = document.createDocumentFragment();
  for (const entry of entries) {
    const row = document.createElement("div");
    row.className = "item";

    const open = document.createElement("button");
    open.type = "button";
    open.className = "item__text";
    open.addEventListener("click", () => native({ type: "entry_open", url: entry.url }));

    const title = document.createElement("span");
    title.className = "item__title";
    title.textContent = entry.title || entry.url;
    const url = document.createElement("span");
    url.className = "item__url";
    url.textContent = entry.url;
    open.append(title, url);

    const drop = document.createElement("button");
    drop.type = "button";
    drop.className = "item__drop";
    drop.setAttribute("aria-label", `Remove ${entry.title || entry.url}`);
    drop.innerHTML = '<svg viewBox="0 0 16 16" aria-hidden="true"><path d="M4.5 4.5l7 7M11.5 4.5l-7 7"/></svg>';
    drop.addEventListener("click", async () => {
      await native({ type: "entry_remove", kind: view, url: entry.url });
      render();
    });

    row.append(open, drop);
    frag.appendChild(row);
  }
  ui.body.appendChild(frag);

  const foot = document.createElement("div");
  foot.className = "panel__foot";
  const clear = document.createElement("button");
  clear.type = "button";
  clear.className = "linkbtn";
  clear.textContent = `Clear ${view}`;
  clear.addEventListener("click", async () => {
    await native({ type: "list_clear", kind: view });
    render();
  });
  foot.appendChild(clear);
  ui.body.appendChild(foot);
}

const THEMES = ["night", "daybreak", "system"];

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
      btn.addEventListener("click", () => {
        prefs.theme = THEMES[(THEMES.indexOf(prefs.theme) + 1) % THEMES.length];
        savePref("theme", prefs.theme);
        applyTheme();
        native({ type: "theme_changed", theme: prefs.theme });
        renderSettingsRefresh();
      });
      field.appendChild(btn);
    }
    ui.body.appendChild(field);
  }
}

function renderSettingsRefresh() {
  ui.body.replaceChildren();
  renderSettings();
}

ui.tabs.addEventListener("click", (e) => {
  const t = e.target.closest(".ptab");
  if (!t) return;
  view = t.dataset.panel;
  for (const other of ui.tabs.querySelectorAll(".ptab")) {
    other.setAttribute("aria-selected", String(other === t));
  }
  render();
});

ui.close.addEventListener("click", () => native({ type: "panel", open: false }));

window.tobariPanel = {
  refresh(kind) {
    prefs = loadPrefs();
    applyTheme();
    if (!kind || kind === view) render();
  },
  setTheme(theme) { prefs.theme = theme; applyTheme(); },
};

applyTheme();
render();
native({ type: "panel_ready" });
