export type McpTool = { name: string; description?: string; inputSchema?: unknown };

type Session = { endpoint: string; sessionId: string | null; tools: McpTool[] };

const sessions = new Map<string, Session>();
let rpcId = 0;

async function rpc(s: Session, method: string, params: unknown, notify = false): Promise<any> {
  const headers: Record<string, string> = { "Content-Type": "application/json", Accept: "application/json, text/event-stream", "MCP-Protocol-Version": "2025-06-18" };
  if (s.sessionId) headers["Mcp-Session-Id"] = s.sessionId;
  const body = notify ? { jsonrpc: "2.0", method, params } : { jsonrpc: "2.0", id: ++rpcId, method, params };
  const r = await fetch(s.endpoint, { method: "POST", headers, body: JSON.stringify(body), credentials: "omit" });
  const sid = r.headers.get("Mcp-Session-Id");
  if (sid) s.sessionId = sid;
  if (notify) return null;
  if (!r.ok) throw new Error(`MCP ${method} failed: HTTP ${r.status}`);
  const type = r.headers.get("Content-Type") ?? "";
  let msg: any;
  if (type.includes("text/event-stream")) {
    const text = await r.text();
    const datas = text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5).trim());
    msg = datas.map((d) => JSON.parse(d)).find((m) => m.id !== undefined) ?? {};
  } else {
    msg = await r.json();
  }
  if (msg.error) throw new Error(`MCP ${method}: ${msg.error.message ?? JSON.stringify(msg.error)}`);
  return msg.result;
}

export async function grantedOrigins(): Promise<Record<string, string>> {
  const { mcpGrants } = (await chrome.storage.local.get("mcpGrants") as Record<string, any>);
  return mcpGrants ?? {};
}

export async function grant(origin: string, endpoint: string) {
  const g = await grantedOrigins();
  g[origin] = endpoint;
  await chrome.storage.local.set({ mcpGrants: g });
}

export async function revoke(origin: string) {
  const g = await grantedOrigins();
  delete g[origin];
  sessions.delete(origin);
  await chrome.storage.local.set({ mcpGrants: g });
}

export async function connect(origin: string, endpoint: string): Promise<McpTool[]> {
  const ep = new URL(endpoint);
  if (ep.protocol !== "https:" && !["localhost", "127.0.0.1"].includes(ep.hostname)) throw new Error("site MCP servers must use https");
  if (ep.origin !== origin && !ep.hostname.endsWith(`.${new URL(origin).hostname}`)) throw new Error("the MCP endpoint must be on the same site that advertised it");
  const existing = sessions.get(origin);
  if (existing) return existing.tools;
  const s: Session = { endpoint, sessionId: null, tools: [] };
  await rpc(s, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "Tobari", version: chrome.runtime.getManifest().version } });
  await rpc(s, "notifications/initialized", {}, true);
  const res = await rpc(s, "tools/list", {});
  s.tools = (res?.tools ?? []).slice(0, 40);
  sessions.set(origin, s);
  return s.tools;
}

export async function callTool(origin: string, name: string, args: unknown): Promise<string> {
  const s = sessions.get(origin);
  if (!s) throw new Error("not connected to this site's tools");
  const res = await rpc(s, "tools/call", { name, arguments: args ?? {} });
  const parts = (res?.content ?? []).map((c: any) => (c.type === "text" ? c.text : `[${c.type}]`));
  return parts.join("\n").slice(0, 60_000) || JSON.stringify(res).slice(0, 60_000);
}

export function toolsFor(origin: string): McpTool[] {
  return sessions.get(origin)?.tools ?? [];
}
