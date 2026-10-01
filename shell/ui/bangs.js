import table from "./bangs.json" with { type: "json" };

const BANGS = Object.fromEntries(table.map((b) => [b.token, b]));
const SUBREDDIT = /^r\/([A-Za-z0-9_]+)$/;

export function parseBang(text) {
  const m = text.match(/(?:^|\s)!([A-Za-z0-9_\/]+)(?:\s|$)/);
  if (!m) return null;
  const token = m[1];
  const query = (text.slice(0, m.index) + " " + text.slice(m.index + m[0].length)).trim();
  const sub = token.match(SUBREDDIT);
  if (sub) {
    return { token, name: "r/" + sub[1], query, url: `https://www.reddit.com/r/${sub[1]}/search/?restrict_sr=1&q={}` };
  }
  const entry = BANGS[token.toLowerCase()];
  if (!entry) return null;
  return { token, name: entry.name, query, url: entry.url, raw: entry.raw };
}

export function applyBang(bang, query) {
  const value = bang.raw ? encodeURIComponent(query).replace(/%2F/g, "/") : encodeURIComponent(query);
  return bang.url.replace("{}", value);
}

export function suggestBangs(prefix, limit = 8) {
  const p = prefix.toLowerCase();
  return table.filter((b) => b.token.startsWith(p)).slice(0, limit).map((b) => ({ token: b.token, name: b.name }));
}

export function bangCount() { return table.length; }

export function allBangs() {
  return table.map((b) => ({ token: b.token, name: b.name })).sort((a, b) => a.token.localeCompare(b.token));
}
