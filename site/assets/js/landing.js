// Scroll choreography for the landing page. The load sequence is CSS
// (landing.css); this file only adds motion that depends on scroll position.
//
// Rules it keeps:
// - transform and opacity only;
// - nothing is hidden unless this script has run and will reveal it;
// - under prefers-reduced-motion none of it is created, and the page is the
//   static layout;
// - GSAP's ticker sleeps when nothing moves (motion.js), so scrolling wakes
//   it and it settles again shortly after.

import { gsap, wake, settle } from "./motion.js";

const ST = window.ScrollTrigger;

function boot() {
  if (!gsap || !ST) return;
  gsap.registerPlugin(ST);

  // Scroll wakes the ticker for scrubbed tweens; settle() puts it back to
  // sleep once every tween has finished.
  window.addEventListener("scroll", () => { wake(); settle(); }, { passive: true });

  const mm = gsap.matchMedia();
  mm.add("(prefers-reduced-motion: no-preference)", () => {
    heroStage();
    readout();
    tour();
    statement();
    batches();
    finale();
    ST.refresh();
    settle();
  });
}

// The hero screenshot recedes a little as it scrolls away, so the page reads
// as moving past it rather than over it.
function heroStage() {
  const shot = document.querySelector(".shot-hero");
  if (!shot) return;
  gsap.to(shot, {
    scale: 0.94,
    opacity: 0.55,
    ease: "none",
    scrollTrigger: { trigger: shot, start: "top 12%", end: "bottom top", scrub: 0.6 },
  });
}

// Figures count up once, from zero, when they first come into view. Tabular
// numerals keep the width steady while they change.
function readout() {
  const list = document.querySelector(".readout-list");
  if (!list) return;
  const cells = [...list.children];
  const counters = [...list.querySelectorAll("[data-count]")];
  gsap.set(cells, { opacity: 0, y: 18 });
  ST.create({
    trigger: list,
    start: "top 85%",
    once: true,
    onEnter: () => {
      wake();
      gsap.to(cells, { opacity: 1, y: 0, duration: 0.8, ease: "power3.out", stagger: 0.06, clearProps: "transform" });
      for (const el of counters) {
        const target = parseFloat(el.dataset.count);
        const decimals = parseInt(el.dataset.decimals || "0", 10);
        const state = { v: 0 };
        gsap.to(state, {
          v: target,
          duration: 1.1,
          ease: "power3.out",
          onUpdate: () => {
            const n = Math.abs(state.v).toFixed(decimals);
            el.textContent = (state.v < 0 || (target < 0 && state.v === 0) ? "−" : "") + n;
          },
        });
      }
      settle();
    },
  });
}

// Tour screenshots settle into place on the way in and dim on the way out.
function tour() {
  for (const item of document.querySelectorAll("[data-tour]")) {
    const frame = item.querySelector(".bezel");
    gsap.fromTo(frame, { scale: 0.92, opacity: 0.4 }, {
      scale: 1,
      opacity: 1,
      ease: "none",
      scrollTrigger: { trigger: item, start: "top bottom", end: "top 45%", scrub: 0.5 },
    });
    gsap.to(frame, {
      opacity: 0.35,
      ease: "none",
      immediateRender: false,
      scrollTrigger: { trigger: item, start: "bottom 40%", end: "bottom top", scrub: 0.5 },
    });
  }
}

// The statement is read word by word as it scrolls through the viewport.
function statement() {
  const p = document.querySelector("[data-words]");
  if (!p) return;
  const words = p.textContent.trim().split(/\s+/);
  p.textContent = "";
  const full = document.createElement("span");
  full.className = "visually-hidden";
  full.textContent = words.join(" ");
  p.append(full);
  const spans = words.map((w, i) => {
    const s = document.createElement("span");
    s.className = "wd";
    s.setAttribute("aria-hidden", "true");
    s.textContent = w;
    p.append(s, i < words.length - 1 ? " " : "");
    return s;
  });
  gsap.fromTo(spans, { opacity: 0.14 }, {
    opacity: 1,
    ease: "none",
    stagger: 0.08,
    scrollTrigger: { trigger: p, start: "top 78%", end: "bottom 42%", scrub: 0.4 },
  });
}

// Groups that arrive together arrive in sequence, once.
function batches() {
  const targets = gsap.utils.toArray(".bento-card, .claims li, .faq details");
  gsap.set(targets, { opacity: 0, y: 24 });
  ST.batch(targets, {
    start: "top 88%",
    once: true,
    onEnter: (batch) => {
      wake();
      gsap.to(batch, { opacity: 1, y: 0, duration: 0.9, ease: "power3.out", stagger: 0.07, clearProps: "transform" });
      settle();
    },
  });
}

// The closing line rises like the opening one; the curtain behind it fades up.
function finale() {
  const title = document.querySelector("[data-finale-title]");
  if (!title) return;
  const words = title.querySelectorAll(".w > span");
  gsap.set(words, { yPercent: 105 });
  ST.create({
    trigger: title,
    start: "top 85%",
    once: true,
    onEnter: () => {
      wake();
      gsap.to(words, { yPercent: 0, duration: 1, ease: "expo.out", stagger: 0.07 });
      settle();
    },
  });
  const curtain = document.querySelector(".finale-curtain");
  if (curtain) {
    gsap.fromTo(curtain, { opacity: 0 }, {
      opacity: 1,
      ease: "none",
      scrollTrigger: { trigger: ".finale", start: "top bottom", end: "center center", scrub: 0.6 },
    });
  }
}

boot();
