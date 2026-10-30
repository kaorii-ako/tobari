import { activeTab, targetWindowId, windowTabs } from "./win";
import { core } from "./core";
import { IconName } from "./icons";
import { inTab, pickElementInPage, readPageInPage } from "./page";
import { hostOf } from "./tabs";

export type ContextKind = "tab" | "tabs" | "bookmark" | "history" | "file" | "pdf" | "screenshot" | "highlight" | "element" | "memory";

export type ContextItem = {
  id: string;
  kind: ContextKind;
  label: string;
  icon: IconName;
  favicon?: string;
  source: string;
  text?: string;
  image?: string;
  tabId?: number;
};

export type PickerEntry = { group: string; label: string; hint?: string; icon: IconName; favicon?: string; make: () => Promise<ContextItem | null> };

export function looksLikePdf(url?: string): boolean {
  return !!url && (/\.pdf($|[?#])/i.test(url) || /^chrome-extension:\/\/mhjfbmdgcfjbbpaeojofohoefgiehjai\//.test(url));
}

const pdf = () => import("./pdf");

const uid = () => Math.random().toString(36).slice(2, 10);

export async function readTab(tab: chrome.tabs.Tab): Promise<{ text: string; elements: string; mcp: string | null; selection: string }> {
  if (looksLikePdf(tab.url)) {
    const src = tab.url!.includes("mhjfbmdgcfjbbpaeojofohoefgiehjai") ? new URL(tab.url!).searchParams.get("src") ?? tab.url! : tab.url!;
    const r = await (await pdf()).pdfFromUrl(src);
    return { text: `PDF, ${r.pages} pages\n\n${r.text}`, elements: "", mcp: null, selection: "" };
  }
  if (!/^(https?|file):/.test(tab.url ?? "")) {
    return { text: `(${tab.url} is a browser page and cannot be read)`, elements: "", mcp: null, selection: "" };
  }
  const r = await inTab(tab.id!, readPageInPage, 80_000);
  const elements = r.elements.map((e) => `[${e.ref}] ${e.tag}${e.type && e.tag === "input" ? `(${e.type})` : ""} ${e.label}`).join("\n");
  return {
    text: `Title: ${r.title}\nURL: ${r.url}${r.lang ? `\nLanguage: ${r.lang}` : ""}\n\n${r.text}${r.truncated ? "\n\n(truncated)" : ""}`,
    elements,
    mcp: r.mcp,
    selection: r.selection,
  };
}

export async function tabItem(tab: chrome.tabs.Tab): Promise<ContextItem> {
  const r = await readTab(tab);
  return {
    id: uid(),
    kind: looksLikePdf(tab.url) ? "pdf" : "tab",
    label: tab.title || tab.url || "Tab",
    icon: looksLikePdf(tab.url) ? "pdf" : "globe",
    favicon: tab.favIconUrl,
    source: tab.url ?? "tab",
    text: r.text,
    tabId: tab.id,
  };
}

export async function allTabsItem(): Promise<ContextItem> {
  const tabs = await windowTabs();
  const blocks: string[] = [];
  for (const t of tabs) {
    if (!/^https?:/.test(t.url ?? "")) continue;
    if (t.discarded) {
      blocks.push(`## [tab ${t.id}] ${t.title}\n${t.url}\n(sleeping tab: title only)`);
      continue;
    }
    try {
      const r = await readTab(t);
      blocks.push(`## [tab ${t.id}] ${t.title}\n${r.text.slice(0, 12_000)}`);
    } catch {
      blocks.push(`## [tab ${t.id}] ${t.title}\n${t.url}\n(could not read)`);
    }
  }
  return { id: uid(), kind: "tabs", label: `All ${tabs.length} tabs`, icon: "tabs", source: "open tabs", text: blocks.join("\n\n") };
}

export function tabListText(tabs: chrome.tabs.Tab[]): string {
  return tabs.map((t) => `[tab ${t.id}] ${t.title} — ${t.url}${t.discarded ? " (sleeping)" : ""}`).join("\n");
}

export async function screenshotItem(): Promise<ContextItem> {
  const tab = await activeTab();
  const image = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
  return { id: uid(), kind: "screenshot", label: `Screenshot: ${tab.title ?? ""}`, icon: "camera", source: tab.url ?? "screenshot", image, tabId: tab.id };
}

export async function highlightItem(): Promise<ContextItem | null> {
  const tab = await activeTab();
  if (!tab?.id) return null;
  const r = await readTab(tab);
  if (!r.selection) throw new Error("Select some text on the page first.");
  return { id: uid(), kind: "highlight", label: `“${r.selection.slice(0, 40)}”`, icon: "highlight", source: tab.url ?? "selection", text: r.selection, tabId: tab.id };
}

export async function elementItem(): Promise<ContextItem | null> {
  const tab = await activeTab();
  if (!tab?.id) return null;
  const r = await inTab(tab.id, pickElementInPage);
  if (!r) return null;
  return { id: uid(), kind: "element", label: r.label, icon: "pointer", source: tab.url ?? "element", text: `${r.text}\n\nHTML:\n${r.html}`, tabId: tab.id };
}

export async function fileItems(files: FileList): Promise<ContextItem[]> {
  const out: ContextItem[] = [];
  for (const f of Array.from(files)) {
    if (f.size > 40 * 1024 * 1024) throw new Error(`${f.name} is over 40 MB`);
    if (f.type === "application/pdf" || /\.pdf$/i.test(f.name)) {
      const r = await (await pdf()).pdfText(await f.arrayBuffer());
      out.push({ id: uid(), kind: "pdf", label: f.name, icon: "pdf", source: f.name, text: `PDF, ${r.pages} pages\n\n${r.text}` });
    } else if (f.type.startsWith("image/")) {
      const image = await new Promise<string>((res) => {
        const fr = new FileReader();
        fr.onload = () => res(String(fr.result));
        fr.readAsDataURL(f);
      });
      out.push({ id: uid(), kind: "screenshot", label: f.name, icon: "camera", source: f.name, image });
    } else {
      out.push({ id: uid(), kind: "file", label: f.name, icon: "file", source: f.name, text: (await f.text()).slice(0, 200_000) });
    }
  }
  return out;
}

export async function pickerEntries(query: string): Promise<PickerEntry[]> {
  const q = query.toLowerCase();
  const out: PickerEntry[] = [];
  const active = await activeTab();
  const fixed: PickerEntry[] = [
    { group: "This page", label: "Current tab", hint: active?.title, icon: "globe", favicon: active?.favIconUrl, make: () => tabItem(active) },
    { group: "This page", label: "Selected text", icon: "highlight", make: highlightItem },
    { group: "This page", label: "Pick an element", icon: "pointer", make: elementItem },
    { group: "This page", label: "Screenshot", icon: "camera", make: screenshotItem },
    { group: "Everywhere", label: "All open tabs", icon: "tabs", make: allTabsItem },
  ];
  out.push(...fixed.filter((e) => !q || e.label.toLowerCase().includes(q)));
  const tabs = await windowTabs();
  for (const t of tabs) {
    if (t.id === active?.id) continue;
    const text = `${t.title} ${t.url}`.toLowerCase();
    if (q && !text.includes(q)) continue;
    out.push({ group: "Tabs", label: t.title || t.url || "Tab", hint: hostOf(t.url), icon: "globe", favicon: t.favIconUrl, make: () => tabItem(t) });
  }
  if (q.length >= 2) {
    const bms = (await chrome.bookmarks.search(q)).filter((b) => b.url).slice(0, 6);
    for (const b of bms) {
      out.push({
        group: "Bookmarks",
        label: b.title || b.url!,
        hint: hostOf(b.url),
        icon: "bookmark",
        make: async () => ({ id: uid(), kind: "bookmark", label: b.title || b.url!, icon: "bookmark", source: b.url!, text: `Bookmark: ${b.title}\n${b.url}` }),
      });
    }
    const hist = await chrome.history.search({ text: q, maxResults: 6, startTime: 0 });
    for (const h of hist) {
      out.push({
        group: "History",
        label: h.title || h.url!,
        hint: hostOf(h.url),
        icon: "history",
        make: async () => ({ id: uid(), kind: "history", label: h.title || h.url!, icon: "history", source: h.url!, text: `Visited ${new Date(h.lastVisitTime ?? 0).toLocaleString()}: ${h.title}\n${h.url}` }),
      });
    }
    try {
      const hits: { name: string; line: number; text: string }[] = await core("memory.search", { query, limit: 5 });
      for (const m of hits) {
        out.push({
          group: "Memory",
          label: m.text,
          hint: m.name,
          icon: "book",
          make: async () => ({ id: uid(), kind: "memory", label: m.name, icon: "book", source: `memory/${m.name}.md`, text: await core("memory.read", { name: m.name }) }),
        });
      }
    } catch {}
  }
  out.push({ group: "Files", label: "Attach a file or PDF…", icon: "file", make: async () => null });
  return out;
}
