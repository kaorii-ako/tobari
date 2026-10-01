#!/usr/bin/env node
// Builds the Tobari site into site/dist/.
//
// - Markdown from the repository (SECURITY.md, BENCHMARKS.md, CHANGELOG.md,
//   docs/*.md) is rendered with `marked` at build time into a shared layout.
// - Hand-written pages live in site/src/pages/ as HTML fragments.
// - The output contains no inline script or style, and no third-party
//   origin is loaded. The build checks both and fails if either slips in,
//   and also fails on any internal link or #fragment that does not resolve.

import { execFileSync } from "node:child_process";
import { cp, mkdir, readFile, readdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Marked, Renderer } from "marked";

const SITE = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const REPO = path.resolve(SITE, "..");
const DIST = path.join(SITE, "dist");
const GH = "https://github.com/kaorii-ako/tobari";

/* ------------------------------------------------------------------ helpers */

const esc = (s) =>
  String(s)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");

const stripTags = (s) => String(s).replace(/<[^>]*>/g, "");

const decode = (s) =>
  String(s)
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&amp;", "&");

function slugify(text) {
  return decode(stripTags(text))
    .toLowerCase()
    .trim()
    .replace(/[^\p{L}\p{N}\s-]/gu, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-|-$/g, "");
}

function gitRev() {
  try {
    return execFileSync("git", ["rev-parse", "--short", "HEAD"], { cwd: REPO, encoding: "utf8" }).trim();
  } catch {
    return null;
  }
}

const REV = gitRev();

/* ------------------------------------------------------------------ sources */

// Repository markdown -> site URL. Anything not listed links to GitHub.
const DOCS = [
  { file: "docs/DESIGN.md", slug: "design", name: "Visual system" },
  { file: "docs/DEV-LINUX.md", slug: "dev-linux", name: "Developing on Linux" },
  { file: "docs/DEV-MACOS.md", slug: "dev-macos", name: "macOS" },
  { file: "docs/PACKAGING.md", slug: "packaging", name: "Packaging" },
  { file: "docs/RELEASING.md", slug: "releasing", name: "Releasing" },
  { file: "docs/VALIDATION.md", slug: "validation", name: "Validation" },
];

const STALE =
  'The README flags this document as written for an earlier phase order, when the project shipped an AppImage carrying a model sidecar. Flatpak is now the planned primary format and the payload is a browser. It is rendered here unchanged; treat packaging and platform details as historical until it is rewritten. Current build steps are on <a href="/download/#build">the download page</a>.';

const DOC_META = {
  design: {
    summary: "The normative visual system: type, colour, measured contrast, motion rules, density, blocking and measured costs.",
  },
  "dev-linux": {
    summary: "The distrobox container and toolchain. Later steps describe the earlier prototype.",
    flag: "partly historical",
    notice:
      'Steps 1 and 2 (the distrobox container and toolchain) apply to the browser. The later steps build the earlier prototype, which is no longer on <code>main</code>. To build the browser shell, follow <a href="/download/#build">the build steps on the download page</a>.',
  },
  "dev-macos": { summary: "Why macOS is a build-from-source target and what would change that.", flag: "flagged for rewrite", notice: STALE },
  packaging: { summary: "Packaging constraints recorded for the earlier phase order.", flag: "flagged for rewrite", notice: STALE },
  releasing: { summary: "How a release is signed with minisign, checksummed and published.", flag: "flagged for rewrite", notice: STALE },
  validation: { summary: "Stage 0 market validation. The gate was waived for Phase 1; the research is unfilled.", flag: "unfilled" },
};

const ROUTES = new Map([
  ["SECURITY.md", "/security/"],
  ["BENCHMARKS.md", "/benchmarks/"],
  ["CHANGELOG.md", "/changelog/"],
  ...DOCS.map((d) => [d.file, `/docs/${d.slug}/`]),
]);

function routeFor(repoPath) {
  const clean = repoPath.replace(/^\.\//, "");
  if (ROUTES.has(clean)) return ROUTES.get(clean);
  return null;
}

function rewriteHref(href, sourceFile) {
  if (!href || /^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith("#") || href.startsWith("/")) return href;
  const [p, frag] = href.split("#");
  const resolved = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), p));
  const route = routeFor(resolved);
  if (route) return route + (frag ? `#${frag}` : "");
  return `${GH}/blob/main/${resolved}${frag ? `#${frag}` : ""}`;
}

// `docs/DESIGN.md` written as inline code becomes a link to the rendered page.
function codeRoute(text, sourceFile) {
  if (!/^[\w./-]+\.md$/.test(text)) return null;
  const direct = routeFor(text);
  if (direct) return direct;
  const relative = path.posix.normalize(path.posix.join(path.posix.dirname(sourceFile), text));
  return routeFor(relative);
}

/* ------------------------------------------------------------------ markdown */

function renderMarkdown(source, sourceFile) {
  const toc = [];
  const used = new Map();
  let title = null;

  const marked = new Marked({ gfm: true });
  marked.use({
    renderer: {
      heading({ tokens, depth }) {
        const inner = this.parser.parseInline(tokens);
        if (depth === 1 && title === null) {
          title = stripTags(inner);
          return "";
        }
        let id = slugify(inner) || "section";
        const n = used.get(id) || 0;
        used.set(id, n + 1);
        if (n) id = `${id}-${n}`;
        if (depth <= 3) toc.push({ id, depth, text: decode(stripTags(inner)) });
        const label = esc(decode(stripTags(inner)));
        return `<div class="h-wrap lvl-${depth}"><h${depth} id="${id}">${inner}</h${depth}><a class="anchor" href="#${id}" aria-label="Link to section: ${label}">§</a></div>\n`;
      },
      link({ href, title: t, tokens }) {
        const inner = this.parser.parseInline(tokens);
        const target = rewriteHref(href, sourceFile);
        const ext = /^https?:/i.test(target);
        return `<a href="${esc(target)}"${t ? ` title="${esc(t)}"` : ""}${ext ? ' rel="noreferrer"' : ""}>${inner}</a>`;
      },
      codespan({ text }) {
        const route = codeRoute(decode(text), sourceFile);
        const code = `<code>${text}</code>`;
        return route ? `<a href="${route}">${code}</a>` : code;
      },
      code({ text, lang }) {
        const language = (lang || "").split(/\s/)[0];
        const cls = language ? ` class="language-${esc(language)}"` : "";
        return `<pre tabindex="0"><code${cls}>${esc(text)}</code></pre>\n`;
      },
      table(token) {
        const html = Renderer.prototype.table.call(this, token);
        return `<div class="table-wrap" role="region" aria-label="Table" tabindex="0">${html}</div>\n`;
      },
      html({ text }) {
        return text;
      },
    },
  });

  const html = marked.parse(source);
  return { html, toc, title };
}

/* ------------------------------------------------------------------ layout */

const NAV = [
  { href: "/download/", label: "Download" },
  { href: "/docs/", label: "Docs" },
  { href: "/security/", label: "Security" },
  { href: "/benchmarks/", label: "Benchmarks" },
  { href: "/changelog/", label: "Changelog" },
  { href: "/roadmap/", label: "Roadmap" },
];

function nav(current) {
  const items = NAV.map(({ href, label }) => {
    const here = current === href || (href !== "/" && current.startsWith(href));
    return `<li><a href="${href}"${here ? ' aria-current="page"' : ""}>${label}</a></li>`;
  });
  items.push(`<li><a class="ext" href="${GH}" rel="noreferrer">Source</a></li>`);
  return items.join("");
}

function layout({ title, description, url, body, page = "doc", scripts = [] }) {
  const fullTitle = title ? `${title} · Tobari` : "Tobari (帳) — a privacy-first Chromium browser for Linux";
  const extra = scripts.map((s) => `<script src="${s}" defer></script>`).join("\n    ");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>${esc(fullTitle)}</title>
    <meta name="description" content="${esc(description)}">
    <meta name="color-scheme" content="dark light">
    <meta name="referrer" content="no-referrer">
    <link rel="icon" href="/assets/favicon.svg" type="image/svg+xml">
    <link rel="preload" href="/assets/fonts/plex-sans-400.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/assets/fonts/plex-sans-600.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="preload" href="/assets/fonts/plex-mono-400.woff2" as="font" type="font/woff2" crossorigin>
    <link rel="stylesheet" href="/assets/tokens.css">
    <link rel="stylesheet" href="/assets/site.css">
    <script src="/assets/vendor/gsap.min.js" defer></script>
    ${extra}
    <script type="module" src="/assets/js/site.js"></script>
  </head>
  <body data-page="${page}">
    <a class="skip" href="#main">Skip to content</a>
    <header class="site-header">
      <div class="wrap header-row">
        <a class="brand" href="/"${url === "/" ? ' aria-current="page"' : ""}><span class="brand-glyph" lang="ja" aria-hidden="true">帳</span><span>Tobari</span></a>
        <span class="brand-status mono">pre-release · phase 1</span>
        <nav class="site-nav" aria-label="Primary"><ul>${nav(url)}</ul></nav>
      </div>
    </header>
    <main id="main" tabindex="-1">
${body}
    </main>
    <footer class="site-footer">
      <div class="wrap grid">
        <div class="footer-mark">
          <a class="brand" href="/"><span class="brand-glyph" lang="ja" aria-hidden="true">帳</span><span>Tobari</span></a>
          <p class="mono">MIT licensed${REV ? ` · built from <a href="${GH}/commit/${REV}" rel="noreferrer">${REV}</a>` : ""}</p>
        </div>
        <div class="footer-privacy">
          <span class="caps footer-label">This site</span>
          <p>No analytics, no trackers, no cookies, no third-party requests. Fonts and scripts are served from this domain.</p>
          <p>If you turn the fog background on, that choice is kept in your browser's local storage. Nothing else is stored.</p>
        </div>
        <ul class="footer-links">
          <li><span class="caps footer-label">Elsewhere</span></li>
          <li><a href="${GH}" rel="noreferrer">github.com/kaorii-ako/tobari</a></li>
          <li><a href="${GH}/releases" rel="noreferrer">Releases</a></li>
          <li><a href="${GH}/blob/main/LICENSE" rel="noreferrer">License</a></li>
        </ul>
      </div>
    </footer>
  </body>
</html>
`;
}

function docPage({ crumb, title, meta, notice, toc, html }) {
  const tocHtml = toc.length
    ? `<nav class="toc" aria-label="On this page"><span class="caps">On this page</span><ol>${toc
        .map((t) => `<li class="lvl-${t.depth}"><a href="#${t.id}">${esc(t.text)}</a></li>`)
        .join("")}</ol></nav>`
    : `<div class="toc" aria-hidden="true"></div>`;
  return `      <div class="wrap">
        <header class="grid page-head">
          <p class="crumb caps">${crumb}</p>
          <h1 class="page-title">${esc(title)}</h1>
          <p class="page-meta mono">${meta}</p>
          ${notice ? `<div class="notice" role="note"><span class="caps">Note</span><p>${notice}</p></div>` : ""}
        </header>
        <div class="grid doc-body">
          ${tocHtml}
          <article class="doc-article prose">
${html}
          </article>
        </div>
      </div>`;
}

function sourceMeta(file) {
  const link = `<a href="${GH}/blob/main/${file}" rel="noreferrer">${file}</a>`;
  return `Rendered from ${link}${REV ? ` at ${REV}` : ""}. The repository is the source of truth.`;
}

/* ------------------------------------------------------------------ write */

const outputs = new Map(); // url -> html

async function emit(url, html) {
  const file = url.endsWith("/") ? path.join(DIST, url, "index.html") : path.join(DIST, url);
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, html);
  outputs.set(url, html);
}

async function fragment(name) {
  return readFile(path.join(SITE, "src", "pages", name), "utf8");
}

async function tokensWithSystemTheme() {
  // tokens.css is a verbatim copy of shell/ui/tokens.css. The browser chrome
  // picks its theme through a menu; the site follows the system instead, so
  // the daybreak block is repeated under prefers-color-scheme: light.
  const tokens = await readFile(path.join(SITE, "assets", "tokens.css"), "utf8");
  const match = tokens.match(/:root\[data-theme="daybreak"\]\s*\{([\s\S]*?)\n\}/);
  if (!match) throw new Error("tokens.css: daybreak block not found");
  return `${tokens}
/* site: follow the system theme (generated from the daybreak block above) */
@media (prefers-color-scheme: light) {
  :root:not([data-theme="night"]) {${match[1]}
  }
}
`;
}

/* ------------------------------------------------------------------ pages */

async function build() {
  await rm(DIST, { recursive: true, force: true });
  await mkdir(DIST, { recursive: true });

  await cp(path.join(SITE, "assets"), path.join(DIST, "assets"), { recursive: true });
  await writeFile(path.join(DIST, "assets", "tokens.css"), await tokensWithSystemTheme());

  // Landing
  await emit(
    "/",
    layout({
      url: "/",
      page: "home",
      description:
        "Tobari is a privacy-first Chromium browser for Linux, built on CEF with network-layer blocking. Measured, with the caveats stated.",
      body: await fragment("home.html"),
      scripts: ["/assets/vendor/lenis.min.js"],
    }),
  );

  // Hand-written pages
  const plain = [
    { url: "/download/", file: "download.html", title: "Download", description: "There is no Tobari release yet. How releases will be verified, and how to build from source today." },
    { url: "/roadmap/", file: "roadmap.html", title: "Roadmap", description: "What Tobari is working on now, and what is planned later." },
    { url: "/waitlist/thanks/", file: "waitlist-thanks.html", title: "Added", description: "Your address was added to the waitlist." },
    { url: "/waitlist/remove/", file: "waitlist-remove.html", title: "Remove an address", description: "Remove your address from the Tobari waitlist." },
    { url: "/waitlist/removed/", file: "waitlist-removed.html", title: "Removal requested", description: "Your removal request was received." },
  ];
  for (const p of plain) {
    await emit(p.url, layout({ url: p.url, title: p.title, description: p.description, body: await fragment(p.file) }));
  }

  // Rendered markdown: security, benchmarks, changelog
  const top = [
    {
      file: "SECURITY.md",
      url: "/security/",
      title: "Threat model",
      crumb: "Security",
      description: "Tobari's threat model and every security tradeoff, stated plainly.",
      notice:
        "Most of this document describes the model sidecar from the earlier prototype, which now lives off <code>main</code> and is not part of the current browser. The README flags it for rewrite. The section that applies to today's browser is <a href=\"#network-layer-blocking-phase-1\">Network-layer blocking</a>.",
    },
    {
      file: "BENCHMARKS.md",
      url: "/benchmarks/",
      title: "Benchmarks",
      crumb: "Benchmarks",
      description: "Memory at 10 identical tabs: Tobari against stock Chrome, with method and caveats.",
      notice:
        'A single run against live sites, on one machine. Part of the gap against Chrome is features Tobari does not have yet. Both are explained under <a href="#what-this-does-and-does-not-show">What this does and does not show</a>.',
    },
    {
      file: "CHANGELOG.md",
      url: "/changelog/",
      title: "Changelog",
      crumb: "Changelog",
      description: "What changed in Tobari, commit by commit.",
    },
  ];
  for (const t of top) {
    const src = await readFile(path.join(REPO, t.file), "utf8");
    const { html, toc } = renderMarkdown(src, t.file);
    await emit(
      t.url,
      layout({
        url: t.url,
        title: t.title,
        description: t.description,
        body: docPage({ crumb: t.crumb, title: t.title, meta: sourceMeta(t.file), notice: t.notice, toc: t.file === "CHANGELOG.md" ? [] : toc, html }),
      }),
    );
  }

  // Docs
  const indexRows = [];
  for (const d of DOCS) {
    const src = await readFile(path.join(REPO, d.file), "utf8");
    const { html, toc } = renderMarkdown(src, d.file);
    const meta = DOC_META[d.slug] || {};
    const url = `/docs/${d.slug}/`;
    await emit(
      url,
      layout({
        url,
        title: d.name,
        description: meta.summary || d.name,
        body: docPage({
          crumb: `<a href="/docs/">Docs</a> / ${esc(path.basename(d.file))}`,
          title: d.name,
          meta: sourceMeta(d.file),
          notice: meta.notice,
          toc,
          html,
        }),
      }),
    );
    indexRows.push(
      `<li><a href="${url}"><span class="doc-file">${esc(d.file)}</span><span class="doc-name">${esc(d.name)}</span><span class="doc-sum">${esc(meta.summary || "")}${meta.flag ? `<span class="flag">${esc(meta.flag)}</span>` : ""}</span></a></li>`,
    );
  }
  const repoDocs = (await readdir(path.join(REPO, "docs"))).filter((f) => f.endsWith(".md"));
  const missing = repoDocs.filter((f) => !DOCS.some((d) => d.file === `docs/${f}`));
  if (missing.length) throw new Error(`docs/ has files with no page: ${missing.join(", ")}`);

  await emit(
    "/docs/",
    layout({
      url: "/docs/",
      title: "Docs",
      description: "Every document in the Tobari repository's docs/ directory, rendered.",
      body: `      <div class="wrap">
        <header class="grid page-head">
          <p class="crumb caps">Docs</p>
          <h1 class="page-title">Documentation</h1>
          <p class="page-meta mono">Each file in <a href="${GH}/tree/main/docs" rel="noreferrer">docs/</a>, rendered${REV ? ` at ${REV}` : ""}. Three of them are flagged in the README as written for an earlier phase order; each says so at the top.</p>
        </header>
        <div class="grid doc-body">
          <div class="toc" aria-hidden="true"></div>
          <ol class="doc-index doc-article" data-reveal>
            ${indexRows.join("\n            ")}
          </ol>
        </div>
      </div>`,
    }),
  );

  // 404 (Netlify serves dist/404.html for unknown paths)
  await emit("/404.html", layout({ url: "/404", title: "Not found", description: "Page not found.", body: await fragment("404.html") }));

  await verify();
}

/* ------------------------------------------------------------------ checks */

const ALLOWED_ORIGINS = [
  "https://github.com/kaorii-ako/tobari",
  "https://easylist.to/",
  "https://github.com/uBlockOrigin/uAssets",
];

function idsIn(html) {
  return new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((m) => m[1]));
}

async function verify() {
  const problems = [];

  for (const [url, html] of outputs) {
    // No inline script bodies, no event-handler attributes, no style attributes or blocks.
    for (const m of html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)) {
      if (!/\ssrc="/.test(m[1])) problems.push(`${url}: inline <script> without src`);
      if (m[2].trim()) problems.push(`${url}: <script> with a body`);
    }
    if (/<style[\s>]/i.test(html)) problems.push(`${url}: <style> block`);
    if (/\sstyle\s*=/i.test(html)) problems.push(`${url}: style= attribute`);
    if (/\son[a-z]+\s*=/i.test(html.replace(/<pre[\s\S]*?<\/pre>|<code>[\s\S]*?<\/code>/g, ""))) problems.push(`${url}: inline event handler`);

    // Resources may only come from this origin.
    for (const m of html.matchAll(/<(script|link|img|iframe|source|video|audio|embed|object)\b[^>]*\s(src|href|data)="([^"]+)"/gi)) {
      const [, tag, , value] = m;
      if (tag.toLowerCase() === "link" && !/rel="(stylesheet|preload|icon)"/.test(m[0])) continue;
      if (/^(https?:)?\/\//i.test(value)) problems.push(`${url}: <${tag}> loads ${value}`);
    }
    // Outbound links must be to the project, the filter list sources, or documentation.
    for (const m of html.matchAll(/<a\b[^>]*\shref="(https?:[^"]+)"/gi)) {
      if (!ALLOWED_ORIGINS.some((o) => m[1].startsWith(o))) problems.push(`${url}: outbound link to ${m[1]}`);
    }
    // Internal links and fragments must resolve.
    for (const m of html.matchAll(/\shref="([^"]+)"/g)) {
      const href = decode(m[1]);
      if (/^[a-z]+:/i.test(href)) continue;
      const [p, frag] = href.split("#");
      const targetUrl = p === "" ? url : p;
      if (targetUrl.startsWith("/assets/")) continue;
      const target = outputs.get(targetUrl);
      if (!target) {
        problems.push(`${url}: link to missing page ${href}`);
        continue;
      }
      if (frag && !idsIn(target).has(frag)) problems.push(`${url}: link to missing fragment ${href}`);
    }
  }

  // Any http(s) URL in shipped CSS/JS that is not a comment or licence banner.
  for (const rel of ["assets/site.css", "assets/tokens.css", "assets/js/site.js", "assets/js/motion.js"]) {
    const text = await readFile(path.join(DIST, rel), "utf8");
    if (/url\(\s*["']?(https?:)?\/\//i.test(text)) problems.push(`${rel}: remote url()`);
    if (/@import/i.test(text)) problems.push(`${rel}: @import`);
    if (/https?:\/\//i.test(text)) problems.push(`${rel}: contains an absolute URL`);
  }

  if (problems.length) {
    console.error(problems.map((p) => `  ✗ ${p}`).join("\n"));
    throw new Error(`${problems.length} problem(s) in built output`);
  }
  console.log(`built ${outputs.size} pages into ${path.relative(process.cwd(), DIST) || "."}${REV ? ` from ${REV}` : ""}; checks passed`);
}

build().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
