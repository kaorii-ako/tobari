import { build } from "esbuild";
import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";

const out = "dist";
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync("static", out, { recursive: true });
cpSync("node_modules/pdfjs-dist/build/pdf.worker.min.mjs", `${out}/pdf.worker.min.mjs`);
mkdirSync(`${out}/fonts`, { recursive: true });
for (const f of ["inter-latin-wght-normal.woff2", "inter-latin-ext-wght-normal.woff2"]) cpSync(`node_modules/@fontsource-variable/inter/files/${f}`, `${out}/fonts/${f}`);

const domains = readFileSync("rules/blocklist.txt", "utf8")
  .split("\n")
  .map((l) => l.trim())
  .filter((l) => l && !l.startsWith("#"));
const rules = domains.map((d, i) => ({
  id: i + 1,
  priority: 1,
  action: { type: "block" },
  condition: {
    requestDomains: [d],
    domainType: "thirdParty",
    resourceTypes: ["script", "image", "sub_frame", "xmlhttprequest", "ping", "media", "font", "stylesheet", "websocket", "other"],
  },
}));
writeFileSync(`${out}/rules.json`, JSON.stringify(rules));

await build({
  entryPoints: {
    background: "src/background.ts",
    sidepanel: "src/sidepanel.ts",
    newtab: "src/newtab.ts",
    popup: "src/popup.ts",
    settings: "src/settings.ts",
    window: "src/window.ts",
  },
  bundle: true,
  format: "esm",
  splitting: true,
  chunkNames: "chunks/[name]-[hash]",
  target: "chrome120",
  outdir: out,
  minify: process.argv.includes("--minify"),
  sourcemap: false,
  logLevel: "info",
});
console.log(`blocklist: ${rules.length} domains`);
