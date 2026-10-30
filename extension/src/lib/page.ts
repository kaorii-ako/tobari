export type PageElement = { ref: number; tag: string; role: string; label: string; type: string };
export type PageRead = {
  title: string;
  url: string;
  lang: string;
  text: string;
  selection: string;
  elements: PageElement[];
  mcp: string | null;
  truncated: boolean;
};

export function readPageInPage(maxChars: number): PageRead {
  const root = (document.querySelector("article, main, [role=main]") as HTMLElement | null) ?? document.body;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, noscript, template, svg, nav, footer, aside, [aria-hidden=true], [hidden]").forEach((n) => n.remove());
  const stage = document.createElement("div");
  stage.style.cssText = `position:fixed;left:-100000px;top:0;width:${Math.max(document.documentElement.clientWidth, 800)}px;contain:strict;height:1px;overflow:hidden`;
  stage.append(clone);
  document.documentElement.append(stage);
  const raw = (clone.innerText || clone.textContent || "").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
  stage.remove();
  const sel = String(window.getSelection?.() ?? "").trim();
  const items: PageElement[] = [];
  document.querySelectorAll("[data-tobari-ref]").forEach((n) => n.removeAttribute("data-tobari-ref"));
  const candidates = document.querySelectorAll<HTMLElement>(
    "a[href], button, input:not([type=hidden]), textarea, select, [role=button], [role=link], [role=tab], [role=menuitem], [contenteditable=true], summary",
  );
  let ref = 0;
  for (const el of Array.from(candidates)) {
    if (items.length >= 200) break;
    const r = el.getBoundingClientRect();
    const style = getComputedStyle(el);
    if (r.width < 2 || r.height < 2 || style.visibility === "hidden" || style.display === "none") continue;
    const label = (
      el.getAttribute("aria-label") ||
      (el as HTMLInputElement).placeholder ||
      el.getAttribute("title") ||
      el.innerText ||
      (el as HTMLInputElement).value ||
      el.getAttribute("name") ||
      ""
    )
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 80);
    if (!label && el.tagName !== "INPUT" && el.tagName !== "TEXTAREA") continue;
    ref++;
    el.setAttribute("data-tobari-ref", String(ref));
    items.push({ ref, tag: el.tagName.toLowerCase(), role: el.getAttribute("role") ?? "", label, type: (el as HTMLInputElement).type ?? "" });
  }
  const mcpLink = document.querySelector<HTMLLinkElement>('link[rel="mcp"], link[rel="modelcontextprotocol"]');
  const mcpMeta = document.querySelector<HTMLMetaElement>('meta[name="mcp-server"]');
  return {
    title: document.title,
    url: location.href,
    lang: document.documentElement.lang || "",
    text: raw.slice(0, maxChars),
    selection: sel.slice(0, 20000),
    elements: items,
    mcp: mcpLink?.href ?? (mcpMeta?.content ? new URL(mcpMeta.content, location.href).href : null),
    truncated: raw.length > maxChars,
  };
}

export function extractTablesInPage(): string[][][] {
  return Array.from(document.querySelectorAll("table"))
    .slice(0, 30)
    .map((t) =>
      Array.from(t.rows)
        .slice(0, 500)
        .map((r) => Array.from(r.cells).map((c) => (c as HTMLElement).innerText.replace(/\s+/g, " ").trim())),
    )
    .filter((rows) => rows.length > 0);
}

export function clickInPage(ref: number): { ok: boolean; label: string; error?: string } {
  const el = document.querySelector<HTMLElement>(`[data-tobari-ref="${ref}"]`);
  if (!el) return { ok: false, label: "", error: `no element with ref ${ref}; read the page again` };
  el.scrollIntoView({ block: "center" });
  const label = (el.innerText || el.getAttribute("aria-label") || "").trim().slice(0, 80);
  el.click();
  return { ok: true, label };
}

export function typeInPage(ref: number, text: string, submit: boolean): { ok: boolean; error?: string } {
  const el = document.querySelector<HTMLElement>(`[data-tobari-ref="${ref}"]`);
  if (!el) return { ok: false, error: `no element with ref ${ref}` };
  if ((el as HTMLInputElement).type === "password") return { ok: false, error: "refusing to type into a password field" };
  el.focus();
  if (el.isContentEditable) {
    el.textContent = text;
  } else {
    const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, text);
  }
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  if (submit) {
    const form = (el as HTMLInputElement).form;
    if (form) form.requestSubmit();
    else el.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
  }
  return { ok: true };
}

export function fieldTypeInPage(ref: number): string {
  const el = document.querySelector<HTMLInputElement>(`[data-tobari-ref="${ref}"]`);
  return el?.type ?? "";
}

export function pickElementInPage(): Promise<{ text: string; html: string; label: string } | null> {
  return new Promise((resolve) => {
    const box = document.createElement("div");
    box.style.cssText =
      "position:fixed;pointer-events:none;z-index:2147483647;border:2px solid #1b345c;background:rgba(27,52,92,.08);border-radius:6px;transition:all .05s";
    const tip = document.createElement("div");
    tip.style.cssText =
      "position:fixed;z-index:2147483647;left:50%;top:12px;transform:translateX(-50%);background:#1b1d22;color:#f6f4ef;font:13px system-ui,sans-serif;padding:6px 12px;border-radius:999px";
    tip.textContent = "Click an element to add it to Tobari · Esc to cancel";
    document.documentElement.append(box, tip);
    let current: HTMLElement | null = null;
    const move = (e: MouseEvent) => {
      const el = document.elementFromPoint(e.clientX, e.clientY) as HTMLElement | null;
      if (!el || el === box || el === tip) return;
      current = el;
      const r = el.getBoundingClientRect();
      Object.assign(box.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px` });
    };
    const done = (v: { text: string; html: string; label: string } | null) => {
      document.removeEventListener("mousemove", move, true);
      document.removeEventListener("click", click, true);
      document.removeEventListener("keydown", key, true);
      box.remove();
      tip.remove();
      resolve(v);
    };
    const click = (e: MouseEvent) => {
      e.preventDefault();
      e.stopPropagation();
      if (!current) return done(null);
      const text = current.innerText.trim().slice(0, 20000);
      const html = current.outerHTML.slice(0, 20000);
      const label = `<${current.tagName.toLowerCase()}> ${text.replace(/\s+/g, " ").slice(0, 40)}`;
      done({ text, html, label });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        done(null);
      }
    };
    document.addEventListener("mousemove", move, true);
    document.addEventListener("click", click, true);
    document.addEventListener("keydown", key, true);
  });
}

export async function inTab<A extends unknown[], R>(tabId: number, func: (...a: A) => R, ...args: A): Promise<Awaited<R>> {
  const [res] = await chrome.scripting.executeScript({ target: { tabId }, func: func as any, args: args as any });
  if (!res) throw new Error("the page did not respond");
  return res.result as Awaited<R>;
}
