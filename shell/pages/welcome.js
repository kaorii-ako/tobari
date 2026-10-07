// Tobari welcome flow. Every choice is written to Chromium's preferences
// through the browser's bridge as soon as it is made, so closing the tab
// halfway keeps what was chosen. Finishing or skipping marks setup done, and
// the next launch opens the new tab instead.

import { api as call } from "/page.js";

// The bridge paths the extension used map onto this page's own /api/.
const api = (path, body) => call(path.replace(/^\//, ""), body);

const $ = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => [...root.querySelectorAll(s)];

const steps = $$("[data-step]");
const bars = $$(".progress span");
const back = $("[data-back]");
const next = $("[data-next]");
const nextLabel = $("[data-next-label]");
const skip = $("[data-skip]");
const status = $("[data-status]");
const LABELS = ["Get started", "Continue", "Continue", "Continue", "Continue", "Start browsing"];
const SCHEMES = ["System", "Light", "Dark"];

let state = null;
let current = 0;
let pending = Promise.resolve();

/* ---------------------------------------------------------------- bridge */

function apply(patch) {
  pending = pending.then(async () => {
    const result = await api("/setup/apply", patch);
    if (result) {
      state = result;
      status.textContent = "";
    } else {
      status.textContent = "That change could not be saved. You can set it later in Settings.";
    }
  });
  return pending;
}

/* ---------------------------------------------------------------- theme preview */

const systemLight = window.matchMedia("(prefers-color-scheme: light)");

function effectiveLight(scheme) {
  return scheme === 1 || (scheme === 0 && systemLight.matches);
}

function accentColor(id) {
  const a = state.accents.find((x) => x.id === id);
  return a && a.color ? a.color : null;
}

function paintTheme() {
  const light = effectiveLight(state.scheme);
  document.documentElement.dataset.theme = light ? "daybreak" : "night";
  const accent = accentColor(state.accent);
  const root = document.documentElement.style;
  if (accent) root.setProperty("--accent", accent);
  else root.removeProperty("--accent");

  const pv = $("[data-preview]").style;
  const tint = (base, amount) => (accent ? `color-mix(in srgb, ${accent} ${amount}%, ${base})` : base);
  if (light) {
    pv.setProperty("--pv-frame", tint("#e2e0db", 16));
    pv.setProperty("--pv-tab", tint("#eceae6", 10));
    pv.setProperty("--pv-bar", tint("#f6f5f2", 8));
    pv.setProperty("--pv-url", "#ffffff");
    pv.setProperty("--pv-page", "#ffffff");
    pv.setProperty("--pv-line", "#e4e1db");
  } else {
    pv.setProperty("--pv-frame", tint("#141418", 16));
    pv.setProperty("--pv-tab", tint("#1b1b20", 10));
    pv.setProperty("--pv-bar", tint("#23232a", 12));
    pv.setProperty("--pv-url", "#141418");
    pv.setProperty("--pv-page", "#0f0f12");
    pv.setProperty("--pv-line", "#23232a");
  }
  pv.setProperty("--pv-accent", accent || (light ? "#43434b" : "#b9b9c4"));
}
systemLight.addEventListener("change", () => state && paintTheme());

/* ---------------------------------------------------------------- radio groups */

// Arrow keys move the selection, as in a native radio group; only the
// checked option is in the tab order.
function radioGroup(group, items, isChecked, onPick) {
  const sync = () => {
    for (const el of items) {
      const on = isChecked(el);
      el.setAttribute("aria-checked", String(on));
      el.tabIndex = on ? 0 : -1;
    }
    if (!items.some((el) => el.tabIndex === 0) && items[0]) items[0].tabIndex = 0;
  };
  items.forEach((el, i) => {
    el.addEventListener("click", () => { onPick(el); sync(); });
    el.addEventListener("keydown", (e) => {
      const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[e.key];
      if (!step) return;
      e.preventDefault();
      const target = items[(i + step + items.length) % items.length];
      target.focus();
      onPick(target);
      sync();
    });
  });
  sync();
  return sync;
}

function buildEngines() {
  const group = $("[data-engines]");
  group.textContent = "";
  for (const e of state.engines) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "choice";
    b.setAttribute("role", "radio");
    b.dataset.id = e.id;
    const tile = document.createElement("img");
    tile.className = "logo-tile";
    tile.src = `/logos/${e.id}.png`;
    tile.width = 36;
    tile.height = 36;
    tile.alt = "";
    const text = document.createElement("span");
    text.className = "choice-text";
    const name = document.createElement("strong");
    name.textContent = e.name;
    const note = document.createElement("span");
    note.textContent = e.note;
    text.append(name, note);
    const radio = document.createElement("span");
    radio.className = "radio";
    radio.setAttribute("aria-hidden", "true");
    b.append(tile, text, radio);
    group.append(b);
  }
  radioGroup(group, $$(".choice", group), (el) => el.dataset.id === state.engine, (el) => {
    state.engine = el.dataset.id;
    apply({ engine: el.dataset.id });
    updateSuggestNote();
  });
}

function buildLook() {
  const schemes = $("[data-schemes]");
  radioGroup(schemes, $$("button", schemes), (el) => Number(el.dataset.value) === state.scheme, (el) => {
    state.scheme = Number(el.dataset.value);
    paintTheme();
    apply({ scheme: state.scheme });
  });

  const accents = $("[data-accents]");
  accents.textContent = "";
  for (const a of state.accents) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "swatch";
    b.setAttribute("role", "radio");
    b.dataset.id = a.id;
    if (a.color) b.style.setProperty("--chip", a.color);
    if (a.color) b.style.setProperty("--chip-ring", a.color);
    const chip = document.createElement("span");
    chip.className = "chip";
    chip.setAttribute("aria-hidden", "true");
    const label = document.createElement("span");
    label.textContent = a.name;
    b.append(chip, label);
    accents.append(b);
  }
  radioGroup(accents, $$(".swatch", accents), (el) => el.dataset.id === state.accent, (el) => {
    state.accent = el.dataset.id;
    paintTheme();
    apply({ accent: state.accent });
  });
}

function engineName() {
  return state.engines.find((e) => e.id === state.engine)?.name || "your search engine";
}

function updateSuggestNote() {
  $("[data-suggest-note]").textContent =
    `Sends what you type in the address bar to ${engineName()}, as you type.`;
}

function buildToggles() {
  for (const input of $$("[data-pref]")) {
    input.checked = Boolean(state[input.dataset.pref]);
    input.addEventListener("change", () => apply({ [input.dataset.pref]: input.checked }));
  }
  updateSuggestNote();
}

function buildActions() {
  for (const b of $$("[data-open]")) {
    b.addEventListener("click", () => api("/open", { url: b.dataset.open }));
  }
}

function buildSummary() {
  const rows = [
    ["Search", engineName()],
    ["Look", `${SCHEMES[state.scheme] || "System"} · ${state.accents.find((a) => a.id === state.accent)?.name || "Custom"}`],
    ["Suggestions", state.suggest ? "On" : "Off"],
    ["Startup", state.restore ? "Reopen tabs" : "New tab"],
    ["JavaScript", state.fastJs ? "Fast everywhere" : "Fast per site"],
  ];
  const dl = $("[data-summary]");
  dl.textContent = "";
  for (const [k, v] of rows) {
    const dt = document.createElement("dt");
    dt.textContent = k;
    const dd = document.createElement("dd");
    dd.textContent = v;
    dl.append(dt, dd);
  }
}

/* ---------------------------------------------------------------- steps */

function show(index, direction) {
  const from = steps[current];
  const to = steps[index];
  current = index;
  if (from !== to) {
    from.hidden = true;
    from.classList.remove("enter-fwd", "enter-back");
  }
  to.hidden = false;
  to.classList.remove("enter-fwd", "enter-back");
  void to.offsetWidth; // restart the entrance animation
  if (direction) to.classList.add(direction > 0 ? "enter-fwd" : "enter-back");
  bars.forEach((b, i) => b.classList.toggle("is-done", i <= index));
  back.hidden = index === 0 || index === steps.length - 1;
  skip.hidden = index !== 0;
  nextLabel.textContent = LABELS[index];
  if (index === steps.length - 1) buildSummary();
  $(".title", to).focus({ preventScroll: true });
}

async function finish() {
  next.disabled = true;
  await pending;
  await api("/setup/done");
  closeSetup();
}

// In its own window, the browser closes it. Opened by typing tobari://welcome
// into a tab instead, the tab closes itself.
async function closeSetup() {
  await api("/setup/close");
  window.close();
}

next.addEventListener("click", () => {
  if (current === steps.length - 1) finish();
  else show(current + 1, 1);
});
back.addEventListener("click", () => show(current - 1, -1));
skip.addEventListener("click", finish);
document.addEventListener("keydown", (e) => {
  if (e.key === "Enter" && e.target === document.body) next.click();
  if (e.key === "Escape") finish();
});
// Closing setup keeps whatever was chosen so far and does not ask again.
$("[data-close]").addEventListener("click", finish);

/* ---------------------------------------------------------------- start */

async function start() {
  // The window can open while the browser is still busy starting; give the
  // first answer a moment before falling back.
  for (let i = 0; i < 8 && !state; i++) {
    state = await api("/setup/state");
    if (!state) await new Promise((r) => setTimeout(r, 250 * (i + 1)));
  }
  if (!state) {
    status.textContent = "Tobari's settings bridge did not answer. Defaults are in place; you can change them in Settings.";
    next.addEventListener("click", closeSetup, { once: true });
    return;
  }
  buildEngines();
  buildLook();
  buildToggles();
  buildActions();
  paintTheme();
  show(0, 0);
}

start();
