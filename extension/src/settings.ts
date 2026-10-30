import { core, isHostMissing } from "./lib/core";
import { $, h, icon, toast } from "./lib/ui";
import { enterList, followPill } from "./lib/motion";

const main = $("#main");
type Section = "ai" | "model" | "skills" | "memory" | "import" | "privacy" | "crashes" | "about";
const add = (...nodes: (Node | null)[]) => main.append(...(nodes.filter(Boolean) as Node[]));

const sections: Record<Section, () => Promise<void>> = { ai, model, skills, memory, import: importer, privacy, crashes, about };

async function route() {
  const s = (location.hash.slice(1) || "ai") as Section;
  document.querySelectorAll<HTMLAnchorElement>("#nav a").forEach((a) => a.classList.toggle("on", a.dataset.s === s));
  const on = document.querySelector<HTMLElement>(`#nav a[data-s="${s}"]`);
  if (on) followPill($("#nav-pill"), on, !navReady);
  navReady = true;
  main.innerHTML = "";
  try {
    await (sections[s] ?? ai)();
    enterList(main.children, { y: 8, stagger: 0.04 });
  } catch (e: any) {
    add(
      h("h1", {}, "Tobari core is not connected"),
      h("p", { class: "lead" }, isHostMissing(e) ? "Install the native host once, then reload this page:" : e.message),
      isHostMissing(e) ? h("pre", { class: "note" }, "tobari install-host") : null,
    );
  }
}
let navReady = false;
window.addEventListener("hashchange", route);
route();

function sec(title: string, ...children: (Node | null)[]) {
  return h("section", { class: "sec card" }, h("h2", {}, title), ...children);
}
function head(title: string, lead: string) {
  main.append(h("h1", {}, title), h("p", { class: "lead" }, lead));
}

const KINDS = [
  { id: "local", name: "On this device (llama.cpp)" },
  { id: "ollama", name: "Ollama" },
  { id: "openai", name: "OpenAI-compatible endpoint" },
  { id: "anthropic", name: "Anthropic" },
  { id: "google", name: "Google Gemini" },
];

async function ai() {
  head("AI and providers", "Tobari never routes your prompts through a Tobari server. Each provider below is contacted directly, and only when you pick it.");
  const res = await core("providers.list");
  const list = h("div", { class: "list" });
  for (const p of res.providers) {
    const active = p.provider.id === res.active;
    const use = h("button", { class: `btn${active ? " primary" : ""}`, disabled: active || !p.has_key }, active ? "In use" : "Use");
    use.onclick = async () => {
      await core("providers.use", { provider: p.provider.id });
      route();
    };
    const keyBtn = p.provider.kind !== "local" && p.provider.kind !== "ollama" ? h("button", { class: "btn", onclick: () => setKey(p.provider.id) }, p.has_key ? "Replace key" : "Add key") : null;
    const del = p.provider.id !== "local" ? h("button", { class: "icon-btn", title: "Remove" }, icon("x")) : null;
    if (del)
      del.onclick = async () => {
        if (!confirm(`Remove ${p.provider.id} and its stored key?`)) return;
        await core("providers.remove", { provider: p.provider.id });
        route();
      };
    list.append(
      h(
        "div",
        { class: "li" },
        h("span", { class: `dot ${p.destination.local ? "local" : "cloud"}` }),
        h("div", { class: "grow" }, h("div", { class: "t" }, p.provider.id), h("div", { class: "s" }, p.destination.summary)),
        p.provider.kind === "local" || p.provider.kind === "ollama" ? null : h("span", { class: `tag ${p.has_key ? "ok" : "warn"}` }, p.has_key ? "key stored" : "no key"),
        keyBtn,
        use,
        del,
      ),
    );
  }
  main.append(sec("Where prompts go", list));

  const kind = h("select", { class: "in" }, ...KINDS.filter((k) => k.id !== "local").map((k) => h("option", { value: k.id }, k.name)));
  const id = h("input", { class: "in", placeholder: "e.g. anthropic, groq, home-ollama" });
  const base = h("input", { class: "in", placeholder: "Leave empty for the provider's default" });
  const modelIn = h("input", { class: "in", placeholder: "Model id", list: "model-ids" });
  const ids = h("datalist", { id: "model-ids" });
  const region = h("input", { class: "in", placeholder: "Optional, shown in the chat header, e.g. US or EU" });
  kind.onchange = () => {
    if (!id.value) id.value = kind.value;
  };
  id.value = "anthropic";
  kind.value = "anthropic";
  const fetchBtn = h("button", { class: "btn" }, "Fetch model list");
  fetchBtn.onclick = async () => {
    await saveProvider(false);
    try {
      const models: string[] = await core("providers.models", { provider: id.value.trim() });
      ids.innerHTML = "";
      models.forEach((m) => ids.append(h("option", { value: m })));
      toast(`${models.length} models`);
      modelIn.focus();
    } catch (e: any) {
      toast(e.message, 4000);
    }
  };
  async function saveProvider(reload = true) {
    await core("providers.save", { provider: { id: id.value.trim(), kind: kind.value, base_url: base.value.trim(), model: modelIn.value.trim(), region: region.value.trim(), label: "" } });
    if (reload) {
      toast("Saved");
      route();
    }
  }
  const save = h("button", { class: "btn primary", onclick: () => saveProvider() }, "Save provider");
  main.append(
    sec(
      "Add a provider",
      h("div", { class: "form" }, h("label", {}, "Kind"), kind, h("label", {}, "Name"), id, h("label", {}, "Base URL"), base, h("label", {}, "Model"), h("div", {}, modelIn, ids), h("label", {}, "Region"), region),
      h("div", { class: "row-btns" }, save, fetchBtn),
      h("p", { class: "muted small" }, "API keys go into your desktop's secret service (GNOME Keyring or KWallet) through secret-tool. They are never written to Tobari's config files."),
    ),
  );
}

async function setKey(provider: string) {
  const dlg = h("dialog", {});
  const input = h("input", { class: "in", type: "password", placeholder: "Paste the API key", autocomplete: "off" });
  const ok = h("button", { class: "btn primary" }, "Store in keyring");
  ok.onclick = async () => {
    try {
      await core("providers.set_key", { provider, key: input.value });
      dlg.close();
      toast("Key stored");
      route();
    } catch (e: any) {
      toast(e.message, 4000);
    }
  };
  dlg.append(h("h2", {}, `API key for ${provider}`), input, h("div", { class: "row-btns" }, ok, h("button", { class: "btn ghost", onclick: () => dlg.close() }, "Cancel")));
  document.body.append(dlg);
  dlg.showModal();
  input.focus();
}

async function model() {
  head("Local model", "Runs on your GPU through a llama.cpp sidecar. It starts when you ask something and unloads after it sits idle, so VRAM is free when you're not using it.");
  const st = await core("status");
  const settings = await core("settings.get");
  main.append(
    sec(
      "Status",
      h(
        "div",
        { class: "stat" },
        h("div", {}, h("b", {}, st.sidecar.running ? "Loaded" : "Unloaded"), h("span", {}, "sidecar")),
        h("div", {}, h("b", {}, st.sidecar.backend), h("span", {}, "backend")),
        h("div", {}, h("b", {}, `${Math.round(settings.idle_unload_secs / 60)} min`), h("span", {}, "idle unload")),
        h("div", {}, h("b", {}, st.sidecar.llama_server ? "found" : "missing"), h("span", {}, "llama-server")),
      ),
      h("div", { class: "row-btns" }, h("button", { class: "btn", onclick: async () => { await core("sidecar.stop"); toast("Model unloaded, VRAM freed"); route(); } }, "Unload now")),
    ),
  );
  const list = h("div", { class: "list" });
  for (const m of await core("models.list")) {
    const bar = h("i");
    const prog = h("div", { class: "progress", hidden: true }, bar);
    const dl = h("button", { class: "btn" }, icon("download"), "Download");
    dl.onclick = async () => {
      dl.disabled = true;
      prog.hidden = false;
      try {
        await core("models.download", { model: m.id }, { onProgress: (d, t) => (bar.style.width = t ? `${(100 * d) / t}%` : "40%") });
        toast("Downloaded and verified");
        route();
      } catch (e: any) {
        toast(e.message, 4000);
        dl.disabled = false;
      }
    };
    const use = h("button", { class: `btn${m.active ? " primary" : ""}`, disabled: m.active || !m.downloaded }, m.active ? "Default" : "Make default");
    use.onclick = async () => {
      await core("models.select", { model: m.id });
      route();
    };
    const del = m.downloaded ? h("button", { class: "icon-btn", title: "Delete file" }, icon("x")) : null;
    if (del)
      del.onclick = async () => {
        if (!confirm(`Delete ${m.id} (${m.size_mb} MB)?`)) return;
        await core("models.delete", { model: m.id });
        route();
      };
    list.append(
      h(
        "div",
        { class: "li" },
        h("div", { class: "grow" }, h("div", { class: "t" }, m.id), h("div", { class: "s" }, `${m.about} · ${m.size_mb} MB · ${m.license}`), prog),
        m.downloaded ? h("span", { class: "tag ok" }, "verified") : dl,
        use,
        del,
      ),
    );
  }
  main.append(sec("Models", list, h("p", { class: "muted small" }, "Every file is checked against a SHA-256 pinned in models.toml before it is loaded.")));
  const idle = h("input", { class: "in", type: "number", min: "30", step: "30", value: String(settings.idle_unload_secs) });
  const save = h("button", { class: "btn" }, "Save");
  save.onclick = async () => {
    await core("settings.save", { settings: { ...settings, idle_unload_secs: Math.max(30, Number(idle.value) || 300) } });
    toast("Saved. Applies the next time the browser starts the core.");
  };
  main.append(sec("Unload after idle (seconds)", h("div", { class: "form" }, h("label", {}, "Seconds"), idle), h("div", { class: "row-btns" }, save)));
}

async function skills() {
  head("Skills", "A skill is a folder with a SKILL.md file in ~/.config/tobari/skills. Run one with / in the panel. Edit the files with any editor.");
  const res = await core("skills.list");
  const list = h("div", { class: "list" });
  for (const s of res.skills) {
    list.append(
      h(
        "div",
        { class: "li" },
        h("div", { class: "grow" }, h("div", { class: "t" }, `/${s.name}`), h("div", { class: "s" }, s.description)),
        h("span", { class: "tag" }, s.role || "any role"),
        h("span", { class: "tag", title: s.sites.join(", ") }, s.sites.length && !s.sites.includes("*") ? s.sites[0] + (s.sites.length > 1 ? " +" : "") : "any site"),
      ),
    );
  }
  main.append(sec(`${res.skills.length} skills`, list, ...res.errors.map((e: string) => h("p", { class: "err" }, e))));
  const name = h("input", { class: "in", placeholder: "price-check" });
  const desc = h("input", { class: "in", placeholder: "One line: what it does" });
  const body = h("textarea", { class: "in", placeholder: "Instructions for the assistant, in plain words" });
  const sites = h("input", { class: "in", placeholder: "Optional: example.com, *.example.org" });
  const create = h("button", { class: "btn primary" }, "Create skill");
  create.onclick = async () => {
    try {
      await core("skills.create", { name: name.value, description: desc.value, prompt: body.value, sites: sites.value.split(",").map((s) => s.trim()).filter(Boolean) });
      toast("Skill created");
      route();
    } catch (e: any) {
      toast(e.message, 4000);
    }
  };
  main.append(sec("New skill", h("div", { class: "form" }, h("label", {}, "Name"), name, h("label", {}, "Description"), desc, h("label", {}, "Instructions"), body, h("label", {}, "Sites"), sites), h("div", { class: "row-btns" }, create)));
}

async function memory() {
  head("Memory", "Plain Markdown files in ~/.local/share/tobari/memory. Tobari never uploads them. Back them up, sync them, or edit them like any notes.");
  const view = h("div", { class: "note", hidden: true });
  const search = h("input", { class: "in", placeholder: "Search your notes (Japanese and Thai work too)" });
  const hits = h("div", { class: "list" });
  search.oninput = async () => {
    hits.innerHTML = "";
    if (search.value.trim().length < 2) return;
    for (const r of await core("memory.search", { query: search.value, limit: 20 })) {
      const row = h("div", { class: "li", style: "cursor:pointer" }, h("div", { class: "grow" }, h("div", { class: "t" }, r.text), h("div", { class: "s" }, `${r.name}.md, line ${r.line}`)));
      row.onclick = () => show(r.name);
      hits.append(row);
    }
  };
  async function show(name: string) {
    view.textContent = await core("memory.read", { name });
    view.hidden = false;
    view.scrollIntoView({ behavior: "smooth", block: "nearest" });
  }
  const exp = h("button", { class: "btn" }, icon("download"), "Export all as one Markdown file");
  exp.onclick = async () => {
    const md: string = await core("memory.export");
    await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(md)}`, filename: `tobari-memory-${new Date().toISOString().slice(0, 10)}.md`, saveAs: true });
  };
  main.append(sec("Search", search, hits, h("div", { class: "row-btns" }, exp)));
  const notes = await core("memory.list");
  const list = h("div", { class: "list" });
  for (const n of notes) {
    const del = h("button", { class: "icon-btn", title: "Delete" }, icon("x"));
    del.onclick = async (e) => {
      e.stopPropagation();
      if (!confirm(`Delete ${n.name}.md?`)) return;
      await core("memory.delete", { name: n.name });
      route();
    };
    const row = h("div", { class: "li", style: "cursor:pointer" }, h("div", { class: "grow" }, h("div", { class: "t" }, n.name), h("div", { class: "s" }, `${n.bytes} bytes · ${new Date(n.modified * 1000).toLocaleString()}`)), del);
    row.onclick = () => show(n.name);
    list.append(row);
  }
  main.append(sec(`${notes.length} notes`, notes.length ? list : h("p", { class: "muted" }, "No notes yet. Use the book button under an answer, or /save-to-memory."), view));
}

async function importer() {
  head("Import", "Bring over bookmarks, history, extensions and settings from another browser on this computer. Tobari reads a copy of the profile files; the other browser can stay open.");
  const profiles = await core("import.detect");
  const list = h("div", { class: "list" });
  const out = h("div", {});
  if (!profiles.length) list.append(h("p", { class: "muted" }, "No Chrome, Chromium, Brave, Edge, Vivaldi, Firefox or Zen profiles found, including Flatpak installs."));
  for (const p of profiles) {
    const go = h("button", { class: "btn primary" }, "Import…");
    go.onclick = () => runImport(p, out);
    list.append(h("div", { class: "li" }, h("div", { class: "grow" }, h("div", { class: "t" }, `${p.browser} · ${p.name}`), h("div", { class: "s" }, p.path)), go));
  }
  main.append(sec("Profiles on this computer", list), out);
}

async function runImport(p: any, out: HTMLElement) {
  out.innerHTML = "";
  const status = h("p", { class: "muted" }, "Reading profile…");
  out.append(sec(`Importing ${p.browser} · ${p.name}`, status));
  const d = await core("import.read", { path: p.path, history_limit: 5000 });
  const n = (k: number, one: string, many: string) => `${k} ${k === 1 ? one : many}`;
  status.textContent = `${n(d.bookmarks.length, "bookmark", "bookmarks")}, ${n(d.history.length, "history entry", "history entries")}, ${n(d.extensions.length, "extension", "extensions")}.`;
  const bm = h("input", { type: "checkbox", class: "switch", checked: true });
  const hi = h("input", { type: "checkbox", class: "switch", checked: true });
  const go = h("button", { class: "btn primary" }, "Import selected");
  const bar = h("i");
  const prog = h("div", { class: "progress", hidden: true }, bar);
  go.onclick = async () => {
    go.disabled = true;
    prog.hidden = false;
    let done = 0;
    const total = (bm.checked ? d.bookmarks.length : 0) + (hi.checked ? d.history.length : 0);
    const tick = () => (bar.style.width = `${(100 * ++done) / Math.max(total, 1)}%`);
    if (bm.checked && d.bookmarks.length) {
      const root = await chrome.bookmarks.create({ title: `Imported from ${p.browser}` });
      const folders = new Map<string, string>([["", root.id]]);
      for (const b of d.bookmarks) {
        let parent = root.id;
        let path = "";
        for (const f of b.folder) {
          path += "/" + f;
          if (!folders.has(path)) folders.set(path, (await chrome.bookmarks.create({ parentId: parent, title: f })).id);
          parent = folders.get(path)!;
        }
        if (/^(https?|ftp|file):/.test(b.url)) await chrome.bookmarks.create({ parentId: parent, title: b.title, url: b.url }).catch(() => {});
        tick();
      }
    }
    if (hi.checked) {
      for (const v of d.history) {
        await chrome.history.addUrl({ url: v.url }).catch(() => {});
        tick();
      }
    }
    toast("Import finished");
    go.textContent = "Done";
  };
  const exts = h("div", { class: "list" });
  for (const e of d.extensions) {
    exts.append(h("div", { class: "li" }, h("div", { class: "grow" }, h("div", { class: "t" }, e.name), h("div", { class: "s" }, e.id)), h("a", { class: "btn", href: e.store_url, target: "_blank" }, "Get from store")));
  }
  const s = d.settings;
  out.append(...([
    sec(
      "What to bring over",
      h("div", { class: "toggle" }, bm, h("div", { class: "grow" }, h("div", {}, `Bookmarks (${d.bookmarks.length})`), h("div", { class: "d" }, "Kept in their folders under “Imported from …”."))),
      h("div", { class: "toggle" }, hi, h("div", { class: "grow" }, h("div", {}, `History (${d.history.length} most recent ${d.history.length === 1 ? "entry" : "entries"})`), h("div", { class: "d" }, "Browsers only let extensions add history as visited today; the original dates are not kept."))),
      h("div", { class: "row-btns" }, go),
      prog,
    ),
    d.extensions.length ? sec("Extensions", h("p", { class: "muted small" }, "Extensions install from their store so they stay signed and up to date."), exts) : null,
    sec(
      "Settings found",
      h("p", { class: "small" }, `Home page: ${s.homepage ?? "none"} · Search engine: ${s.search_engine ?? "default"}${s.startup_urls.length ? ` · Startup pages: ${s.startup_urls.join(", ")}` : ""}`),
    ),
    ...d.warnings.map((w: string) => h("p", { class: "err" }, w)),
  ].filter(Boolean) as Node[]));
}

async function privacy() {
  head("Privacy and safety", "What Tobari blocks, and when the assistant has to ask before acting.");
  const local: Record<string, any> = (await chrome.storage.local.get("settings") as Record<string, any>).settings ?? {};
  const coreSettings = await core("settings.get");
  const ad = h("input", { type: "checkbox", class: "switch", checked: local.adblock !== false });
  ad.onchange = () => chrome.storage.local.set({ settings: { ...local, adblock: ad.checked } }).then(() => toast(ad.checked ? "Blocking trackers" : "Tracker blocking off"));
  const second = h("input", { type: "checkbox", class: "switch", checked: !!coreSettings.second_check });
  second.onchange = () => core("settings.save", { settings: { ...coreSettings, second_check: second.checked } }).then(() => toast("Saved"));
  const sleep = h("select", { class: "in", style: "width:auto" }, ...[0, 10, 30, 60, 120].map((m) => h("option", { value: String(m), selected: Number(local.discardMinutes ?? 30) === m }, m ? `after ${m} min` : "never")));
  sleep.onchange = () => chrome.storage.local.set({ settings: { ...local, discardMinutes: Number(sleep.value) } }).then(() => toast("Saved"));
  const engines: [string, string][] = [
    ["DuckDuckGo", "https://duckduckgo.com/?q=%s"],
    ["Startpage", "https://www.startpage.com/do/search?q=%s"],
    ["Brave Search", "https://search.brave.com/search?q=%s"],
    ["Google", "https://www.google.com/search?q=%s"],
    ["Kagi", "https://kagi.com/search?q=%s"],
  ];
  const engine = h("select", { class: "in", style: "width:auto" }, ...engines.map(([n, u]) => h("option", { value: u, selected: (local.searchEngine ?? engines[0][1]) === u }, n)));
  engine.onchange = () => chrome.storage.local.set({ settings: { ...local, searchEngine: engine.value } }).then(() => toast("Saved"));
  main.append(
    sec(
      "Browsing",
      h("div", { class: "toggle" }, ad, h("div", { class: "grow" }, h("div", {}, "Block ads and trackers"), h("div", { class: "d" }, "About 170 known ad and tracking domains, blocked only when another site loads them. For full filter lists, add uBlock Origin Lite from the Chrome Web Store."))),
      h("div", { class: "toggle" }, h("span", { style: "width:34px" }), h("div", { class: "grow" }, h("div", {}, "Put background tabs to sleep"), h("div", { class: "d" }, "Sleeping tabs free their memory and reload when you open them.")), sleep),
      h("div", { class: "toggle" }, h("span", { style: "width:34px" }), h("div", { class: "grow" }, h("div", {}, "Search engine")), engine),
    ),
  );
  const allow = h("div", { class: "list" });
  for (const host of coreSettings.auto_approve_hosts as string[]) {
    const rm = h("button", { class: "btn" }, "Remove");
    rm.onclick = async () => {
      await core("settings.save", { settings: { ...coreSettings, auto_approve_hosts: coreSettings.auto_approve_hosts.filter((x: string) => x !== host) } });
      route();
    };
    allow.append(h("div", { class: "li" }, h("div", { class: "grow t" }, host), rm));
  }
  main.append(
    sec(
      "Assistant actions",
      h("div", { class: "toggle" }, second, h("div", { class: "grow" }, h("div", {}, "Second check before acting"), h("div", { class: "d" }, "Before a click, typing or navigation runs, the model is asked whether the step serves your request. Rules run first either way: page text can never trigger a tool, password fields are off limits, and steps that would leak page data to another site are blocked."))),
      h("p", { class: "small", style: "margin:12px 0 4px" }, "Sites where routine steps run without asking (buying, sending, deleting and site tools still ask):"),
      coreSettings.auto_approve_hosts.length ? allow : h("p", { class: "muted small" }, "None. Add one with “Always on this site” when the assistant asks."),
    ),
  );
}

async function crashes() {
  head("Crash reports", "When Tobari crashes it writes a report on this computer. Nothing is sent unless you choose to, and you see exactly what would be sent first.");
  const list = await core("crash.list");
  const box = h("div", { class: "list" });
  for (const r of list) {
    const viewBtn = h("button", { class: "btn" }, "View");
    const sendBtn = h("button", { class: "btn" }, "Send…");
    const del = h("button", { class: "icon-btn", title: "Delete" }, icon("x"));
    viewBtn.onclick = async () => {
      const text = await core("crash.read", { name: r.name });
      const dlg = h("dialog", {}, h("h2", {}, r.name), h("div", { class: "note" }, text), h("div", { class: "row-btns" }, h("button", { class: "btn", onclick: () => dlg.close() }, "Close")));
      document.body.append(dlg);
      dlg.showModal();
    };
    sendBtn.onclick = async () => {
      const text: string = await core("crash.read", { name: r.name });
      const body = `Crash report \`${r.name}\`\n\n\`\`\`\n${text.slice(0, 5000)}\n\`\`\``;
      const dlg = h("dialog", {});
      const go = h("button", { class: "btn primary" }, "Open a prefilled GitHub issue");
      go.onclick = () => {
        chrome.tabs.create({ url: `https://github.com/kaorii-ako/tobari/issues/new?title=${encodeURIComponent("Crash: " + r.name)}&body=${encodeURIComponent(body)}` });
        dlg.close();
      };
      dlg.append(
        h("h2", {}, "Send this report?"),
        h("p", { class: "small muted" }, "This opens a GitHub issue form with the text below. Nothing leaves your computer until you press Submit on GitHub, and you can edit it there."),
        h("div", { class: "note" }, body),
        h("div", { class: "row-btns" }, go, h("button", { class: "btn ghost", onclick: () => dlg.close() }, "Cancel")),
      );
      document.body.append(dlg);
      dlg.showModal();
    };
    del.onclick = async () => {
      await core("crash.delete", { name: r.name });
      route();
    };
    box.append(h("div", { class: "li" }, h("div", { class: "grow" }, h("div", { class: "t" }, r.name), h("div", { class: "s" }, `${new Date(r.created * 1000).toLocaleString()} · ${r.bytes} bytes`)), viewBtn, sendBtn, del));
  }
  main.append(sec(list.length ? `${list.length} reports` : "No crash reports", list.length ? box : h("p", { class: "muted" }, "Reports land in ~/.local/state/tobari/crashes.")));
}

async function about() {
  const st = await core("status");
  head("About Tobari", "A local-first AI browser for Linux.");
  main.append(
    sec(
      "Versions",
      h("p", {}, `Extension ${chrome.runtime.getManifest().version} · Core ${st.version}`),
      h("p", { class: "small muted" }, `Prompts currently go to: ${st.destination.summary}`),
    ),
    sec(
      "Your files",
      h("p", { class: "small" }, "Skills: ~/.config/tobari/skills"),
      h("p", { class: "small" }, "Memory: ~/.local/share/tobari/memory"),
      h("p", { class: "small" }, "Models: ~/.local/share/tobari/models"),
      h("p", { class: "small" }, "Settings: ~/.config/tobari/settings.toml and providers.toml (no keys; keys live in the keyring)"),
    ),
  );
}
