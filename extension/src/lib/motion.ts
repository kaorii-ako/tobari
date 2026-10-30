import { gsap } from "gsap";
import { Flip } from "gsap/Flip";

gsap.registerPlugin(Flip);

const EASE = "power3.out";
const query = matchMedia("(prefers-reduced-motion: reduce)");
export const reduced = () => query.matches || document.visibilityState === "hidden";

gsap.defaults({ ease: EASE, duration: 0.2 });

function safe<T extends gsap.core.Animation>(anim: T): T {
  const ms = anim.totalDuration() * 1000 + (anim.delay?.() ?? 0) * 1000 + 150;
  setTimeout(() => {
    if (anim.progress() < 1) anim.progress(1);
  }, ms);
  return anim;
}

export function enter(el: Element | null | undefined, opts: { y?: number; delay?: number; scale?: number } = {}) {
  if (!el || reduced()) return;
  safe(gsap.fromTo(
    el,
    { opacity: 0, y: opts.y ?? 6, scale: opts.scale ?? 1 },
    { opacity: 1, y: 0, scale: 1, duration: 0.24, delay: opts.delay ?? 0, clearProps: "opacity,transform" },
  ));
}

export function enterList(els: ArrayLike<Element>, opts: { y?: number; stagger?: number; delay?: number } = {}) {
  const list = Array.from(els).slice(0, 12);
  if (!list.length || reduced()) return;
  safe(gsap.fromTo(
    list,
    { opacity: 0, y: opts.y ?? 8 },
    { opacity: 1, y: 0, duration: 0.32, stagger: opts.stagger ?? 0.035, delay: opts.delay ?? 0, clearProps: "opacity,transform" },
  ));
}

export function pop(el: Element | null | undefined) {
  if (!el || reduced()) return;
  safe(gsap.fromTo(el, { opacity: 0, scale: 0.88 }, { opacity: 1, scale: 1, duration: 0.18, clearProps: "opacity,transform" }));
}

export function popover(el: HTMLElement, from: "top" | "bottom" = "top") {
  if (reduced()) return;
  safe(gsap.fromTo(
    el,
    { opacity: 0, scale: 0.97, y: from === "top" ? -4 : 4, transformOrigin: from === "top" ? "50% 0%" : "50% 100%" },
    { opacity: 1, scale: 1, y: 0, duration: 0.16, clearProps: "opacity,transform" },
  ));
}

export function leave(el: Element, done: () => void) {
  if (reduced()) return done();
  safe(gsap.to(el, { opacity: 0, y: 4, duration: 0.12, ease: "power2.in", onComplete: done }));
}

export function slideThumb(thumb: HTMLElement, target: HTMLElement, instant = false) {
  const x = target.offsetLeft;
  const w = target.offsetWidth;
  if (instant || reduced()) gsap.set(thumb, { x, width: w });
  else safe(gsap.to(thumb, { x, width: w, duration: 0.26, ease: "power3.inOut" }));
}

export function followPill(pill: HTMLElement, row: HTMLElement, instant = false) {
  const y = row.offsetTop;
  if (instant || reduced()) gsap.set(pill, { y, opacity: 1 });
  else safe(gsap.to(pill, { y, opacity: 1, duration: 0.14, ease: "power2.out", overwrite: true }));
}

export function crossfade(out: HTMLElement | null, inn: HTMLElement, dir: 1 | -1) {
  if (reduced()) return;
  if (out) gsap.set(out, { clearProps: "all" });
  safe(gsap.fromTo(inn, { opacity: 0, x: 10 * dir }, { opacity: 1, x: 0, duration: 0.22, clearProps: "opacity,transform" }));
}

export function flipState(targets: string | Element[]) {
  return reduced() ? null : Flip.getState(targets);
}

export function flipFrom(state: ReturnType<typeof Flip.getState> | null, targets: string | Element[]) {
  if (!state) return;
  safe(Flip.from(state, {
    targets,
    duration: 0.26,
    ease: "power3.inOut",
    nested: true,
    prune: true,
    onEnter: (els) => safe(gsap.fromTo(els, { opacity: 0, x: -6 }, { opacity: 1, x: 0, duration: 0.2, clearProps: "opacity,transform" })),
  }));
}

export function toastIn(el: HTMLElement, ms: number) {
  if (reduced()) {
    setTimeout(() => el.remove(), ms);
    return;
  }
  safe(gsap
    .timeline({ onComplete: () => el.remove() })
    .fromTo(el, { opacity: 0, y: 14, scale: 0.96 }, { opacity: 1, y: 0, scale: 1, duration: 0.26, ease: "back.out(1.4)" })
    .to(el, { opacity: 0, y: 6, duration: 0.18, ease: "power2.in" }, `+=${ms / 1000}`));
}

export function shake(el: Element) {
  if (reduced()) return;
  gsap.fromTo(el, { x: 0 }, { keyframes: { x: [0, -4, 4, -3, 3, 0] }, duration: 0.32, ease: "none" });
}

export function pulse(el: Element) {
  if (reduced()) return;
  gsap.fromTo(el, { scale: 1 }, { scale: 1.06, duration: 0.12, yoyo: true, repeat: 1, ease: "power1.out" });
}

export function growHeight(el: HTMLElement) {
  if (reduced()) return;
  const h = el.offsetHeight;
  safe(gsap.fromTo(el, { height: 0, opacity: 0 }, { height: h, opacity: 1, duration: 0.24, clearProps: "height,opacity" }));
}

export { gsap };

document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") gsap.globalTimeline.getChildren(true, true, false).forEach((t) => t.progress(1));
});
