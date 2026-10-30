import { $ } from "./lib/ui";
import { enterList } from "./lib/motion";

const params = new URLSearchParams(location.search);
const win = params.get("window") ?? "";
const q = win ? `&window=${win}` : "";
$<HTMLIFrameElement>("#side").src = `sidepanel.html?mode=tabs${q}`;
$<HTMLIFrameElement>("#assist").src = `sidepanel.html?mode=ask${q}`;
$<HTMLIFrameElement>("#page-a").src = params.get("url") ?? "newtab.html";
const split = params.get("split");
if (split) {
  $("#pane-b").hidden = false;
  $<HTMLIFrameElement>("#page-b").src = split;
}

const grid = $("#win");
let dragging = false;
$("#gutter").addEventListener("pointerdown", (e) => {
  dragging = true;
  (e.target as HTMLElement).setPointerCapture(e.pointerId);
});
addEventListener("pointermove", (e) => {
  if (!dragging) return;
  const w = Math.min(560, Math.max(300, innerWidth - e.clientX - 8));
  grid.style.setProperty("--assist", `${w}px`);
});
addEventListener("pointerup", () => (dragging = false));

enterList(document.querySelectorAll(".side, .pane:not([hidden]), .assist"), { y: 6, stagger: 0.05 });
