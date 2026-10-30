(() => {
  const root = document.documentElement;
  const reduced = matchMedia("(prefers-reduced-motion: reduce)").matches;
  const top = document.querySelector(".top");
  const onScroll = () => top && top.classList.toggle("scrolled", scrollY > 8);
  addEventListener("scroll", onScroll, { passive: true });
  onScroll();

  const reveals = [...document.querySelectorAll(".reveal")];
  const show = (els) => els.forEach((el) => { el.style.removeProperty("opacity"); el.style.removeProperty("transform"); el.classList.remove("reveal"); });

  if (reduced || !window.gsap) return;
  root.classList.add("js");
  const gsap = window.gsap;

  if (window.ScrollTrigger) gsap.registerPlugin(window.ScrollTrigger);
  const heroItems = reveals.filter((el) => el.closest(".hero, .page-head"));
  setTimeout(() => show(heroItems.filter((el) => el.classList.contains("reveal"))), 1600);
  gsap.to(heroItems, { opacity: 1, y: 0, duration: 0.7, stagger: 0.07, ease: "power3.out", onComplete: () => show(heroItems) });

  const rest = reveals.filter((el) => !heroItems.includes(el));
  let queue = [];
  let flushing = false;
  const flush = () => {
    flushing = false;
    const batch = queue;
    queue = [];
    gsap.to(batch, { opacity: 1, y: 0, duration: 0.6, stagger: 0.06, ease: "power3.out", onComplete: () => show(batch) });
    setTimeout(() => show(batch.filter((el) => el.classList.contains("reveal"))), 1400 + batch.length * 60);
  };
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      if (!e.isIntersecting) continue;
      io.unobserve(e.target);
      queue.push(e.target);
    }
    if (queue.length && !flushing) {
      flushing = true;
      requestAnimationFrame(flush);
      setTimeout(() => flushing && flush(), 120);
    }
  }, { rootMargin: "0px 0px -8% 0px" });
  rest.forEach((el) => io.observe(el));
  if (window.ScrollTrigger) {
    const tilt = document.querySelector("[data-tilt]");
    if (tilt) {
      gsap.fromTo(tilt, { rotateX: 14, scale: 0.94, y: 30 }, { rotateX: 0, scale: 1, y: 0, ease: "none", scrollTrigger: { trigger: tilt, start: "top 95%", end: "top 25%", scrub: 0.6 } });
    }
  }
  setTimeout(() => {
    if (window.ScrollTrigger) window.ScrollTrigger.refresh();
  }, 400);
})();
