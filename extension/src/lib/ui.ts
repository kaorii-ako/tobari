import { icons, IconName } from "./icons";

export const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T;

export function h<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, any> = {},
  ...children: (Node | string | null | undefined | false)[]
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === null || v === false) continue;
    if (k === "class") el.className = v;
    else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
    else if (k === "html") el.innerHTML = v;
    else el.setAttribute(k, v === true ? "" : String(v));
  }
  for (const c of children) if (c !== null && c !== undefined && c !== false) el.append(c);
  return el;
}

export function icon(name: IconName): HTMLSpanElement {
  const s = document.createElement("span");
  s.style.display = "contents";
  s.innerHTML = icons[name];
  return s;
}

export function setIcon(el: HTMLElement | null, name: IconName) {
  if (el) el.innerHTML = icons[name];
}

export function favicon(url?: string, fallback: IconName = "globe"): HTMLElement {
  if (url && /^(https?|data|chrome-extension):/.test(url)) {
    const img = h("img", { src: url, alt: "", referrerpolicy: "no-referrer" });
    img.onerror = () => img.replaceWith(icon(fallback));
    return img;
  }
  return icon(fallback);
}

export function toast(text: string, ms = 2200) {
  const t = h("div", { class: "toast", role: "status" }, text);
  document.body.append(t);
  setTimeout(() => t.remove(), ms);
}

export type MenuItem = { group?: string; label: string; hint?: string; icon?: IconName; img?: string; run: () => void };

export function showMenu(menu: HTMLElement, items: MenuItem[], onClose?: () => void): { move: (d: number) => void; pick: () => void; close: () => void } {
  menu.innerHTML = "";
  let idx = 0;
  let lastGroup = "";
  const rows: HTMLElement[] = [];
  items.forEach((it, i) => {
    if (it.group && it.group !== lastGroup) {
      menu.append(h("div", { class: "group" }, it.group));
      lastGroup = it.group;
    }
    const row = h(
      "div",
      { class: "item" + (i === 0 ? " on" : ""), role: "option", onmousedown: (e: Event) => { e.preventDefault(); close(); it.run(); } },
      it.img ? favicon(it.img, it.icon ?? "globe") : it.icon ? icon(it.icon) : null,
      h("span", { class: "label" }, it.label),
      it.hint ? h("span", { class: "hint" }, it.hint) : null,
    );
    row.addEventListener("mouseenter", () => setOn(i));
    rows.push(row);
    menu.append(row);
  });
  if (items.length === 0) menu.append(h("div", { class: "group" }, "Nothing matches"));
  menu.hidden = false;
  function setOn(i: number) {
    rows[idx]?.classList.remove("on");
    idx = (i + rows.length) % Math.max(rows.length, 1);
    rows[idx]?.classList.add("on");
    rows[idx]?.scrollIntoView({ block: "nearest" });
  }
  function close() {
    menu.hidden = true;
    onClose?.();
  }
  return {
    move: (d: number) => setOn(idx + d),
    pick: () => {
      const it = items[idx];
      close();
      it?.run();
    },
    close,
  };
}

export function autosize(t: HTMLTextAreaElement) {
  t.style.height = "auto";
  t.style.height = `${Math.min(t.scrollHeight, 180)}px`;
}
