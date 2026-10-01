// Ported from shell/ui/motion.js. Durations are read from the CSS tokens, so
// under prefers-reduced-motion every duration is 0 and motion becomes a state
// change. The GSAP ticker is put to sleep whenever the global timeline is
// empty: GSAP otherwise holds a requestAnimationFrame loop open forever.

const root = document.documentElement;

function readMs(name) {
  const raw = getComputedStyle(root).getPropertyValue(name).trim();
  const value = parseFloat(raw);
  return Number.isFinite(value) ? value : 0;
}

export const EASE = {
  out: "power2.out",
  in: "power2.in",
  inOut: "power2.inOut",
  snap: "power3.out",
};

export const DUR = { d0: 0, d1: 0, d2: 0, d3: 0, d4: 0 };

export function refreshMotionTokens() {
  DUR.d0 = 0;
  DUR.d1 = readMs("--dur-1") / 1000;
  DUR.d2 = readMs("--dur-2") / 1000;
  DUR.d3 = readMs("--dur-3") / 1000;
  DUR.d4 = readMs("--dur-4") / 1000;
}

refreshMotionTokens();

const reduced = window.matchMedia("(prefers-reduced-motion: reduce)");
reduced.addEventListener("change", refreshMotionTokens);

export function prefersReducedMotion() {
  return reduced.matches;
}

export function onReducedMotionChange(fn) {
  reduced.addEventListener("change", fn);
}

export const gsap = window.gsap || null;

let sleepTimer = null;

export function wake() {
  if (!gsap) return;
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  gsap.ticker.wake();
}

export function settle() {
  if (!gsap) return;
  if (sleepTimer) clearTimeout(sleepTimer);
  sleepTimer = setTimeout(() => {
    sleepTimer = null;
    if (gsap.globalTimeline.getChildren(true, true, false).length === 0) {
      gsap.ticker.sleep();
    } else {
      settle();
    }
  }, 220);
}

export function animate(fn) {
  wake();
  const result = fn();
  settle();
  return result;
}

// Nothing has animated yet, so nothing needs a frame loop.
if (gsap) gsap.ticker.sleep();
