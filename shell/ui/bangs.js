const BANGS = {
  g:        { name: "Google",          url: "https://www.google.com/search?q={}" },
  ddg:      { name: "DuckDuckGo",      url: "https://duckduckgo.com/?q={}" },
  b:        { name: "Brave Search",    url: "https://search.brave.com/search?q={}" },
  sp:       { name: "Startpage",       url: "https://www.startpage.com/sp/search?query={}" },
  w:        { name: "Wikipedia",       url: "https://en.wikipedia.org/w/index.php?search={}" },
  yt:       { name: "YouTube",         url: "https://www.youtube.com/results?search_query={}" },
  gh:       { name: "GitHub",          url: "https://github.com/search?q={}" },
  ghr:      { name: "GitHub repos",    url: "https://github.com/search?type=repositories&q={}" },
  so:       { name: "Stack Overflow",  url: "https://stackoverflow.com/search?q={}" },
  mdn:      { name: "MDN",             url: "https://developer.mozilla.org/en-US/search?q={}" },
  cr:       { name: "crates.io",       url: "https://crates.io/search?q={}" },
  docsrs:   { name: "docs.rs",         url: "https://docs.rs/releases/search?query={}" },
  rust:     { name: "Rust std docs",   url: "https://doc.rust-lang.org/std/index.html?search={}" },
  npm:      { name: "npm",             url: "https://www.npmjs.com/search?q={}" },
  pypi:     { name: "PyPI",            url: "https://pypi.org/search/?q={}" },
  hn:       { name: "Hacker News",     url: "https://hn.algolia.com/?q={}" },
  lob:      { name: "Lobsters",        url: "https://lobste.rs/search?q={}" },
  r:        { name: "Reddit",          url: "https://www.reddit.com/search/?q={}" },
  aur:      { name: "AUR",             url: "https://aur.archlinux.org/packages?K={}" },
  arch:     { name: "Arch Wiki",       url: "https://wiki.archlinux.org/index.php?search={}" },
  fedora:   { name: "Fedora packages", url: "https://packages.fedoraproject.org/search?query={}" },
  flat:     { name: "Flathub",         url: "https://flathub.org/apps/search?q={}" },
  nix:      { name: "Nix packages",    url: "https://search.nixos.org/packages?query={}" },
  man:      { name: "man pages",       url: "https://man7.org/linux/man-pages/man1/{}.1.html", raw: true },
  caniuse:  { name: "Can I Use",       url: "https://caniuse.com/?search={}" },
  cve:      { name: "CVE search",      url: "https://cve.mitre.org/cgi-bin/cvekey.cgi?keyword={}" },
  osm:      { name: "OpenStreetMap",   url: "https://www.openstreetmap.org/search?query={}" },
  wa:       { name: "Wolfram Alpha",   url: "https://www.wolframalpha.com/input?i={}" },
  tr:       { name: "Translate",       url: "https://translate.google.com/?text={}" },
  ia:       { name: "Internet Archive",url: "https://archive.org/search?query={}" },
  wb:       { name: "Wayback Machine", url: "https://web.archive.org/web/*/{}", raw: true },
  gl:       { name: "GitLab",          url: "https://gitlab.com/search?search={}" },
  sr:       { name: "sourcehut",       url: "https://sr.ht/projects?search={}" },
  cef:      { name: "CEF forum",       url: "https://magpcss.org/ceforum/search.php?keywords={}" },
  crbug:    { name: "Chromium bugs",   url: "https://issues.chromium.org/issues?q={}" }
};

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
  const out = [];
  for (const [token, entry] of Object.entries(BANGS)) {
    if (token.startsWith(p)) out.push({ token, name: entry.name });
    if (out.length >= limit) break;
  }
  return out;
}

export function bangCount() { return Object.keys(BANGS).length; }

export function allBangs() {
  return Object.entries(BANGS)
    .map(([token, entry]) => ({ token, name: entry.name }))
    .sort((a, b) => a.token.localeCompare(b.token));
}
