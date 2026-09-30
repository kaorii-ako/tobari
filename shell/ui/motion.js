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

const registry = new Map();
const gsap = window.gsap;

let sleepTimer = null;

export function wake() {
  if (sleepTimer) { clearTimeout(sleepTimer); sleepTimer = null; }
  gsap.ticker.wake();
}

export function settle() {
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

export function track(key, tween) {
  kill(key);
  registry.set(key, tween);
  return tween;
}

export function kill(key) {
  const existing = registry.get(key);
  if (existing) {
    existing.kill();
    registry.delete(key);
  }
}

export function killPrefix(prefix) {
  for (const key of [...registry.keys()]) {
    if (key.startsWith(prefix)) kill(key);
  }
}

export function killAll() {
  for (const tween of registry.values()) tween.kill();
  registry.clear();
}
