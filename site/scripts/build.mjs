#!/usr/bin/env node
import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked } from "marked";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SITE, "..");
const DIST = path.join(SITE, "dist");
const OWNER_REPO = "kaorii-ako/tobari";
const GH = `https://github.com/${OWNER_REPO}`;
const ON_VERCEL = !!process.env.VERCEL;
const BASE = (process.env.SITE_BASE || (ON_VERCEL ? "/" : "/")).replace(/\/?$/, "/");
const SITE_URL = (process.env.SITE_URL || (ON_VERCEL && process.env.VERCEL_PROJECT_PRODUCTION_URL ? `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}` : "https://kaorii-ako.github.io/tobari")).replace(/\/$/, "");

const esc = (s) => String(s ?? "").replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");

function rev() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 7) ?? null;
  }
}

async function json(file) {
  return JSON.parse(await readFile(path.join(REPO, file), "utf8"));
}

async function releases() {
  const url = `https://api.github.com/repos/${OWNER_REPO}/releases?per_page=100`;
  const headers = { Accept: "application/vnd.github+json", "User-Agent": "tobari-site-build" };
  if (process.env.GITHUB_TOKEN) headers.Authorization = `Bearer ${process.env.GITHUB_TOKEN}`;
  let lastError = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try {
      const r = await fetch(url, { headers });
      if (r.status === 401 && headers.Authorization) {
        delete headers.Authorization;
        continue;
      }
      if (!r.ok) throw new Error(`GitHub API ${r.status}: ${(await r.text()).slice(0, 200)}`);
      const list = await r.json();
      const live = list.filter((x) => !x.draft).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
      if (process.env.UPDATE_SNAPSHOT) {
        const slim = live.map((r) => ({ tag_name: r.tag_name, name: r.name, body: r.body, html_url: r.html_url, published_at: r.published_at, prerelease: r.prerelease, draft: r.draft, assets: r.assets.map((a) => ({ name: a.name, size: a.size, browser_download_url: a.browser_download_url, digest: a.digest ?? null })) }));
        await writeFile(path.join(SITE, "data/releases.snapshot.json"), JSON.stringify({ fetched_at: new Date().toISOString(), releases: slim }, null, 1));
      }
      return live;
    } catch (e) {
      lastError = e;
      await new Promise((res) => setTimeout(res, 1500 * (attempt + 1)));
    }
  }
  if (process.env.REQUIRE_LIVE_RELEASES) throw new Error(`could not read releases from GitHub: ${lastError?.message}`);
  const snap = JSON.parse(await readFile(path.join(SITE, "data/releases.snapshot.json"), "utf8"));
  console.warn(`GitHub API unavailable (${lastError?.message?.slice(0, 80)}); using the snapshot from ${snap.fetched_at}`);
  snapshotDate = snap.fetched_at;
  return snap.releases.filter((x) => !x.draft).sort((a, b) => new Date(b.published_at) - new Date(a.published_at));
}

let snapshotDate = null;

const fmtSize = (n) => (n >= 1048576 ? `${(n / 1048576).toFixed(n >= 104857600 ? 0 : 1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);
const fmtDate = (s) => new Date(s).toLocaleDateString("en-GB", { year: "numeric", month: "short", day: "numeric", timeZone: "UTC" });

function kindOf(name) {
  if (/\.flatpak$/.test(name)) return { k: "Flatpak", os: "Linux", rank: 1 };
  if (/\.AppImage$/.test(name)) return { k: "AppImage", os: "Linux", rank: 2 };
  if (/linux.*\.tar\.(gz|xz|zst)$/.test(name)) return { k: "Tarball", os: "Linux", rank: 3 };
  if (/\.dmg$/.test(name)) return { k: "Disk image", os: "macOS", rank: 4 };
  if (/extension.*\.zip$/.test(name)) return { k: "Extension", os: "Chromium", rank: 5 };
  if (/^install\.sh$/.test(name)) return { k: "Installer", os: "Script", rank: 6 };
  if (/SHA256SUMS(\.minisig)?$/.test(name)) return { k: "Checksums", os: "", rank: 9 };
  return { k: "File", os: "", rank: 8 };
}

const md = new Marked({ gfm: true });
md.use({
  renderer: {
    html: () => "",
    link({ href, title, tokens }) {
      const text = this.parser.parseInline(tokens);
      const safe = /^(https?:|#|\/|mailto:)/i.test(href) ? href : `${GH}/blob/main/${href.replace(/^\.\//, "")}`;
      return `<a href="${esc(safe)}"${title ? ` title="${esc(title)}"` : ""}${/^https?:/.test(safe) ? ' rel="noreferrer"' : ""}>${text}</a>`;
    },
    image: ({ text }) => esc(text),
  },
});

const NAV = [
  { href: "/", label: "Overview" },
  { href: "/download/", label: "Download" },
  { href: "/install/", label: "Install" },
  { href: "/docs/", label: "Docs" },
];

function layout({ title, description, url, body, page = "doc" }) {
  const full = title ? `${title} · Tobari` : "Tobari (帳): a local-first AI browser for Linux";
  const nav = NAV.map(({ href, label }) => {
    const here = href === "/" ? url === "/" : url.startsWith(href);
    return `<a href="${href}"${here ? ' aria-current="page"' : ""}>${label}</a>`;
  }).join("");
  const r = rev();
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(full)}</title>
<meta name="description" content="${esc(description)}">
<meta name="color-scheme" content="light dark">
<meta name="referrer" content="no-referrer">
<meta http-equiv="Content-Security-Policy" content="default-src 'self'; script-src 'self'; style-src 'self'; font-src 'self'; img-src 'self' data:; connect-src 'self'; form-action 'self'; base-uri 'self'; object-src 'none'">
<meta property="og:title" content="${esc(full)}">
<meta property="og:description" content="${esc(description)}">
<meta property="og:type" content="website">
<meta property="og:image" content="${SITE_URL}/assets/shots/og.jpg">
<meta property="og:url" content="${SITE_URL}${url}">
<meta name="twitter:card" content="summary_large_image">
<link rel="icon" href="/assets/icon-32.png" type="image/png">
<link rel="preload" href="/assets/fonts/inter-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
<link rel="stylesheet" href="/assets/site.css">
<script src="/assets/vendor/gsap.min.js" defer></script>
<script src="/assets/vendor/ScrollTrigger.min.js" defer></script>
<script src="/assets/js/site.js" defer></script>
</head>
<body data-page="${page}">
<a class="skip" href="#main">Skip to content</a>
<header class="top">
  <div class="top-inner">
    <a class="brand" href="/"><img src="/assets/icon-32.png" alt="" width="22" height="22"><span>Tobari</span></a>
    <nav class="nav" aria-label="Primary">${nav}<a class="ext" href="${GH}" rel="noreferrer">GitHub</a></nav>
    <a class="btn btn-primary btn-sm nav-cta" href="/install/">Get Tobari</a>
  </div>
</header>
<main id="main" tabindex="-1">
${body}
</main>
<footer class="foot">
  <div class="wrap foot-grid">
    <div>
      <a class="brand" href="/"><img src="/assets/icon-32.png" alt="" width="20" height="20"><span>Tobari</span></a>
      <p class="muted small">帳, the curtain drawn at nightfall.${r ? ` Built from <a href="${GH}/commit/${r}" rel="noreferrer">${r}</a>.` : ""}</p>
    </div>
    <div>
      <p class="label">This site</p>
      <p class="muted small">No analytics, no cookies, no third-party requests. Fonts and scripts come from this domain.</p>
    </div>
    <div>
      <p class="label">Elsewhere</p>
      <p class="small"><a href="${GH}" rel="noreferrer">Source</a> · <a href="${GH}/releases" rel="noreferrer">Releases</a> · <a href="${GH}/issues" rel="noreferrer">Issues</a></p>
    </div>
  </div>
</footer>
</body>
</html>
`;
}

function picture(name, alt, w, h, cls = "") {
  return `<picture class="${cls}"><source srcset="/assets/shots/${name}-dark.webp" media="(prefers-color-scheme: dark)"><img src="/assets/shots/${name}-light.webp" alt="${esc(alt)}" width="${w}" height="${h}" loading="lazy" decoding="async"></picture>`;
}

function releaseCard(r, latest) {
  const assets = [...r.assets].sort((a, b) => kindOf(a.name).rank - kindOf(b.name).rank);
  const rows = assets
    .map((a) => {
      const k = kindOf(a.name);
      const sha = a.digest?.startsWith("sha256:") ? a.digest.slice(7) : "";
      return `<tr>
  <td><span class="tag">${esc(k.k)}</span>${k.os ? `<span class="muted small"> ${esc(k.os)}</span>` : ""}</td>
  <td><a href="${esc(a.browser_download_url)}" rel="noreferrer">${esc(a.name)}</a></td>
  <td class="num">${fmtSize(a.size)}</td>
  <td>${sha ? `<code class="sha" title="SHA-256">${sha.slice(0, 16)}…</code>` : '<span class="muted">—</span>'}</td>
</tr>`;
    })
    .join("\n");
  const id = r.tag_name.replace(/[^\w.-]/g, "");
  return `<article class="release${latest ? " latest" : ""}" id="${esc(id)}">
  <header class="release-head">
    <div>
      <h2><a href="#${esc(id)}">${esc(r.name || r.tag_name)}</a></h2>
      <p class="muted small">${esc(r.tag_name)} · ${fmtDate(r.published_at)}${r.prerelease ? ' · <span class="pill-warn">pre-release</span>' : ""}${latest ? ' · <span class="pill-ok">latest</span>' : ""}</p>
    </div>
    <a class="btn btn-sm" href="${esc(r.html_url)}" rel="noreferrer">On GitHub</a>
  </header>
  ${assets.length ? `<div class="table-wrap"><table class="assets"><thead><tr><th>Type</th><th>File</th><th class="num">Size</th><th>SHA-256</th></tr></thead><tbody>${rows}</tbody></table></div>` : '<p class="muted">No files attached to this release.</p>'}
  ${r.body ? `<details class="notes"${latest ? " open" : ""}><summary>Release notes</summary><div class="prose">${md.parse(r.body)}</div></details>` : ""}
</article>`;
}

function downloadPage(list) {
  const latest = list[0];
  const v2 = list.find((r) => /^v?(0\.[5-9]|[1-9])/.test(r.tag_name) || /assistant|v2/i.test(r.name ?? ""));
  return `<section class="wrap page-head reveal">
  <p class="eyebrow">Download</p>
  <h1>Every Tobari release</h1>
  <p class="lead">Read straight from <a href="${GH}/releases" rel="noreferrer">GitHub Releases</a> ${snapshotDate ? `as of ${fmtDate(snapshotDate)} (GitHub's API was unavailable for this build)` : "when this page was built"}. Checksums are the SHA-256 GitHub computed for each file.</p>
  ${
    v2
      ? ""
      : `<div class="note">
    <strong>The assistant version (v2) has no release yet.</strong> Everything below is the earlier Tobari line: a privacy-focused Chromium browser without the AI agent. Its installer still works for that version. v2 runs today from source; see <a href="/install/">Install</a>.
  </div>`
  }
</section>
<section class="wrap releases">
${list.length ? list.map((r) => releaseCard(r, r === latest)).join("\n") : '<p class="muted">No releases have been published yet.</p>'}
</section>`;
}

const DOCS = [
  { file: "docs/DEV.md", slug: "dev", name: "Developing on Bazzite", summary: "Distrobox setup, running Tobari today, building the shell, tests and benchmarks." },
  { file: "docs/engine-decision.md", slug: "engine", name: "Engine decision", summary: "Why CEF in Chrome style, what is measured, and the condition that would switch to Gecko." },
  { file: "docs/shell-layout.md", slug: "shell-layout", name: "Shell layout", summary: "The three-column window and split view the CEF shell builds." },
  { file: "docs/bench.md", slug: "bench", name: "Memory benchmark", summary: "Results from bench/run.py. Only numbers the harness produced." },
  { file: "phase0/README.md", slug: "font-probe", name: "Japanese and Thai font probe", summary: "The rendering test that gates the engine choice." },
  { file: "packaging/flatpak/README.md", slug: "flatpak", name: "Flatpak", summary: "Sandbox permissions and why each one is needed." },
];

function rewriteDocLinks(html, fromFile) {
  return html.replace(/href="([^"#:]+\.md)(#[^"]*)?"/g, (m, p, frag) => {
    const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(fromFile), p));
    const d = DOCS.find((x) => x.file === resolved);
    if (d) return `href="/docs/${d.slug}/${frag ?? ""}"`;
    return `href="${GH}/blob/main/${resolved}${frag ?? ""}" rel="noreferrer"`;
  });
}

async function emit(url, html) {
  const file = url.endsWith("/") ? path.join(DIST, url, "index.html") : path.join(DIST, url);
  await mkdir(path.dirname(file), { recursive: true });
  const withBase = BASE === "/" ? html : html.replace(/(href|src|srcset)="\/(?!\/)/g, `$1="${BASE}`);
  await writeFile(file, withBase);
}

async function copyAssets() {
  await cp(path.join(SITE, "assets"), path.join(DIST, "assets"), { recursive: true });
  await mkdir(path.join(DIST, "assets/vendor"), { recursive: true });
  await mkdir(path.join(DIST, "assets/fonts"), { recursive: true });
  await cp(path.join(SITE, "node_modules/gsap/dist/gsap.min.js"), path.join(DIST, "assets/vendor/gsap.min.js"));
  await cp(path.join(SITE, "node_modules/gsap/dist/ScrollTrigger.min.js"), path.join(DIST, "assets/vendor/ScrollTrigger.min.js"));
  for (const f of ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"]) {
    await cp(path.join(SITE, "node_modules/@fontsource-variable/inter/files", f), path.join(DIST, "assets/fonts", f));
  }
  try {
    await cp(path.join(REPO, "packaging/get-tobari.sh"), path.join(DIST, "install.sh"));
  } catch {}
}

async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });
  await copyAssets();

  const ext = await json("extension/static/manifest.json");
  const facts = { version: ext.version };
  const fill = (s) => s.replace(/\{\{(\w+)\}\}/g, (m, k) => {
    if (!(k in facts)) throw new Error(`unknown placeholder ${m}`);
    return esc(facts[k]);
  });
  const page = async (name) => fill(await readFile(path.join(SITE, "src/pages", name), "utf8")).replace(/<!--\s*picture:(\S+)\s+(\d+)x(\d+)\s+"([^"]+)"(?:\s+class="([^"]*)")?\s*-->/g, (m, n, w, h, alt, cls) => picture(n, alt, w, h, cls ?? ""));

  await emit("/", layout({ title: "", url: "/", page: "home", description: "Tobari is a web browser for Linux with an assistant that runs on your own GPU and asks before it acts.", body: await page("home.html") }));
  await emit("/install/", layout({ title: "Install", url: "/install/", description: "How to run Tobari on Linux today.", body: await page("install.html") }));

  const list = await releases();
  await emit("/download/", layout({ title: "Download", url: "/download/", page: "download", description: "Every Tobari release with files, sizes and SHA-256 checksums.", body: downloadPage(list) }));
  await writeFile(path.join(DIST, "releases.json"), JSON.stringify(list.map((r) => ({ tag: r.tag_name, name: r.name, published: r.published_at, prerelease: r.prerelease, assets: r.assets.map((a) => ({ name: a.name, size: a.size, url: a.browser_download_url, digest: a.digest ?? null })) })), null, 1));

  const docCards = [];
  for (const d of DOCS) {
    let src;
    try {
      src = await readFile(path.join(REPO, d.file), "utf8");
    } catch {
      continue;
    }
    const title = (src.match(/^#\s+(.+)$/m) ?? [null, d.name])[1];
    const body = rewriteDocLinks(md.parse(src.replace(/^#\s+.+$/m, "")), d.file);
    docCards.push(`<a class="doc-card reveal" href="/docs/${d.slug}/"><h3>${esc(d.name)}</h3><p class="muted">${esc(d.summary)}</p><span class="mono small muted">${esc(d.file)}</span></a>`);
    await emit(`/docs/${d.slug}/`, layout({
      title: d.name,
      url: `/docs/${d.slug}/`,
      description: d.summary,
      body: `<article class="wrap doc"><p class="crumb"><a href="/docs/">Docs</a> / ${esc(d.name)}</p><h1>${esc(title)}</h1><p class="muted small">From <a href="${GH}/blob/main/${d.file}" rel="noreferrer"><code>${esc(d.file)}</code></a> on main.</p><div class="prose">${body}</div></article>`,
    }));
  }
  await emit("/docs/", layout({ title: "Docs", url: "/docs/", description: "Tobari's design and development documents.", body: `<section class="wrap page-head reveal"><p class="eyebrow">Docs</p><h1>How Tobari is built</h1><p class="lead">Rendered from the repository on every build, so they match the code.</p></section><section class="wrap doc-grid">${docCards.join("\n")}</section>` }));
  await emit("/404.html", layout({ title: "Not found", url: "/404.html", description: "This page does not exist.", body: `<section class="wrap page-head"><p class="eyebrow">404</p><h1>Nothing behind this curtain</h1><p class="lead">The page moved or never existed. <a href="/">Go to the overview</a> or <a href="/download/">downloads</a>.</p></section>` }));
  await writeFile(path.join(DIST, ".nojekyll"), "");
  await verify();
  console.log(`built ${DIST} for ${ON_VERCEL ? "Vercel" : "GitHub Pages"} (base ${BASE}), ${list.length} releases`);
}

async function walk(dir) {
  const out = [];
  for (const e of await readdir(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) out.push(...(await walk(p)));
    else out.push(p);
  }
  return out;
}

async function exists(p) {
  try {
    await stat(p);
    return true;
  } catch {
    return false;
  }
}

async function verify() {
  const problems = [];
  const files = (await walk(DIST)).filter((f) => f.endsWith(".html"));
  for (const f of files) {
    const rel = path.relative(DIST, f);
    const html = await readFile(f, "utf8");
    if (/<script(?![^>]*\bsrc=)[^>]*>/i.test(html)) problems.push(`${rel}: inline <script>`);
    if (/\sstyle="/i.test(html)) problems.push(`${rel}: inline style attribute (blocked by the CSP)`);
    if (/\son[a-z]+="/i.test(html)) problems.push(`${rel}: inline event handler`);
    for (const m of html.matchAll(/<(?:script|link|img|source)[^>]+(?:src|href|srcset)="(https?:)?\/\/[^"]+"/gi)) {
      if (!/rel="noreferrer"/.test(m[0]) && !/property="og/.test(m[0])) problems.push(`${rel}: loads a third-party resource: ${m[0].slice(0, 120)}`);
    }
    for (const m of html.matchAll(/(?:href|src|srcset)="([^"]+)"/g)) {
      let u = m[1];
      if (/^(https?:|mailto:|#|data:)/.test(u)) continue;
      if (!u.startsWith(BASE)) {
        problems.push(`${rel}: link outside the site base: ${u}`);
        continue;
      }
      u = u.slice(BASE.length - 1).split("#")[0].split("?")[0];
      const target = path.join(DIST, u.endsWith("/") ? path.join(u, "index.html") : u);
      if (!(await exists(target))) problems.push(`${rel}: broken link ${m[1]}`);
    }
  }
  if (problems.length) {
    console.error(problems.join("\n"));
    throw new Error(`${problems.length} problem(s) in the built site`);
  }
}

build().catch((e) => {
  console.error(`site build failed: ${e.message}`);
  process.exit(1);
});
