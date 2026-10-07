// Tab grouping. Groups tabs of the same site together in their window,
// using Chromium's own tab groups. Only ungrouped tabs, or groups Tobari made,
// are ever moved: a group you made by hand is left alone.

const AUTO_KEY = "autoGroupBySite";
const OURS_KEY = "tobariGroups"; // groupId -> site, for groups Tobari made
const COLORS = ["grey", "blue", "red", "yellow", "green", "pink", "purple", "cyan", "orange"];

// Public suffixes with two labels that are common enough to matter here.
const TWO_LEVEL = new Set(["co.uk", "org.uk", "ac.uk", "gov.uk", "com.au", "net.au", "org.au", "co.jp", "ne.jp",
  "or.jp", "co.nz", "com.br", "com.cn", "com.mx", "co.in", "co.kr", "co.za", "com.tr", "com.tw", "com.sg", "co.th", "in.th"]);

export function siteOf(url) {
  let host;
  try {
    const u = new URL(url);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    host = u.hostname;
  } catch {
    return null;
  }
  if (/^[\d.]+$/.test(host) || host.includes(":") || !host.includes(".")) return host;
  const labels = host.split(".");
  const take = TWO_LEVEL.has(labels.slice(-2).join(".")) ? 3 : 2;
  return labels.slice(-take).join(".");
}

function titleFor(site) {
  if (/^[\d.]+$/.test(site) || site.includes(":")) return site;
  const name = site.split(".")[0];
  return name.charAt(0).toUpperCase() + name.slice(1);
}

function colorFor(name) {
  let h = 0;
  for (const c of name) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  return COLORS[h % COLORS.length];
}

async function ours() {
  return (await chrome.storage.session.get(OURS_KEY))[OURS_KEY] || {};
}

async function rememberOurs(map) {
  await chrome.storage.session.set({ [OURS_KEY]: map });
}

export async function autoGroupEnabled() {
  return Boolean((await chrome.storage.local.get(AUTO_KEY))[AUTO_KEY]);
}

export async function setAutoGroup(on) {
  await chrome.storage.local.set({ [AUTO_KEY]: Boolean(on) });
}

/**
 * Applies a grouping: |groups| is [{name, tabIds}]. Existing Tobari groups
 * with the same name in the window are reused.
 */
export async function applyGroups(windowId, groups) {
  const mine = await ours();
  const existing = await chrome.tabGroups.query({ windowId });
  let made = 0;
  for (const g of groups) {
    if (!g.tabIds?.length) continue;
    const reuse = existing.find((e) => e.title === g.name && mine[e.id]);
    const groupId = await chrome.tabs.group(
      reuse ? { groupId: reuse.id, tabIds: g.tabIds } : { tabIds: g.tabIds, createProperties: { windowId } },
    );
    await chrome.tabGroups.update(groupId, { title: g.name, color: reuse?.color || colorFor(g.name) });
    mine[groupId] = g.name;
    made++;
  }
  await rememberOurs(mine);
  return made;
}

/** Tabs in |windowId| that Tobari may regroup. */
export async function regroupableTabs(windowId) {
  const mine = await ours();
  const tabs = await chrome.tabs.query({ windowId, pinned: false });
  return tabs.filter((t) => (t.groupId === -1 || mine[t.groupId]) && /^https?:/.test(t.url || ""));
}

/** Groups every site with at least |minimum| tabs. Returns groups made. */
export async function groupBySite(windowId, minimum = 2) {
  const buckets = new Map();
  for (const t of await regroupableTabs(windowId)) {
    const site = siteOf(t.url);
    if (!site) continue;
    if (!buckets.has(site)) buckets.set(site, []);
    buckets.get(site).push(t);
  }
  const groups = [];
  for (const [site, tabs] of buckets) {
    if (tabs.length >= minimum) groups.push({ name: titleFor(site), tabIds: tabs.map((t) => t.id) });
  }
  return applyGroups(windowId, groups);
}

/** Ungroups everything Tobari grouped in the window. */
export async function ungroupOurs(windowId) {
  const mine = await ours();
  const tabs = await chrome.tabs.query({ windowId });
  const ids = tabs.filter((t) => mine[t.groupId]).map((t) => t.id);
  if (ids.length) await chrome.tabs.ungroup(ids);
  return ids.length;
}
