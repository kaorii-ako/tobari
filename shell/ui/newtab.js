import { parseBang, applyBang, allBangs, bangCount } from "./bangs.js";
import { EASE, DUR, wake, settle, prefersReducedMotion } from "./motion.js";
import { loadPrefs } from "./prefs.js";

const gsap = window.gsap;
const prefs = loadPrefs();
const DEFAULT_SEARCH = "https://duckduckgo.com/?q={}";

const el = (id) => document.getElementById(id);
const ui = {
  wordmark: el("wordmark"), creed: el("creed"), seek: el("seek"), seekInput: el("seekInput"),
  seekBang: el("seekBang"), indexList: el("indexList"), veil: el("veil"),
  statBangs: el("statBangs"), statEngine: el("statEngine"), statTel: el("statTel"),
  scrollCue: el("scrollCue"), creedEl: el("creed"),
};

function applyTheme() {
  const choice = prefs.theme;
  const resolved = choice === "system"
    ? (window.matchMedia("(prefers-color-scheme: light)").matches ? "daybreak" : "night")
    : choice;
  document.documentElement.dataset.theme = resolved;
}
applyTheme();

/* -------------------------------------------------- split-text reveal */

function splitWordmark(node) {
  const text = node.textContent;
  node.replaceChildren();
  const spans = [];
  for (const ch of text) {
    const span = document.createElement("span");
    span.className = "ch";
    span.textContent = ch;
    node.appendChild(span);
    spans.push(span);
  }
  return spans;
}

/* -------------------------------------------------- scramble readout */

const GLYPHS = "0123456789ABCDEFGHJKLMNPQRSTUVWXYZ/\\|<>-_=+*";

function scrambleTo(node, finalText, duration) {
  if (prefersReducedMotion()) { node.textContent = finalText; return; }
  const chars = [...finalText];
  const steps = Math.max(8, Math.round(duration * 60));
  let frame = 0;
  const tick = () => {
    frame += 1;
    const progress = frame / steps;
    node.textContent = chars
      .map((c, i) => (progress * chars.length > i || c === " " ? c : GLYPHS[(frame * 7 + i * 13) % GLYPHS.length]))
      .join("");
    if (frame < steps) requestAnimationFrame(tick);
    else node.textContent = finalText;
  };
  requestAnimationFrame(tick);
}

/* -------------------------------------------------- bang index */

function renderIndex() {
  const frag = document.createDocumentFragment();
  for (const b of allBangs()) {
    const li = document.createElement("li");
    li.className = "index__row";
    const token = document.createElement("span");
    token.className = "index__token";
    token.textContent = `!${b.token}`;
    const name = document.createElement("span");
    name.className = "index__name";
    name.textContent = b.name;
    li.append(token, name);
    attachMagnetic(li);
    frag.appendChild(li);
  }
  ui.indexList.appendChild(frag);
}

function attachMagnetic(node) {
  if (prefersReducedMotion()) return;
  const moveX = gsap.quickTo(node, "x", { duration: 0.35, ease: EASE.out });
  node.addEventListener("pointermove", (e) => {
    const rect = node.getBoundingClientRect();
    moveX(((e.clientX - rect.left) / rect.width - 0.5) * 8);
  });
  node.addEventListener("pointerleave", () => moveX(0));
}

/* -------------------------------------------------- search */

function looksLikeUrl(text) {
  const t = text.trim();
  if (!t || /\s/.test(t)) return false;
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(t)) return true;
  if (/^localhost(:\d+)?(\/|$)/i.test(t)) return true;
  return /^[^\s/]+\.[a-z]{2,}(:\d+)?(\/|$)/i.test(t);
}

ui.seekInput.addEventListener("input", () => {
  const bang = parseBang(ui.seekInput.value);
  if (bang) {
    ui.seekBang.hidden = false;
    ui.seekBang.textContent = `!${bang.token} → ${bang.name}`;
  } else {
    ui.seekBang.hidden = true;
  }
});

ui.seek.addEventListener("submit", (e) => {
  e.preventDefault();
  const raw = ui.seekInput.value.trim();
  if (!raw) return;
  const bang = parseBang(raw);
  let url;
  if (bang && bang.query) url = applyBang(bang, bang.query);
  else if (looksLikeUrl(raw)) url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : `https://${raw}`;
  else if (globalThis.chrome?.search?.query) {
    // The default engine is whatever the user chose at setup or in Settings.
    chrome.search.query({ text: raw, disposition: "CURRENT_TAB" });
    return;
  } else url = DEFAULT_SEARCH.replace("{}", encodeURIComponent(raw));
  location.assign(url);
});

/* -------------------------------------------------- smooth scroll (opt-in) */

let lenis = null;
let lenisRaf = null;

function startLenis() {
  if (lenis || !prefs.smoothScroll || prefersReducedMotion() || !window.Lenis) return;
  lenis = new window.Lenis({ duration: 0.9, smoothWheel: true });
  const loop = (time) => { lenis.raf(time); lenisRaf = requestAnimationFrame(loop); };
  lenisRaf = requestAnimationFrame(loop);
}

function stopLenis() {
  if (lenisRaf) cancelAnimationFrame(lenisRaf);
  lenisRaf = null;
  if (lenis) { lenis.destroy(); lenis = null; }
}

/* -------------------------------------------------- animated veil (opt-in) */

let veil = null;
let veilLoading = false;

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

async function startVeil() {
  if (veil || veilLoading) return;
  if (!prefs.newtabMotion || prefersReducedMotion()) return;
  if (document.hidden || !document.hasFocus()) return;
  veilLoading = true;
  try {
    if (!window.THREE) await loadScript("vendor/three.min.js");
    if (!window.VANTA || !window.VANTA.FOG) await loadScript("vendor/vanta.fog.min.js");
    const light = document.documentElement.dataset.theme === "daybreak";
    veil = window.VANTA.FOG({
      el: ui.veil,
      THREE: window.THREE,
      mouseControls: false,
      touchControls: false,
      gyroControls: false,
      scale: 1,
      highlightColor: light ? 0xe8e4dc : 0x1b1b20,
      midtoneColor: light ? 0xf2f1ee : 0x141418,
      lowlightColor: light ? 0xffffff : 0x0a0a0c,
      baseColor: light ? 0xfaf9f7 : 0x0a0a0c,
      blurFactor: 0.62,
      speed: 0.7,
      zoom: 0.5,
    });
    gsap.to(ui.veil, { opacity: 1, duration: DUR.d4, ease: EASE.out });
  } catch {
    ui.veil.style.display = "none";
  } finally {
    veilLoading = false;
  }
}

function stopVeil() {
  if (!veil) return;
  veil.destroy();
  veil = null;
  gsap.set(ui.veil, { opacity: 0 });
}

/* -------------------------------------------------- visibility discipline */

function suspend() { stopVeil(); stopLenis(); }
function resume() { startLenis(); startVeil(); }

document.addEventListener("visibilitychange", () => (document.hidden ? suspend() : resume()));
window.addEventListener("blur", suspend);
window.addEventListener("focus", resume);
window.addEventListener("pagehide", suspend);

/* -------------------------------------------------- boot */

renderIndex();

const chars = splitWordmark(ui.wordmark);
if (prefersReducedMotion()) {
  ui.statBangs.textContent = String(bangCount());
  ui.statEngine.textContent = "chromium";
  ui.statTel.textContent = "none";
} else {
  wake();
  gsap.from(chars, { yPercent: 110, opacity: 0, duration: DUR.d4, ease: EASE.snap, stagger: 0.035, clearProps: "transform" });
  gsap.from(ui.creed, { opacity: 0, y: 6, duration: DUR.d3, ease: EASE.out, delay: 0.18, clearProps: "transform" });
  gsap.from(ui.seek, { opacity: 0, y: 8, duration: DUR.d3, ease: EASE.out, delay: 0.26, clearProps: "transform" });
  gsap.from(ui.scrollCue, { opacity: 0, duration: DUR.d3, ease: EASE.out, delay: 0.5, onComplete: settle });
  setTimeout(() => {
    scrambleTo(ui.statBangs, String(bangCount()), 0.5);
    scrambleTo(ui.statEngine, "chromium", 0.6);
    scrambleTo(ui.statTel, "none", 0.45);
  }, 380);
}

ui.seekInput.focus();
resume();

/* -------------------------------------------------- setup window */
// Opens tobari://welcome in its own window. The browser answers this one
// request from the new tab and nothing else.
document.getElementById("setupLink")?.addEventListener("click", () => {
  fetch("https://tobari.internal/setup/show", {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: "{}",
    cache: "no-store",
  }).catch(() => {});
});
