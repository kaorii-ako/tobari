import { activeTab, targetWindowId, windowTabs } from "./win";
import { core, Destination } from "./core";
import { ContextItem, readTab, tabListText } from "./context";
import { clickInPage, extractTablesInPage, fieldTypeInPage, inTab, typeInPage } from "./page";
import * as mcp from "./mcp";
import { hostOf } from "./tabs";

export type Msg = { role: "system" | "user" | "assistant"; content: string; images?: string[] };

export type Role = { id: string; name: string; about: string; tools: string[]; skills: string[]; prompt: string };
export type Skill = { name: string; description: string; role: string; tools: string[]; sites: string[]; instructions: string };

export type Action = { tool: string; args: Record<string, any>; why: string };
export type Verdict = { decision: "allow" | "confirm" | "deny"; reasons: string[] };
export type StepState = "proposed" | "running" | "done" | "denied" | "rejected" | "failed";
export type Step = { action: Action; verdict: Verdict; state: StepState; result?: string };

export type AgentIO = {
  onDestination: (d: Destination) => void;
  onDelta: (text: string) => void;
  onTurnStart: () => void;
  onStep: (step: Step) => void;
  confirm: (step: Step) => Promise<"allow" | "always" | "reject">;
  signal: AbortSignal;
};

const TOOL_DOCS: Record<string, string> = {
  read_page: 'read_page {"tab_id"?: number} — text of the page plus numbered interactive elements [ref]',
  extract_table: 'extract_table {"tab_id"?: number} — every HTML table as rows',
  list_tabs: "list_tabs {} — open tabs with ids",
  click: 'click {"ref": number, "label": "visible text"} — click element [ref] from read_page',
  type: 'type {"ref": number, "text": "...", "submit"?: bool} — type into a field',
  submit: 'submit {"ref": number, "label": "..."} — click a button that sends, buys or posts',
  navigate: 'navigate {"url": "https://..."} — load a URL in the current tab',
  open_tab: 'open_tab {"url": "https://..."} — open a URL in a new tab',
  close_tab: 'close_tab {"tab_id": number}',
  save_file: 'save_file {"filename": "name.md", "content": "..."} — save into Downloads',
  write_memory: 'write_memory {"name"?: "note-name", "content": "markdown"} — save to the user\'s memory',
  search_memory: 'search_memory {"query": "..."} — search the user\'s Markdown memory',
};

export const MAX_STEPS = 8;

function untrustedBudget(texts: string[]): string {
  return texts.join("\n").slice(-200_000);
}

export async function buildSystem(role: Role, skill: Skill | null, siteTools: mcp.McpTool[]): Promise<string> {
  const rules: string = await core("guard.rules");
  const allowed = skill?.tools?.length ? role.tools.filter((t) => skill.tools.includes(t) || ["read_page", "list_tabs"].includes(t)) : role.tools;
  const docs = allowed.filter((t) => TOOL_DOCS[t]).map((t) => `- ${TOOL_DOCS[t]}`);
  for (const t of siteTools) docs.push(`- mcp.${t.name} ${JSON.stringify((t.inputSchema as any)?.properties ?? {})} — site tool: ${t.description ?? ""}`.slice(0, 400));
  const today = new Date().toLocaleDateString(undefined, { weekday: "long", year: "numeric", month: "long", day: "numeric" });
  return [
    rules,
    `Today is ${today}. You are in the ${role.name} role. ${role.prompt}`,
    docs.length ? `Tools you may call, one per reply:\n${docs.join("\n")}` : "You have no tools in this role. Answer from the context only.",
    "After a tool runs you get its result and can continue. When you have the answer, reply in Markdown without a tool line. Keep answers short unless asked for detail.",
    skill ? `Active skill \`${skill.name}\`:\n${skill.instructions}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

export async function contextMessage(items: ContextItem[]): Promise<{ text: string; images: string[]; untrusted: string[] }> {
  const blocks: string[] = [];
  const untrusted: string[] = [];
  const images: string[] = [];
  for (const it of items) {
    if (it.image) images.push(it.image);
    if (it.text) {
      blocks.push(await core("guard.wrap", { source: `${it.kind}: ${it.source}`, text: it.text }));
      untrusted.push(it.text);
    }
  }
  return { text: blocks.join("\n\n"), images, untrusted };
}

async function execute(action: Action, untrusted: string[]): Promise<string> {
  const a = action.args ?? {};
  const tab = a.tab_id ? await chrome.tabs.get(Number(a.tab_id)) : await activeTab();
  switch (action.tool) {
    case "read_page": {
      const r = await readTab(tab);
      untrusted.push(r.text);
      return `${r.text}\n\nInteractive elements:\n${r.elements || "(none)"}`;
    }
    case "extract_table": {
      const tables = await inTab(tab.id!, extractTablesInPage);
      const md = tables.map((rows, i) => `Table ${i + 1}\n` + rows.map((r) => `| ${r.join(" | ")} |`).join("\n")).join("\n\n");
      untrusted.push(md);
      return md || "(no tables on this page)";
    }
    case "list_tabs":
      return tabListText(await windowTabs());
    case "click":
    case "submit": {
      const r = await inTab(tab.id!, clickInPage, Number(a.ref));
      if (!r.ok) throw new Error(r.error);
      await new Promise((res) => setTimeout(res, 900));
      return `clicked [${a.ref}] ${r.label}. The page may have changed; call read_page to see it.`;
    }
    case "type": {
      const r = await inTab(tab.id!, typeInPage, Number(a.ref), String(a.text ?? ""), !!a.submit);
      if (!r.ok) throw new Error(r.error);
      return `typed into [${a.ref}]${a.submit ? " and submitted" : ""}`;
    }
    case "navigate":
      await chrome.tabs.update(tab.id!, { url: String(a.url) });
      await waitForLoad(tab.id!);
      return `loaded ${a.url}`;
    case "open_tab": {
      const t = await chrome.tabs.create({ url: String(a.url), active: false });
      return `opened tab ${t.id}: ${a.url}`;
    }
    case "close_tab":
      await chrome.tabs.remove(Number(a.tab_id));
      return `closed tab ${a.tab_id}`;
    case "save_file": {
      const name = String(a.filename ?? "tobari.md").replace(/[\\/:*?"<>|]+/g, "-").slice(0, 120);
      const url = `data:text/plain;charset=utf-8,${encodeURIComponent(String(a.content ?? ""))}`;
      await chrome.downloads.download({ url, filename: `Tobari/${name}`, saveAs: false });
      return `saved Downloads/Tobari/${name}`;
    }
    case "write_memory": {
      const name: string = await core("memory.write", { name: a.name || null, content: String(a.content ?? ""), append: true });
      return `saved to memory/${name}.md`;
    }
    case "search_memory": {
      const hits: { name: string; line: number; text: string }[] = await core("memory.search", { query: String(a.query ?? ""), limit: 10 });
      return hits.map((h) => `${h.name}:${h.line} ${h.text}`).join("\n") || "(no matches)";
    }
    default:
      if (action.tool.startsWith("mcp.")) {
        const origin = new URL(tab.url!).origin;
        const out = await mcp.callTool(origin, action.tool.slice(4), a);
        untrusted.push(out);
        return out;
      }
      throw new Error(`unknown tool ${action.tool}`);
  }
}

function waitForLoad(tabId: number): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      clearTimeout(timer);
      resolve();
    };
    const listener = (id: number, info: { status?: string }) => {
      if (id === tabId && info.status === "complete") done();
    };
    const timer = setTimeout(done, 15000);
    chrome.tabs.onUpdated.addListener(listener);
  });
}

export async function runTurn(opts: {
  history: Msg[];
  request: string;
  items: ContextItem[];
  role: Role;
  skill: Skill | null;
  io: AgentIO;
}): Promise<{ history: Msg[]; text: string }> {
  const { role, skill, io } = opts;
  const tab = await activeTab();
  const origin = /^https?:/.test(tab?.url ?? "") ? new URL(tab.url!).origin : "";
  const siteTools = origin ? mcp.toolsFor(origin) : [];
  const system = await buildSystem(role, skill, siteTools);
  const ctx = await contextMessage(opts.items);
  const untrusted = [...ctx.untrusted];
  const userMsg: Msg = { role: "user", content: ctx.text ? `${opts.request}\n\n${ctx.text}` : opts.request, images: ctx.images.length ? ctx.images : undefined };
  const convo: Msg[] = [...opts.history.filter((m) => m.role !== "system"), userMsg];
  const settings = await core("settings.get").catch(() => ({ auto_approve_hosts: [], second_check: true }));
  const allTabs = await chrome.tabs.query({});
  let finalText = "";

  for (let step = 0; step <= MAX_STEPS; step++) {
    if (io.signal.aborted) break;
    io.onTurnStart();
    const reply = await core<{ text: string }>(
      "chat",
      { messages: [{ role: "system", content: system }, ...convo], max_tokens: 2048 },
      { onDelta: io.onDelta, onDestination: io.onDestination },
    );
    const text = reply.text;
    convo.push({ role: "assistant", content: text });
    const action: Action | null = await core("guard.parse", { text });
    if (!action || step === MAX_STEPS) {
      finalText = text;
      break;
    }
    action.args ??= {};
    if (action.tool === "type" && action.args.ref !== undefined && tab?.id) {
      action.args.field_type = await inTab(tab.id, fieldTypeInPage, Number(action.args.ref)).catch(() => "");
    }
    const current = await activeTab();
    const verdict: Verdict = await core("guard.check", {
      action,
      context: {
        user_request: opts.request,
        allowed_tools: [...role.tools, ...siteTools.map((t) => `mcp.${t.name}`)],
        tab_hosts: allTabs.map((t) => hostOf(t.url)).filter(Boolean),
        auto_approve_hosts: settings.auto_approve_hosts ?? [],
        current_host: hostOf(current?.url),
        untrusted_text: untrustedBudget(untrusted),
      },
      judge: !!settings.second_check && !["read_page", "list_tabs", "extract_table", "search_memory"].includes(action.tool),
    });
    const s: Step = { action, verdict, state: "proposed" };
    io.onStep(s);
    let resultText: string;
    if (verdict.decision === "deny") {
      s.state = "denied";
      io.onStep(s);
      resultText = `BLOCKED by Tobari's safety check: ${verdict.reasons.join("; ")}. Do not retry this step. Tell the user what you wanted to do and why it was blocked.`;
    } else {
      let go = verdict.decision === "allow";
      if (!go) {
        const answer = await io.confirm(s);
        if (answer === "always" && current?.url) {
          const host = hostOf(current.url);
          const list = Array.from(new Set([...(settings.auto_approve_hosts ?? []), host]));
          settings.auto_approve_hosts = list;
          await core("settings.save", { settings: { ...settings, auto_approve_hosts: list } }).catch(() => {});
        }
        go = answer !== "reject";
      }
      if (!go) {
        s.state = "rejected";
        io.onStep(s);
        resultText = "The user rejected this step. Ask what they want instead, or finish with what you have.";
      } else {
        s.state = "running";
        io.onStep(s);
        try {
          const out = await execute(action, untrusted);
          s.state = "done";
          s.result = out.slice(0, 400);
          io.onStep(s);
          resultText = await core("guard.wrap", { source: `tool ${action.tool}`, text: out.slice(0, 60_000) });
        } catch (e: any) {
          s.state = "failed";
          s.result = String(e?.message ?? e);
          io.onStep(s);
          resultText = `The tool failed: ${s.result}`;
        }
      }
    }
    convo.push({ role: "user", content: `Result of ${action.tool}:\n${resultText}` });
  }
  return { history: convo, text: finalText };
}

export function visibleText(reply: string): string {
  return reply
    .split("\n")
    .filter((l) => !/^\s*(```json)?\s*\{\s*"tool"\s*:/.test(l))
    .join("\n")
    .replace(/```\s*$/g, "")
    .trim();
}
