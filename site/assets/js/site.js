import { gsap, animate, DUR, EASE, prefersReducedMotion, onReducedMotionChange } from "./motion.js";

/* -------------------------------------------------------------- reveals */
// Transform and opacity only. Each element animates once, then nothing runs.

function revealAll(nodes) {
  for (const el of nodes) el.classList.add("is-revealed");
}

function setupReveals() {
  const nodes = [...document.querySelectorAll("[data-reveal]")];
  if (!nodes.length) return;

  if (!gsap || prefersReducedMotion() || !("IntersectionObserver" in window)) {
    revealAll(nodes);
    return;
  }

  const pending = new Set();
  let flushQueued = false;

  const flush = () => {
    flushQueued = false;
    const batch = [...pending];
    pending.clear();
    if (!batch.length) return;
    batch.sort((a, b) => (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
    animate(() =>
      gsap.fromTo(
        batch,
        { opacity: 0, y: 14 },
        {
          opacity: 1,
          y: 0,
          duration: DUR.d4,
          ease: EASE.out,
          stagger: DUR.d1 * 0.5,
          clearProps: "transform",
          onComplete: () => revealAll(batch),
        },
      ),
    );
  };

  const io = new IntersectionObserver(
    (entries) => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        io.unobserve(entry.target);
        pending.add(entry.target);
      }
      if (pending.size && !flushQueued) {
        flushQueued = true;
        queueMicrotask(flush);
      }
    },
    { rootMargin: "0px 0px -8% 0px", threshold: 0.08 },
  );

  // What is already on screen at load animates now rather than waiting for
  // the observer's first callback; the rest waits until it is scrolled to.
  const fold = window.innerHeight;
  for (const el of nodes) {
    const box = el.getBoundingClientRect();
    if (box.top < fold && box.bottom > 0) pending.add(el);
    else io.observe(el);
  }
  if (pending.size) flush();

  // Turning reduced motion on mid-visit shows everything immediately.
  onReducedMotionChange(() => {
    if (!prefersReducedMotion()) return;
    io.disconnect();
    revealAll(nodes);
    if (gsap) gsap.set(nodes, { opacity: 1, clearProps: "transform" });
  });
}

/* -------------------------------------------------------------- smooth scroll */
// Landing page only. Lenis is driven by a frame loop that exists only while a
// scroll is in flight; when Lenis reports it has stopped, the loop ends.

let lenis = null;
let lenisFrame = null;
let lenisIdle = 0;

function lenisTick(time) {
  lenis.raf(time);
  if (lenis.isScrolling) {
    lenisIdle = 0;
  } else if (++lenisIdle > 3) {
    lenisFrame = null;
    return;
  }
  lenisFrame = requestAnimationFrame(lenisTick);
}

function kickLenis() {
  if (!lenis) return;
  lenisIdle = 0;
  if (!lenisFrame) lenisFrame = requestAnimationFrame(lenisTick);
}

const lenisEvents = ["wheel", "touchstart", "touchmove", "pointerdown", "keydown", "click"];

function startLenis() {
  if (lenis || prefersReducedMotion() || !window.Lenis) return;
  lenis = new window.Lenis({
    duration: DUR.d4 * 2.4,
    easing: (t) => 1 - Math.pow(1 - t, 3),
    smoothWheel: true,
    anchors: false,
  });
  for (const type of lenisEvents) window.addEventListener(type, kickLenis, { passive: true });
}

function stopLenis() {
  if (lenisFrame) cancelAnimationFrame(lenisFrame);
  lenisFrame = null;
  if (!lenis) return;
  for (const type of lenisEvents) window.removeEventListener(type, kickLenis);
  lenis.destroy();
  lenis = null;
}

/* -------------------------------------------------------------- fog (opt-in) */
// Off by default. three.js (615 KB) is only fetched after the visitor turns
// the fog on. The effect is destroyed, not paused, on blur or tab-hide,
// because Vanta has no frame-rate cap. The choice is remembered per browser.

const FOG_KEY = "tobari-site:fog";

function readFogPref() {
  try { return window.localStorage.getItem(FOG_KEY) === "on"; } catch { return false; }
}

function writeFogPref(on) {
  try {
    if (on) window.localStorage.setItem(FOG_KEY, "on");
    else window.localStorage.removeItem(FOG_KEY);
  } catch { /* storage unavailable: the choice lasts for this page view */ }
}

function tokenColour(name) {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  const hex = raw.replace("#", "");
  return /^[0-9a-f]{6}$/i.test(hex) ? parseInt(hex, 16) : 0;
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = src;
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error(`failed to load ${src}`));
    document.head.appendChild(s);
  });
}

const fog = {
  wanted: false,
  effect: null,
  loading: false,
  el: null,
  button: null,
};

function fogAllowed() {
  return fog.wanted && !prefersReducedMotion() && !document.hidden && document.hasFocus();
}

async function startFog() {
  if (fog.effect || fog.loading || !fogAllowed()) return;
  fog.loading = true;
  try {
    if (!window.THREE) await loadScript(new URL("../vendor/three.min.js", import.meta.url).href);
    if (!window.VANTA || !window.VANTA.FOG) await loadScript(new URL("../vendor/vanta.fog.min.js", import.meta.url).href);
    if (!fogAllowed()) return;
    fog.effect = window.VANTA.FOG({
      el: fog.el,
      THREE: window.THREE,
      mouseControls: false,
      touchControls: false,
      gyroControls: false,
      scale: 1,
      scaleMobile: 1,
      baseColor: tokenColour("--ink-000"),
      lowlightColor: tokenColour("--ink-050"),
      midtoneColor: tokenColour("--ink-200"),
      highlightColor: tokenColour("--line-firm"),
      blurFactor: 0.62,
      speed: 0.6,
      zoom: 0.5,
    });
    if (gsap) animate(() => gsap.to(fog.el, { opacity: 1, duration: DUR.d4, ease: EASE.out }));
    else fog.el.style.opacity = "1";
  } catch {
    fog.wanted = false;
    syncFogButton("unavailable");
  } finally {
    fog.loading = false;
  }
}

function stopFog() {
  if (!fog.effect) return;
  fog.effect.destroy();
  fog.effect = null;
  if (gsap) gsap.set(fog.el, { opacity: 0 });
  else fog.el.style.opacity = "0";
}

function syncFogButton(override) {
  const state = fog.button.querySelector("[data-fog-state]");
  if (prefersReducedMotion()) {
    fog.button.disabled = true;
    fog.button.setAttribute("aria-pressed", "false");
    state.textContent = "off (reduced motion)";
    return;
  }
  fog.button.disabled = false;
  fog.button.setAttribute("aria-pressed", String(fog.wanted));
  state.textContent = override || (fog.wanted ? "on" : "off");
}

function setupFog() {
  fog.el = document.querySelector("[data-fog]");
  fog.button = document.querySelector("[data-fog-toggle]");
  if (!fog.el || !fog.button) return;

  fog.wanted = readFogPref();
  fog.button.hidden = false;
  syncFogButton();

  fog.button.addEventListener("click", () => {
    fog.wanted = !fog.wanted;
    writeFogPref(fog.wanted);
    syncFogButton();
    if (fog.wanted) startFog();
    else stopFog();
  });

  const suspend = () => stopFog();
  const resume = () => startFog();
  document.addEventListener("visibilitychange", () => (document.hidden ? suspend() : resume()));
  window.addEventListener("blur", suspend);
  window.addEventListener("focus", resume);
  window.addEventListener("pagehide", suspend);

  onReducedMotionChange(() => {
    syncFogButton();
    if (prefersReducedMotion()) stopFog();
    else startFog();
  });

  // Colours come from the tokens, so a theme change rebuilds the effect.
  window.matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
    if (!fog.effect) return;
    stopFog();
    startFog();
  });

  startFog();
}

/* -------------------------------------------------------------- copy */
// <button data-copy="#id"> copies the text of #id. The button is hidden in the
// markup and shown here, so it never appears where it cannot work.

function setupCopy() {
  for (const button of document.querySelectorAll("[data-copy]")) {
    const target = document.querySelector(button.dataset.copy);
    if (!target || !navigator.clipboard) continue;
    const label = button.querySelector("[data-copy-label]") || button;
    const idle = label.textContent;
    let timer = null;
    button.hidden = false;
    button.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(target.textContent.trim());
        label.textContent = "Copied";
      } catch {
        label.textContent = "Select and copy";
      }
      button.dataset.state = "done";
      clearTimeout(timer);
      timer = setTimeout(() => {
        label.textContent = idle;
        delete button.dataset.state;
      }, 1800);
    });
  }
}

/* -------------------------------------------------------------- tabs */
// [data-tabs] holds role=tab buttons that control role=tabpanel siblings.
// Without script every panel shows, stacked, which reads fine.

function setupTabs() {
  for (const root of document.querySelectorAll("[data-tabs]")) {
    const tabs = [...root.querySelectorAll('[role="tab"]')];
    const panels = tabs.map((t) => document.getElementById(t.getAttribute("aria-controls")));
    if (!tabs.length || panels.some((p) => !p)) continue;
    root.dataset.ready = "true";
    const select = (i, focus) => {
      tabs.forEach((t, j) => {
        const on = i === j;
        t.setAttribute("aria-selected", String(on));
        t.tabIndex = on ? 0 : -1;
        panels[j].hidden = !on;
      });
      if (focus) tabs[i].focus();
    };
    tabs.forEach((t, i) => {
      t.addEventListener("click", () => select(i, false));
      t.addEventListener("keydown", (e) => {
        const step = e.key === "ArrowRight" ? 1 : e.key === "ArrowLeft" ? -1 : 0;
        if (e.key === "Home") select(0, true);
        else if (e.key === "End") select(tabs.length - 1, true);
        else if (step) select((i + step + tabs.length) % tabs.length, true);
        else return;
        e.preventDefault();
      });
    });
    select(0, false);
  }
}

/* -------------------------------------------------------------- nav */
// The island gains a shadow once content scrolls beneath it. On narrow
// screens the links live in a sheet; Escape and link clicks close it and
// focus returns to the toggle.

function setupNav() {
  const header = document.querySelector("[data-nav]");
  const toggle = document.querySelector("[data-nav-toggle]");
  const sheet = document.querySelector("[data-nav-sheet]");
  if (!header) return;

  let scrolled = null;
  const sync = () => {
    const now = window.scrollY > 8;
    if (now !== scrolled) header.dataset.scrolled = String((scrolled = now));
  };
  sync();
  window.addEventListener("scroll", sync, { passive: true });

  if (!toggle || !sheet) return;
  const setOpen = (open, restoreFocus) => {
    toggle.setAttribute("aria-expanded", String(open));
    sheet.dataset.open = String(open);
    document.documentElement.style.overflow = open ? "hidden" : "";
    if (open) sheet.querySelector("a")?.focus({ preventScroll: true });
    else if (restoreFocus) toggle.focus();
  };
  toggle.addEventListener("click", () => setOpen(toggle.getAttribute("aria-expanded") !== "true", true));
  sheet.addEventListener("click", (e) => { if (e.target.closest("a")) setOpen(false, false); });
  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && sheet.dataset.open === "true") setOpen(false, true);
  });
  window.matchMedia("(min-width: 961px)").addEventListener("change", (m) => { if (m.matches) setOpen(false, false); });
}

/* -------------------------------------------------------------- boot */

setupNav();
setupReveals();
setupCopy();
setupTabs();

if (document.body.dataset.page === "home") {
  startLenis();
  onReducedMotionChange(() => (prefersReducedMotion() ? stopLenis() : startLenis()));
  setupFog();
}
