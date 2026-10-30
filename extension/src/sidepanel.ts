import { activeTab, targetWindowId, windowTabs } from "./lib/win";
import { core, Destination, destinationLabel, isHostMissing, onCoreEvent, prettyModel } from "./lib/core";
import { ContextItem, fileItems, pickerEntries, readTab, tabItem } from "./lib/context";
import { Msg, Role, Skill, Step, runTurn, visibleText } from "./lib/agent";
import { renderMarkdown } from "./lib/markdown";
import * as mcp from "./lib/mcp";
import { $, autosize, favicon, h, icon, setIcon, showMenu, toast } from "./lib/ui";
import { applyClusters, clusterByHeuristic, discardIdleTabs, hostOf, listWorkspaces, saveWorkspaces, switchWorkspace, Workspace } from "./lib/tabs";

const GROUP_COLORS: Record<string, string> = {
  grey: "#8a8c92", blue: "#3b6fd1", red: "#d1493b", yellow: "#d1a23b", green: "#3b9c63", pink: "#d14b8f", purple: "#7b54d1", cyan: "#2fa3b5", orange: "#d67852",
};

setIcon($("#open-settings"), "gear");
setIcon($("#ws-add"), "plus");
setIcon($("#tab-search-icon"), "search");
setIcon($("#organize"), "wand");
setIcon($("#sleep"), "sleep");
setIcon($("#new-tab-icon"), "plus");
setIcon($("#dest-caret"), "down");
setIcon($("#at-btn"), "plus");
setIcon($("#slash-btn"), "slash");
setIcon($("#attach-btn"), "file");
setIcon($("#send"), "send");

$("#open-settings").onclick = () => chrome.runtime.openOptionsPage();

function setView(v: "tabs" | "ask") {
  document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => b.setAttribute("aria-selected", String(b.dataset.view === v)));
  $("#view-tabs").hidden = v !== "tabs";
  $("#view-ask").hidden = v !== "ask";
  chrome.storage.session.set({ view: v }).catch(() => {});
  if (v === "tabs") renderTabs();
  else $("#input").focus();
}
document.querySelectorAll<HTMLButtonElement>(".seg button").forEach((b) => (b.onclick = () => setView(b.dataset.view as "tabs" | "ask")));
(chrome.storage.session.get("view") as Promise<Record<string, any>>).then(({ view }) => setView(view === "tabs" ? "tabs" : "ask")).catch(() => setView("ask"));

let windowId: number | undefined;
targetWindowId().then((w) => (windowId = w));

let tabFilter = "";
let dragId: number | null = null;
const collapsed = new Set<number>();
let renderQueued = false;

function queueRender() {
  if (renderQueued || $("#view-tabs").hidden) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderTabs();
  });
}

function tabRow(t: chrome.tabs.Tab): HTMLElement {
  const close = h("button", { class: "icon-btn close", title: "Close tab" }, icon("x"));
  close.onclick = (e) => {
    e.stopPropagation();
    chrome.tabs.remove(t.id!);
  };
  const row = h(
    "div",
    { class: `row${t.active ? " on" : ""}${t.discarded ? " sleeping" : ""}`, draggable: "true", title: `${t.title}\n${t.url}` },
    h("span", { class: "fav" }, favicon(t.favIconUrl)),
    h("span", { class: "title" }, t.title || t.url || "New tab"),
    t.audible ? h("span", { class: "badge", title: "Playing audio" }, icon("sound")) : null,
    t.discarded ? h("span", { class: "badge", title: "Sleeping: frees memory, reloads when opened" }, icon("sleep")) : null,
    close,
  );
  row.onclick = () => chrome.tabs.update(t.id!, { active: true });
  row.onauxclick = (e) => {
    if (e.button === 1) chrome.tabs.remove(t.id!);
  };
  row.ondragstart = () => (dragId = t.id!);
  row.ondragover = (e) => {
    e.preventDefault();
    row.classList.add("drop-above");
  };
  row.ondragleave = () => row.classList.remove("drop-above");
  row.ondrop = async (e) => {
    e.preventDefault();
    row.classList.remove("drop-above");
    if (dragId === null || dragId === t.id) return;
    await chrome.tabs.move(dragId, { index: t.index });
    if (t.groupId !== -1) await chrome.tabs.group({ tabIds: dragId, groupId: t.groupId });
    else await chrome.tabs.ungroup(dragId).catch(() => {});
    dragId = null;
  };
  return row;
}

async function renderTabs() {
  if (windowId === undefined) windowId = await targetWindowId();
  const tabs = await chrome.tabs.query({ windowId });
  const groups = await chrome.tabGroups.query({ windowId });
  const q = tabFilter.toLowerCase();
  const match = (t: chrome.tabs.Tab) => !q || `${t.title} ${t.url}`.toLowerCase().includes(q);

  const pinned = $("#pinned");
  pinned.innerHTML = "";
  for (const t of tabs.filter((t) => t.pinned && match(t))) {
    const b = h("button", { class: `pin${t.active ? " on" : ""}`, title: t.title }, favicon(t.favIconUrl));
    b.onclick = () => chrome.tabs.update(t.id!, { active: true });
    pinned.append(b);
  }

  const list = $("#tab-list");
  list.innerHTML = "";
  const seen = new Set<number>();
  for (const t of tabs.filter((t) => !t.pinned)) {
    if (t.groupId !== -1) {
      if (seen.has(t.groupId)) continue;
      seen.add(t.groupId);
      const g = groups.find((x) => x.id === t.groupId);
      const members = tabs.filter((x) => x.groupId === t.groupId && match(x));
      if (members.length === 0) continue;
      const isCollapsed = collapsed.has(t.groupId);
      const head = h(
        "div",
        { class: "group-head" },
        icon("down"),
        h("span", { class: "bar", style: `background:${GROUP_COLORS[g?.color ?? "grey"]}` }),
        h("span", {}, g?.title || "Group"),
        h("span", { class: "count" }, String(members.length)),
      );
      const wrap = h("div", { class: `group${isCollapsed ? " collapsed" : ""}` }, head, h("div", { class: "rows" }, ...members.map(tabRow)));
      head.onclick = () => {
        if (collapsed.has(t.groupId)) collapsed.delete(t.groupId);
        else collapsed.add(t.groupId);
        wrap.classList.toggle("collapsed");
      };
      list.append(wrap);
    } else if (match(t)) {
      list.append(tabRow(t));
    }
  }
  renderWorkspaces();
}

async function renderWorkspaces() {
  const { list, current } = await listWorkspaces();
  const box = $("#ws-list");
  box.innerHTML = "";
  for (const w of list) {
    const b = h("button", { class: `ws${w.id === current ? " on" : ""}`, title: w.id === current ? "Current workspace · double-click to rename" : `Switch to ${w.name}` }, h("span", { class: "sw", style: `background:${w.color}` }), w.name);
    b.onclick = async () => {
      if (w.id === current || windowId === undefined) return;
      await switchWorkspace(w.id, windowId);
      toast(`Switched to ${w.name}`);
      renderTabs();
    };
    b.ondblclick = async () => {
      const name = prompt("Workspace name", w.name)?.trim();
      if (!name) return;
      w.name = name.slice(0, 32);
      await saveWorkspaces(list, current);
      renderWorkspaces();
    };
    box.append(b);
  }
}

$("#ws-add").onclick = async () => {
  const name = prompt("New workspace name")?.trim();
  if (!name || windowId === undefined) return;
  const { list, current } = await listWorkspaces();
  const palette = ["#1b345c", "#d67852", "#3b9c63", "#7b54d1", "#2fa3b5", "#d14b8f"];
  const ws: Workspace = { id: Math.random().toString(36).slice(2, 9), name: name.slice(0, 32), color: palette[list.length % palette.length], tabs: [], updated: Date.now() };
  list.push(ws);
  await saveWorkspaces(list, current);
  await switchWorkspace(ws.id, windowId);
  renderTabs();
};

$<HTMLInputElement>("#tab-search").oninput = (e) => {
  tabFilter = (e.target as HTMLInputElement).value;
  renderTabs();
};
$("#new-tab").onclick = () => chrome.tabs.create({ windowId });
$("#sleep").onclick = async () => {
  const n = await discardIdleTabs(0);
  toast(n ? `${n} tab${n > 1 ? "s" : ""} asleep. They reload when you open them.` : "No idle tabs to put to sleep");
};
$("#organize").onclick = async (e) => {
  const tabs = await chrome.tabs.query({ windowId });
  if ((e as MouseEvent).shiftKey) {
    setView("ask");
    pickSkill("cluster-tabs");
    $<HTMLTextAreaElement>("#input").value = "Group my open tabs by task.";
    send();
    return;
  }
  const n = await applyClusters(clusterByHeuristic(tabs));
  toast(n ? `Made ${n} group${n > 1 ? "s" : ""}` : "Nothing to group: no site has two or more tabs");
};

onCoreEvent((m) => {
  if (m.event === "tabs") queueRender();
  if (m.event === "pending-context") takePendingContext();
  if (m.event === "core-down") setDest(null, m.message);
});

let roles: Role[] = [];
let role: Role | null = null;
let skill: Skill | null = null;
let skills: Skill[] = [];
let items: ContextItem[] = [];
let history: Msg[] = [];
let busy: AbortController | null = null;
let dest: Destination | null = null;

const thread = $("#thread");
const input = $<HTMLTextAreaElement>("#input");

function setDest(d: Destination | null, error?: string) {
  dest = d;
  const dot = $("#dest-dot");
  dot.className = `dot ${d ? (d.local ? "local" : "cloud") : "off"}`;
  $("#dest-text").textContent = d ? destinationLabel(d) : error ? "Tobari core is not connected" : "Connecting…";
  $("#dest").title = d ? `${d.model}\n${d.local ? "Prompts are processed on this computer" : `Prompts and attached context are sent to ${d.host}`}` : error ?? "";
}

async function boot() {
  try {
    const st = await core("status");
    setDest(st.destination);
    roles = await core("roles.list");
    const sel = $<HTMLSelectElement>("#role");
    sel.innerHTML = "";
    for (const r of roles) sel.append(h("option", { value: r.id, title: r.about }, r.name));
    const { roleId } = (await chrome.storage.local.get("roleId") as Record<string, any>);
    role = roles.find((r) => r.id === roleId) ?? roles[0];
    sel.value = role.id;
    sel.onchange = () => {
      role = roles.find((r) => r.id === sel.value) ?? roles[0];
      chrome.storage.local.set({ roleId: role.id });
    };
    skills = (await core("skills.list")).skills;
    if (!st.destination.local || st.sidecar.model_downloaded) renderEmpty();
    else renderSetup(st);
    await takePendingContext();
    await takePendingAsk();
    detectSiteTools();
  } catch (e) {
    setDest(null, String((e as Error).message));
    renderHostMissing(e);
  }
}

function renderHostMissing(e: unknown) {
  thread.innerHTML = "";
  const missing = isHostMissing(e);
  thread.append(
    h(
      "div",
      { class: "setup" },
      h("h2", {}, missing ? "Connect Tobari core" : "Tobari core stopped"),
      h("p", { class: "muted" }, missing ? "The panel talks to a small local program over native messaging. Install it once:" : String((e as Error)?.message ?? e)),
      missing ? h("pre", {}, "tobari install-host") : null,
      missing ? h("p", { class: "muted small" }, "Then reload this panel. Nothing listens on the network; the browser starts the program when you ask something.") : null,
      h("div", {}, h("button", { class: "btn", onclick: () => location.reload() }, "Try again")),
    ),
  );
}

function renderSetup(st: any) {
  thread.innerHTML = "";
  const bar = h("i");
  const status = h("p", { class: "muted small" }, "");
  const btn = h("button", { class: "btn primary" }, icon("download"), `Download ${st.sidecar.model}`);
  btn.onclick = async () => {
    btn.disabled = true;
    try {
      await core("models.download", { model: st.sidecar.model }, {
        onProgress: (d, t) => {
          bar.style.width = t ? `${(100 * d) / t}%` : "50%";
          status.textContent = `${(d / 1048576).toFixed(0)} of ${(t / 1048576).toFixed(0)} MB, checksum verified at the end`;
        },
      });
      toast("Model ready");
      renderEmpty();
    } catch (e: any) {
      status.textContent = e.message;
      btn.disabled = false;
    }
  };
  thread.append(
    h(
      "div",
      { class: "setup" },
      h("h2", {}, "Get the local model"),
      h("p", { class: "muted" }, `Tobari runs ${st.sidecar.model} on your ${st.sidecar.backend === "cpu" ? "CPU" : "GPU (" + st.sidecar.backend + ")"}. It downloads once from Hugging Face and is checked against a pinned SHA-256.`),
      h("div", { class: "progress" }, bar),
      status,
      h("div", {}, btn, " ", h("button", { class: "btn ghost", onclick: () => chrome.runtime.openOptionsPage() }, "Use a cloud model instead")),
    ),
  );
}

async function renderEmpty() {
  thread.innerHTML = "";
  const tab = await activeTab();
  const host = hostOf(tab?.url);
  const hour = new Date().getHours();
  const hello = hour < 5 ? "Working late" : hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const ideas: { icon: any; title: string; d: string; skill?: string; prompt: string; withTab?: boolean }[] = [
    { icon: "spark", title: "Summarize this page", d: "Key facts in a few bullets", skill: "summarize-page", prompt: "Summarize this page.", withTab: true },
    { icon: "globe", title: "Translate this page", d: "Keeps Japanese and Thai names intact", skill: "translate-page", prompt: "Translate this page into English.", withTab: true },
  ];
  if (host === "github.com" && /\/pull\/\d+/.test(tab?.url ?? "")) ideas.unshift({ icon: "spark", title: "Explain this pull request", d: "What changes, why, what to check", skill: "explain-github-pr", prompt: "Explain this pull request.", withTab: true });
  ideas.push({ icon: "tabs", title: "Group my tabs by task", d: "AI clusters, applied as tab groups", skill: "cluster-tabs", prompt: "Group my open tabs by task." });
  ideas.push({ icon: "book", title: "Save this page to memory", d: "A Markdown note you own", skill: "save-to-memory", prompt: "Save the important parts of this page to my memory.", withTab: true });
  const list = h("div", { class: "suggest" });
  for (const it of ideas.slice(0, 4)) {
    const b = h("button", {}, h("span", { class: "ic" }, icon(it.icon)), h("span", {}, h("b", {}, it.title), h("span", { class: "d" }, it.d)));
    b.onclick = async () => {
      if (it.skill) pickSkill(it.skill);
      if (it.withTab && tab && !items.some((x) => x.tabId === tab.id)) await addItem(() => tabItem(tab));
      input.value = it.prompt;
      send();
    };
    list.append(b);
  }
  thread.append(h("div", { class: "empty" }, h("h2", {}, `${hello}.`), h("p", {}, "Ask about this page, your tabs, or anything. Add context with @."), list));
}

function chip(it: ContextItem): HTMLElement {
  const x = h("button", { class: "x", title: "Remove" }, "×");
  x.onclick = () => {
    items = items.filter((i) => i.id !== it.id);
    renderChips();
  };
  return h("span", { class: "chip", title: it.source }, it.favicon ? favicon(it.favicon, it.icon) : icon(it.icon), h("span", {}, it.label), x);
}

function renderChips() {
  const c = $("#chips");
  c.innerHTML = "";
  items.forEach((it) => c.append(chip(it)));
  if (items.some((i) => i.image) && dest && !dest.images) {
    c.append(h("span", { class: "chip", style: "color:var(--warn)" }, icon("alert"), h("span", {}, `${prettyModel(dest.model)} reads text only; images will be skipped`)));
  }
  updateSend();
}

async function addItem(make: () => Promise<ContextItem | null>) {
  const placeholder = h("span", { class: "chip" }, h("span", {}, "Reading…"));
  $("#chips").append(placeholder);
  try {
    const it = await make();
    if (it) items.push(it);
  } catch (e: any) {
    toast(e.message ?? String(e), 3500);
  }
  renderChips();
}

function pickSkill(name: string | null) {
  skill = name ? skills.find((s) => s.name === name) ?? null : null;
  const pill = $("#skill-pill");
  pill.hidden = !skill;
  pill.innerHTML = "";
  if (skill) {
    const x = h("button", { title: "Remove skill" }, "×");
    x.onclick = () => pickSkill(null);
    pill.append(`/${skill.name}`, x);
    const r = roles.find((r) => r.id === skill!.role);
    if (r) {
      role = r;
      $<HTMLSelectElement>("#role").value = r.id;
    }
  }
}

let menuCtl: ReturnType<typeof showMenu> | null = null;
let trigger: { char: "@" | "/"; start: number } | null = null;

async function openPicker(char: "@" | "/", query: string) {
  const picker = $("#picker");
  if (char === "/") {
    const tab = await activeTab();
    const host = hostOf(tab?.url);
    const q = query.toLowerCase();
    const list = skills
      .filter((s) => !q || s.name.includes(q) || s.description.toLowerCase().includes(q))
      .sort((a, b) => Number(b.sites.includes(host)) - Number(a.sites.includes(host)));
    menuCtl = showMenu(
      picker,
      [
        ...list.map((s) => ({ group: "Skills", label: `/${s.name}`, hint: s.description, icon: "slash" as const, run: () => { clearTrigger(); pickSkill(s.name); } })),
        { group: "Make", label: "Turn this prompt into a skill…", icon: "plus" as const, run: () => { clearTrigger(); promptToSkill(); } },
      ],
      () => (menuCtl = null),
    );
    return;
  }
  const entries = await pickerEntries(query);
  menuCtl = showMenu(
    picker,
    entries.map((e) => ({
      group: e.group,
      label: e.label,
      hint: e.hint,
      icon: e.icon,
      img: e.favicon,
      run: () => {
        clearTrigger();
        if (e.group === "Files") $<HTMLInputElement>("#file").click();
        else addItem(e.make);
      },
    })),
    () => (menuCtl = null),
  );
}

function clearTrigger() {
  if (trigger) {
    const v = input.value;
    const end = input.selectionStart ?? v.length;
    input.value = v.slice(0, trigger.start) + v.slice(end);
    input.selectionStart = input.selectionEnd = trigger.start;
    trigger = null;
  }
  autosize(input);
  updateSend();
}

input.addEventListener("input", () => {
  autosize(input);
  updateSend();
  const pos = input.selectionStart ?? 0;
  const before = input.value.slice(0, pos);
  const m = /(^|\s)([@/])([^\s@/]*)$/.exec(before);
  const slashOk = m?.[2] === "/" && before.trimStart().startsWith("/") && before.trimStart().indexOf(" ") === -1;
  if (m && (m[2] === "@" || slashOk)) {
    trigger = { char: m[2] as "@" | "/", start: pos - m[3].length - 1 };
    openPicker(trigger.char, m[3]);
  } else if (trigger) {
    trigger = null;
    menuCtl?.close();
  }
});

input.addEventListener("keydown", (e) => {
  if (menuCtl) {
    if (e.key === "ArrowDown") return e.preventDefault(), menuCtl.move(1);
    if (e.key === "ArrowUp") return e.preventDefault(), menuCtl.move(-1);
    if (e.key === "Enter" || e.key === "Tab") return e.preventDefault(), menuCtl.pick();
    if (e.key === "Escape") return e.preventDefault(), menuCtl.close(), (trigger = null);
  }
  if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
    e.preventDefault();
    send();
  }
  if (e.key === "Backspace" && input.value === "" && items.length) {
    items.pop();
    renderChips();
  }
});
input.addEventListener("blur", () => setTimeout(() => menuCtl?.close(), 120));

$("#at-btn").onclick = () => {
  input.focus();
  trigger = { char: "@", start: input.selectionStart ?? input.value.length };
  input.setRangeText("@", trigger.start, trigger.start, "end");
  openPicker("@", "");
};
$("#slash-btn").onclick = () => {
  input.focus();
  trigger = { char: "/", start: 0 };
  input.setRangeText("/", 0, 0, "end");
  openPicker("/", "");
};
$("#attach-btn").onclick = () => $<HTMLInputElement>("#file").click();
$<HTMLInputElement>("#file").onchange = async (e) => {
  const files = (e.target as HTMLInputElement).files;
  if (!files?.length) return;
  await addItem(async () => {
    const list = await fileItems(files);
    items.push(...list.slice(1));
    return list[0] ?? null;
  });
  (e.target as HTMLInputElement).value = "";
};

document.addEventListener("dragover", (e) => e.preventDefault());
document.addEventListener("drop", async (e) => {
  e.preventDefault();
  const files = e.dataTransfer?.files;
  if (files?.length) {
    setView("ask");
    await addItem(async () => {
      const list = await fileItems(files);
      items.push(...list.slice(1));
      return list[0] ?? null;
    });
  }
});

function updateSend() {
  const send = $<HTMLButtonElement>("#send");
  if (busy) {
    setIcon(send, "stop");
    send.title = "Stop";
    send.disabled = false;
  } else {
    setIcon(send, "send");
    send.title = "Send (Enter)";
    send.disabled = !input.value.trim() && !skill;
  }
}

$("#send").onclick = () => (busy ? busy.abort() : send());

function stepCard(s: Step, resolve?: (a: "allow" | "always" | "reject") => void): HTMLElement {
  const cls = s.state === "denied" ? "deny" : s.state === "proposed" && resolve ? "confirm" : s.state === "done" ? "done" : "";
  const stateText: Record<string, string> = { proposed: resolve ? "needs your OK" : "checking", running: "running…", done: "done", denied: "blocked", rejected: "you said no", failed: "failed" };
  const args = { ...s.action.args };
  delete args.field_type;
  const card = h(
    "div",
    { class: `step ${cls}` },
    h("div", { class: "head" }, icon(s.state === "denied" ? "shield" : s.state === "done" ? "check" : "pointer"), h("span", { class: "tool" }, s.action.tool), h("span", { class: "state" }, stateText[s.state])),
    s.action.why ? h("div", { class: "why" }, s.action.why) : null,
    Object.keys(args).length ? h("div", { class: "args" }, JSON.stringify(args, null, 1).replace(/^\{\n|\n\}$/g, "")) : null,
    s.verdict.reasons.length && (s.state === "proposed" || s.state === "denied") ? h("ul", { class: "reasons" }, ...s.verdict.reasons.map((r) => h("li", {}, r))) : null,
    s.result && s.state !== "proposed" ? h("div", { class: "muted small" }, s.result.slice(0, 200)) : null,
  );
  if (resolve) {
    card.append(
      h(
        "div",
        { class: "btns" },
        h("button", { class: "btn primary", onclick: () => resolve("allow") }, icon("check"), "Allow once"),
        s.action.tool.startsWith("mcp.") ? null : h("button", { class: "btn", onclick: () => resolve("always") }, "Always on this site"),
        h("button", { class: "btn ghost danger", onclick: () => resolve("reject") }, "Don't"),
      ),
    );
  }
  return card;
}

function scrollDown() {
  thread.scrollTop = thread.scrollHeight;
}

async function send() {
  if (busy) return;
  const text = input.value.trim() || (skill ? `Run /${skill.name}.` : "");
  if (!text || !role) return;
  if (thread.querySelector(".empty, .setup")) thread.innerHTML = "";
  const sentItems = items;
  items = [];
  input.value = "";
  autosize(input);
  renderChips();
  const userBubble = h("div", { class: "msg user" }, text);
  if (sentItems.length || skill) {
    const ctx = h("div", { class: "ctx" });
    if (skill) ctx.append(h("span", { class: "chip" }, icon("slash"), h("span", {}, skill.name)));
    sentItems.forEach((it) => ctx.append(h("span", { class: "chip" }, it.favicon ? favicon(it.favicon, it.icon) : icon(it.icon), h("span", {}, it.label))));
    userBubble.append(ctx);
  }
  thread.append(userBubble);
  busy = new AbortController();
  updateSend();
  let bubble: HTMLElement | null = null;
  let body: HTMLElement | null = null;
  let raw = "";
  const newBubble = () => {
    raw = "";
    body = h("div", { class: "md" }, h("span", { class: "typing" }, h("i"), h("i"), h("i")));
    bubble = h("div", { class: "msg bot" }, h("div", { class: "meta" }, h("span", { class: `dot ${dest?.local ? "local" : "cloud"}` }), h("span", {}, prettyModel(dest?.model ?? ""))), body);
    thread.append(bubble);
    scrollDown();
  };
  const usedSkill = skill;
  try {
    const result = await runTurn({
      history,
      request: text,
      items: sentItems,
      role,
      skill: usedSkill,
      io: {
        signal: busy.signal,
        onDestination: (d) => {
          setDest(d);
          if (bubble) bubble.querySelector(".meta span:last-child")!.textContent = prettyModel(d.model);
        },
        onTurnStart: () => newBubble(),
        onDelta: (d) => {
          raw += d;
          const vis = visibleText(raw);
          if (body) body.innerHTML = vis ? renderMarkdown(vis) : '<span class="typing"><i></i><i></i><i></i></span>';
          scrollDown();
        },
        onStep: (s) => {
          const vis = visibleText(raw);
          if (bubble && !vis) bubble.remove();
          const id = `step-${s.action.tool}-${history.length}-${thread.children.length}`;
          const old = thread.querySelector<HTMLElement>(`[data-step="${(s as any)._id ?? ""}"]`);
          (s as any)._id ??= id;
          const card = stepCard(s);
          card.dataset.step = (s as any)._id;
          if (old) old.replaceWith(card);
          else thread.append(card);
          scrollDown();
        },
        confirm: (s) =>
          new Promise((resolve) => {
            const card = stepCard(s, (a) => {
              resolve(a);
            });
            card.dataset.step = (s as any)._id;
            const old = thread.querySelector<HTMLElement>(`[data-step="${(s as any)._id}"]`);
            if (old) old.replaceWith(card);
            else thread.append(card);
            scrollDown();
            busy?.signal.addEventListener("abort", () => resolve("reject"));
          }),
      },
    });
    history = result.history.slice(-24);
    if (bubble && body) addActions(bubble, visibleText(result.text));
    if (usedSkill?.name === "cluster-tabs") await applyClusterReply(result.text);
  } catch (e: any) {
    (bubble as HTMLElement | null)?.remove();
    if (!busy?.signal.aborted) {
      thread.append(h("div", { class: "err" }, isHostMissing(e) ? "Tobari core is not installed. Run `tobari install-host`." : e.message ?? String(e)));
      if (isHostMissing(e)) renderHostMissing(e);
    }
  } finally {
    busy = null;
    pickSkill(null);
    updateSend();
    scrollDown();
  }
}

function addActions(bubble: HTMLElement, text: string) {
  if (!text) return;
  const copy = h("button", { class: "icon-btn", title: "Copy" }, icon("copy"));
  copy.onclick = async () => {
    await navigator.clipboard.writeText(text);
    toast("Copied");
  };
  const save = h("button", { class: "icon-btn", title: "Save to memory" }, icon("book"));
  save.onclick = async () => {
    const tab = await activeTab();
    const note = `## ${new Date().toLocaleString()}\n\nSource: ${tab?.url ?? "chat"}\n\n${text}`;
    const name = await core("memory.write", { name: null, content: note, append: true });
    toast(`Saved to memory/${name}.md`);
  };
  const file = h("button", { class: "icon-btn", title: "Save as Markdown file" }, icon("save"));
  file.onclick = async () => {
    await chrome.downloads.download({ url: `data:text/markdown;charset=utf-8,${encodeURIComponent(text)}`, filename: `Tobari/answer-${Date.now()}.md` });
    toast("Saved to Downloads/Tobari");
  };
  bubble.append(h("div", { class: "actions" }, copy, save, file));
}

async function applyClusterReply(text: string) {
  const line = text.split("\n").find((l) => l.trim().startsWith('{"clusters"'));
  if (!line) return;
  try {
    const parsed = JSON.parse(line.trim());
    const n = await applyClusters(parsed.clusters ?? []);
    toast(`Applied ${n} tab group${n === 1 ? "" : "s"}`);
  } catch {}
}

async function promptToSkill() {
  const text = input.value.trim();
  if (!text) {
    toast("Write the prompt first, then turn it into a skill");
    return;
  }
  const name = prompt("Skill name (letters, digits, dashes)", text.split(/\s+/).slice(0, 3).join("-").toLowerCase());
  if (!name) return;
  const tab = await activeTab();
  const host = hostOf(tab?.url);
  const onlyHere = host && confirm(`Offer this skill only on ${host}?`);
  try {
    await core("skills.create", { name, description: text.slice(0, 120), prompt: text, sites: onlyHere ? [host] : [] });
    skills = (await core("skills.list")).skills;
    toast(`Saved as a skill in ~/.config/tobari/skills`);
  } catch (e: any) {
    toast(e.message, 3500);
  }
}

$("#dest").onclick = async () => {
  const menu = $("#provider-menu");
  if (!menu.hidden) return void (menu.hidden = true);
  try {
    const res = await core("providers.list");
    showMenu(menu, [
      ...res.providers.map((p: any) => ({
        group: "Send prompts to",
        label: destinationLabel(p.destination),
        hint: p.provider.id === res.active ? "active" : p.has_key ? "" : "needs key",
        icon: (p.destination.local ? "shield" : "globe") as any,
        run: async () => {
          if (!p.has_key) return chrome.runtime.openOptionsPage();
          const d = await core("providers.use", { provider: p.provider.id });
          setDest(d);
          toast(d.local ? "Prompts stay on this device" : `Prompts now go to ${d.host}`);
        },
      })),
      { group: "Manage", label: "Add a provider or API key…", icon: "gear" as const, run: () => chrome.runtime.openOptionsPage() },
    ]);
    setTimeout(() => document.addEventListener("click", () => (menu.hidden = true), { once: true }), 0);
  } catch (e: any) {
    toast(e.message);
  }
};

async function takePendingAsk() {
  const { pendingAsk, pendingSkill, pendingMemory } = (await chrome.storage.session.get(["pendingAsk", "pendingSkill", "pendingMemory"]) as Record<string, any>);
  if (!pendingAsk) return;
  await chrome.storage.session.remove(["pendingAsk", "pendingSkill", "pendingMemory"]);
  setView("ask");
  if (pendingSkill) {
    pickSkill(pendingSkill);
    const s = skills.find((k) => k.name === pendingSkill);
    if (s?.tools.includes("read_page") || s?.sites.length) {
      const tab = await activeTab();
      if (tab && /^(https?|file):/.test(tab.url ?? "") && pendingSkill !== "cluster-tabs") await addItem(() => tabItem(tab));
    }
  }
  if (pendingMemory) {
    const text: string = await core("memory.read", { name: pendingMemory }).catch(() => "");
    if (text) items.push({ id: Math.random().toString(36).slice(2), kind: "memory", label: pendingMemory, icon: "book", source: `memory/${pendingMemory}.md`, text });
    renderChips();
  }
  input.value = pendingAsk;
  send();
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === "session" && changes.pendingAsk?.newValue && role) takePendingAsk();
});

async function takePendingContext() {
  const { pendingContext } = (await chrome.storage.session.get("pendingContext") as Record<string, any>);
  if (!pendingContext) return;
  await chrome.storage.session.remove("pendingContext");
  setView("ask");
  if (pendingContext.kind === "highlight") {
    items.push({ id: Math.random().toString(36).slice(2), kind: "highlight", label: `“${pendingContext.text.slice(0, 40)}”`, icon: "highlight", source: pendingContext.url, text: pendingContext.text, tabId: pendingContext.tabId });
    renderChips();
  } else if (pendingContext.tabId) {
    const t = await chrome.tabs.get(pendingContext.tabId);
    await addItem(() => tabItem(t));
  }
  input.focus();
}

async function detectSiteTools() {
  const box = $("#site-tools");
  box.hidden = true;
  const tab = await activeTab();
  if (!tab?.id || !/^(https:|http:\/\/(localhost|127\.0\.0\.1)[:/])/.test(tab.url ?? "")) return;
  let endpoint: string | null = null;
  try {
    endpoint = (await readTab(tab)).mcp;
  } catch {
    return;
  }
  if (!endpoint) return;
  const origin = new URL(tab.url!).origin;
  const grants = await mcp.grantedOrigins();
  box.innerHTML = "";
  if (grants[origin] === endpoint) {
    try {
      const tools = await mcp.connect(origin, endpoint);
      box.append(icon("plug"), h("span", {}, `${new URL(origin).hostname} tools on: ${tools.map((t) => t.name).slice(0, 4).join(", ")}${tools.length > 4 ? "…" : ""}`));
      const off = h("button", { class: "btn" }, "Turn off");
      off.onclick = async () => {
        await mcp.revoke(origin);
        detectSiteTools();
      };
      box.append(off);
    } catch (e: any) {
      box.append(icon("alert"), h("span", {}, `Site tools failed: ${e.message}`));
    }
  } else {
    box.append(icon("plug"), h("span", {}, `${new URL(origin).hostname} offers tools for the assistant.`));
    const on = h("button", { class: "btn" }, "Review…");
    on.onclick = async () => {
      const ok = confirm(
        `${new URL(origin).hostname} offers tools at\n${endpoint}\n\nIf you allow it, Tobari can list and call this site's tools. Every call still needs your OK. Allow?`,
      );
      if (!ok) return;
      await mcp.grant(origin, endpoint!);
      detectSiteTools();
    };
    box.append(on);
  }
  box.hidden = false;
}

chrome.tabs.onActivated.addListener(() => {
  detectSiteTools();
  if (thread.querySelector(".empty")) renderEmpty();
});
chrome.tabs.onUpdated.addListener((_id, info, tab) => {
  if (info.status === "complete" && tab.active) detectSiteTools();
});

boot();
updateSend();
