export type GroupColor = "grey" | "blue" | "red" | "yellow" | "green" | "pink" | "purple" | "cyan" | "orange";
export type Cluster = { name: string; color?: GroupColor; tabs: number[] };

const COLORS: GroupColor[] = ["blue", "green", "orange", "purple", "cyan", "pink", "yellow", "red", "grey"];
const SECOND_LEVEL = new Set(["co", "com", "ac", "or", "ne", "go", "gov", "edu", "net", "org", "in"]);

export function siteOf(url?: string): string {
  if (!url) return "";
  try {
    const u = new URL(url);
    if (!/^https?:$/.test(u.protocol)) return "";
    const parts = u.hostname.replace(/^www\./, "").split(".");
    if (parts.length >= 3 && parts[parts.length - 1].length === 2 && SECOND_LEVEL.has(parts[parts.length - 2])) {
      return parts.slice(-3).join(".");
    }
    return parts.slice(-2).join(".");
  } catch {
    return "";
  }
}

export function hostOf(url?: string): string {
  try {
    return new URL(url ?? "").hostname;
  } catch {
    return "";
  }
}

function prettySite(site: string): string {
  const base = site.split(".")[0];
  return base.charAt(0).toUpperCase() + base.slice(1);
}

export function clusterByHeuristic(tabs: chrome.tabs.Tab[]): Cluster[] {
  const bySite = new Map<string, number[]>();
  for (const t of tabs) {
    if (t.pinned || t.id === undefined) continue;
    const s = siteOf(t.url);
    if (!s) continue;
    bySite.set(s, [...(bySite.get(s) ?? []), t.id]);
  }
  return [...bySite.entries()]
    .filter(([, ids]) => ids.length >= 2)
    .sort((a, b) => b[1].length - a[1].length)
    .map(([site, ids], i) => ({ name: prettySite(site), color: COLORS[i % COLORS.length], tabs: ids }));
}

export async function applyClusters(clusters: Cluster[]): Promise<number> {
  let n = 0;
  for (const [i, c] of clusters.entries()) {
    const ids = c.tabs.filter((x) => Number.isInteger(x));
    if (ids.length === 0) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds: ids as [number, ...number[]] });
      await chrome.tabGroups.update(groupId, { title: c.name.slice(0, 40), color: c.color && COLORS.includes(c.color) ? c.color : COLORS[i % COLORS.length] });
      n++;
    } catch {}
  }
  return n;
}

export async function ungroupAll(windowId?: number) {
  const tabs = await chrome.tabs.query(windowId === undefined ? {} : { windowId });
  const grouped = tabs.filter((t) => t.groupId !== -1 && t.id !== undefined).map((t) => t.id!) ;
  if (grouped.length) await chrome.tabs.ungroup(grouped as [number, ...number[]]);
}

export async function discardIdleTabs(minutes: number): Promise<number> {
  const cutoff = Date.now() - minutes * 60_000;
  const tabs = await chrome.tabs.query({ active: false, discarded: false, audible: false, pinned: false });
  let n = 0;
  for (const t of tabs) {
    const last = (t as chrome.tabs.Tab & { lastAccessed?: number }).lastAccessed ?? Date.now();
    if (t.id !== undefined && last < cutoff && /^https?:/.test(t.url ?? "")) {
      try {
        await chrome.tabs.discard(t.id);
        n++;
      } catch {}
    }
  }
  return n;
}

export type Workspace = { id: string; name: string; color: string; tabs: { url: string; title: string; pinned: boolean }[]; updated: number };

export async function listWorkspaces(): Promise<{ list: Workspace[]; current: string }> {
  const { workspaces, currentWorkspace } = (await chrome.storage.local.get(["workspaces", "currentWorkspace"]) as Record<string, any>);
  const list: Workspace[] = workspaces ?? [{ id: "home", name: "Home", color: "#1b345c", tabs: [], updated: Date.now() }];
  return { list, current: currentWorkspace ?? list[0].id };
}

export async function saveWorkspaces(list: Workspace[], current: string) {
  await chrome.storage.local.set({ workspaces: list, currentWorkspace: current });
}

export async function switchWorkspace(targetId: string, windowId: number) {
  const { list, current } = await listWorkspaces();
  if (targetId === current) return;
  const tabs = await chrome.tabs.query({ windowId });
  const keep = tabs.filter((t) => /^(https?|file):/.test(t.url ?? ""));
  const cur = list.find((w) => w.id === current);
  if (cur) {
    cur.tabs = keep.map((t) => ({ url: t.url!, title: t.title ?? "", pinned: !!t.pinned }));
    cur.updated = Date.now();
  }
  const target = list.find((w) => w.id === targetId);
  if (!target) return;
  await saveWorkspaces(list, targetId);
  const created: number[] = [];
  if (target.tabs.length === 0) {
    const t = await chrome.tabs.create({ windowId, active: true });
    if (t.id !== undefined) created.push(t.id);
  }
  for (const [i, t] of target.tabs.entries()) {
    const nt = await chrome.tabs.create({ windowId, url: t.url, pinned: t.pinned, active: i === 0 });
    if (nt.id !== undefined) created.push(nt.id);
    if (i > 0 && nt.id !== undefined) chrome.tabs.discard(nt.id).catch(() => {});
  }
  const close = tabs.map((t) => t.id!).filter((id) => id !== undefined && !created.includes(id));
  if (close.length) await chrome.tabs.remove(close);
}
