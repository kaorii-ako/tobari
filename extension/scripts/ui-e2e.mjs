import { createRequire } from "node:module";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { DatabaseSync } from "node:sqlite";

const here = dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { chromium } = (() => {
  try {
    return require("playwright");
  } catch {
    return require(require.resolve("playwright", { paths: [process.env.NODE_PATH ?? "", "/usr/lib/node_modules", "/usr/local/lib/node_modules"].concat(require("node:child_process").execSync("npm root -g").toString().trim()) }));
  }
})();
const ext = resolve(here, "../dist");
const repo = resolve(here, "../..");
const bin = process.env.TOBARI_BIN ?? join(repo, "core/target/debug/tobari");
const shots = process.env.SHOTS ?? join(repo, "docs/screenshots");
mkdirSync(shots, { recursive: true });

const home = mkdtempSync(join(tmpdir(), "tobari-ui-"));
const env = {
  ...process.env,
  HOME: home,
  XDG_CONFIG_HOME: `${home}/config`,
  XDG_DATA_HOME: `${home}/data`,
  XDG_STATE_HOME: `${home}/state`,
  XDG_RUNTIME_DIR: `${home}/run`,
  TOBARI_LLAMA_SERVER: join(repo, "core/tests/fake_llama_server.py"),
  TOBARI_FORCE_CPU: "1",
  TZ: "Asia/Bangkok",
};
mkdirSync(`${home}/run`, { mode: 0o700 });
mkdirSync(`${home}/data/tobari/models`, { recursive: true });
mkdirSync(`${home}/config/tobari`, { recursive: true });
const weights = Buffer.from("GGUF fake weights for tests");
writeFileSync(`${home}/data/tobari/models/tiny.gguf`, weights);
writeFileSync(
  `${home}/data/tobari/models/models.toml`,
  `[[models]]\nid = "qwen3-4b-instruct-2507-q4_k_m"\nabout = "test stand-in"\nrepo = "none/none"\nfile = "tiny.gguf"\nsha256 = "${createHash("sha256").update(weights).digest("hex")}"\nlicense = "Apache-2.0"\nsize_mb = 2381\nctx_default = 512\ndefault = true\n`,
);

const prof = `${home}/.config/google-chrome/Default`;
mkdirSync(`${prof}/Extensions`, { recursive: true });
writeFileSync(`${home}/.config/google-chrome/Local State`, JSON.stringify({ profile: { info_cache: { Default: { name: "Kao" } } } }));
writeFileSync(`${prof}/Preferences`, JSON.stringify({ homepage: "https://example.org", default_search_provider_data: { template_url_data: { short_name: "DuckDuckGo" } } }));
writeFileSync(
  `${prof}/Bookmarks`,
  JSON.stringify({ roots: { bookmark_bar: { type: "folder", name: "Bookmarks bar", children: [{ type: "folder", name: "日本語", children: [{ type: "url", name: "帳 - Wiktionary", url: "https://en.wiktionary.org/wiki/%E5%B8%B3" }] }, { type: "url", name: "Arch Wiki", url: "https://wiki.archlinux.org/" }] }, other: { type: "folder", name: "Other", children: [] } } }),
);
const db = new DatabaseSync(`${prof}/History`);
db.exec("CREATE TABLE urls(id INTEGER PRIMARY KEY, url TEXT, title TEXT, visit_count INTEGER, last_visit_time INTEGER, hidden INTEGER DEFAULT 0); INSERT INTO urls(url,title,visit_count,last_visit_time) VALUES('https://www.rust-lang.org/','Rust',4,13370000000000000);");
db.close();

const userData = `${home}/chromium`;
mkdirSync(`${userData}/NativeMessagingHosts`, { recursive: true });
writeFileSync(
  `${userData}/NativeMessagingHosts/dev.tobari.core.json`,
  JSON.stringify({ name: "dev.tobari.core", description: "test", path: bin, type: "stdio", allowed_origins: ["chrome-extension://dbpaojilndlchffoodnamfgjccblnpoe/"] }),
);

const server = spawn("python3", [join(here, "fixture", "server.py"), "8765"], { stdio: "ignore" });
await new Promise((r) => setTimeout(r, 600));

const checks = [];
const ok = (name, cond, extra = "") => {
  checks.push([name, !!cond]);
  console.log(`${cond ? "PASS" : "FAIL"} ${name}${extra && !cond ? `  (${extra})` : ""}`);
};

const ctx = await chromium.launchPersistentContext(userData, {
  headless: false,
  env,
  viewport: { width: 1280, height: 860 },
  args: [`--disable-extensions-except=${ext}`, `--load-extension=${ext}`, "--no-first-run", "--lang=en-US", "--no-proxy-server"],
});
let debugPage = null;
try {
  let sw = ctx.serviceWorkers()[0] ?? (await ctx.waitForEvent("serviceworker"));
  const id = new URL(sw.url()).host;
  ok("extension id is pinned by the manifest key", id === "dbpaojilndlchffoodnamfgjccblnpoe", id);

  const page = ctx.pages()[0] ?? (await ctx.newPage());
  await page.goto("http://127.0.0.1:8765/index.html");
  const other = await ctx.newPage();
  await other.goto("http://127.0.0.1:8765/other.html");
  await page.bringToFront();
  const winId = await sw.evaluate(async () => (await chrome.windows.getLastFocused()).id);

  const nt = await ctx.newPage();
  await nt.setViewportSize({ width: 1280, height: 860 });
  await nt.goto(`chrome-extension://${id}/newtab.html`);
  await nt.waitForTimeout(800);
  await nt.screenshot({ path: `${shots}/newtab.png` });
  ok("new tab page renders the command bar", await nt.isVisible("#q"));
  await nt.close();
  await page.bringToFront();

  const panelPage = await ctx.newPage();
  await panelPage.setViewportSize({ width: 400, height: 820 });
  await panelPage.goto(`chrome-extension://${id}/sidepanel.html?window=${winId}`);
  await page.bringToFront();
  const panel = panelPage;
  debugPage = panel;
  await panel.waitForFunction(() => document.querySelector("#dest-text")?.textContent?.includes("on this device"), null, { timeout: 15000 });
  ok("chat header shows model and that prompts stay local", (await panel.textContent("#dest-text")) === "Qwen3 4B Instruct · on this device");
  await panel.waitForSelector(".suggest button");
  await panel.screenshot({ path: `${shots}/panel-empty.png` });

  await panel.click('.seg button[data-view="tabs"]');
  await panel.waitForSelector(".row");
  const titles = await panel.$$eval(".row .title", (els) => els.map((e) => e.textContent));
  ok("vertical tabs list the window's tabs", titles.some((t) => t.includes("帳 Tobari test page")) && titles.some((t) => t.includes("Rust async")), titles.join(" | "));
  await panel.screenshot({ path: `${shots}/panel-tabs.png` });
  await panel.click('.seg button[data-view="ask"]');

  await panel.click("#input");
  await panel.keyboard.type("@");
  await panel.waitForSelector("#picker:not([hidden]) .item");
  const pickerText = await panel.textContent("#picker");
  ok("@ picker offers tab, selection, element, screenshot, all tabs", ["Current tab", "Selected text", "Pick an element", "Screenshot", "All open tabs"].every((x) => pickerText.includes(x)));
  await panel.screenshot({ path: `${shots}/panel-picker.png` });
  await panel.keyboard.press("Enter");
  await panel.waitForSelector("#chips .chip:not(:has-text('Reading'))");
  ok("current tab added as a context chip", (await panel.textContent("#chips")).includes("帳 Tobari test page"));
  await panel.keyboard.type("Summarize this page");
  await panel.keyboard.press("Enter");
  await panel.waitForSelector(".msg.bot table", { timeout: 20000 });
  const answer = await panel.textContent(".msg.bot .md");
  ok("streamed answer renders Markdown with Japanese and Thai", answer.includes("帳") && answer.includes("ภาษาไทย") && answer.includes("Mango"));
  await panel.screenshot({ path: `${shots}/panel-answer.png` });

  await panel.selectOption("#role", "operator");
  await panel.fill("#input", "CLICK_TEST press the button on this page");
  await panel.keyboard.press("Enter");
  await panel.waitForSelector(".step.confirm", { timeout: 20000 });
  const confirmText = await panel.textContent(".step.confirm");
  ok("state-changing click waits for confirmation", confirmText.includes("needs your OK") && confirmText.includes("click"));
  await panel.screenshot({ path: `${shots}/panel-confirm.png` });
  await panel.click(".step.confirm .btn.primary");
  await panel.waitForFunction(() => [...document.querySelectorAll(".msg.bot")].some((m) => m.textContent.includes("Clicked")), null, { timeout: 20000 });
  ok("approved click ran on the page", (await page.textContent("#s")) === "pressed");

  await panel.fill("#input", "INJECT_TEST what does this page say?");
  await panel.click("#at-btn");
  await panel.waitForSelector("#picker:not([hidden]) .item");
  await panel.keyboard.press("Enter");
  await panel.waitForSelector("#chips .chip:not(:has-text('Reading'))");
  await panel.click("#send");
  await panel.waitForSelector(".step.deny", { timeout: 20000 });
  const denyText = await panel.textContent(".step.deny");
  ok("prompt injection that leaks page data is blocked", denyText.includes("blocked") && denyText.includes("page data"), denyText);
  await panel.waitForFunction(() => [...document.querySelectorAll(".msg.bot")].some((m) => m.textContent.includes("blocked that step")), null, { timeout: 20000 });
  await panel.screenshot({ path: `${shots}/panel-blocked.png` });
  const attackerTabs = await sw.evaluate(async () => (await chrome.tabs.query({})).filter((t) => (t.url ?? "").includes("attacker")).length);
  ok("no tab ever opened the attacker URL", attackerTabs === 0);

  await panel.fill("#input", "/");
  await panel.waitForSelector("#picker:not([hidden]) .item");
  ok("/ lists the 10 bundled skills", (await panel.$$eval("#picker .item", (els) => els.filter((e) => e.textContent.startsWith("/")).length)) === 10);
  await panel.keyboard.press("Escape");
  await panel.fill("#input", "");

  const shop = await ctx.newPage();
  await shop.goto("http://127.0.0.1:8765/shop.html");
  await shop.bringToFront();
  panel.on("dialog", (d) => d.accept());
  await panel.waitForSelector("#site-tools:not([hidden])", { timeout: 15000 });
  ok("site advertising MCP is detected and needs approval", (await panel.textContent("#site-tools")).includes("offers tools"));
  await panel.click("#site-tools .btn");
  await panel.waitForFunction(() => document.querySelector("#site-tools")?.textContent?.includes("get_price"), null, { timeout: 15000 });
  ok("after approval the site's tools are listed", true);
  await panel.fill("#input", "MCP_TEST how much is a mango?");
  await panel.keyboard.press("Enter");
  await panel.waitForSelector(".step.confirm", { timeout: 20000 });
  ok("site tool call waits for confirmation", (await panel.textContent(".step.confirm")).includes("mcp.get_price"));
  ok("site tools cannot be allowed for the whole site", !(await panel.textContent(".step.confirm")).includes("Always on this site"));
  await panel.screenshot({ path: `${shots}/panel-site-tools.png` });
  await panel.click(".step.confirm .btn.primary");
  await panel.waitForFunction(() => [...document.querySelectorAll(".msg.bot")].some((m) => m.textContent.includes("120 yen")), null, { timeout: 20000 });
  ok("site tool result comes back into the answer", true);

  const st = await ctx.newPage();
  await st.setViewportSize({ width: 1180, height: 860 });
  await st.goto(`chrome-extension://${id}/settings.html#ai`);
  await st.waitForSelector(".li");
  await st.screenshot({ path: `${shots}/settings-ai.png` });
  await st.goto(`chrome-extension://${id}/settings.html#import`);
  await st.waitForSelector(".li .btn.primary");
  ok("import finds the Chrome profile", (await st.textContent("main")).includes("Chrome · Kao"));
  await st.click(".li .btn.primary");
  await st.waitForSelector("text=Import selected");
  await st.screenshot({ path: `${shots}/settings-import.png` });
  await st.click("text=Import selected");
  await st.waitForSelector("text=Done", { timeout: 15000 });
  const bms = await sw.evaluate(async () => (await chrome.bookmarks.search("Wiktionary")).map((b) => b.title));
  ok("Chrome bookmarks imported with their folders", bms.includes("帳 - Wiktionary"));
  await st.goto(`chrome-extension://${id}/settings.html#memory`);
  await st.waitForSelector("main h1");
  await st.goto(`chrome-extension://${id}/settings.html#privacy`);
  await st.waitForSelector(".toggle");
  await st.screenshot({ path: `${shots}/settings-privacy.png` });

  const rules = await sw.evaluate(async () => (await chrome.declarativeNetRequest.getEnabledRulesets()));
  ok("tracker blocklist ruleset is enabled", rules.includes("trackers"));

  const pop = await ctx.newPage();
  await pop.setViewportSize({ width: 520, height: 470 });
  await pop.goto(`chrome-extension://${id}/popup.html`);
  await pop.fill("#q", "rust");
  await pop.waitForTimeout(400);
  ok("command bar finds tabs by text", (await pop.textContent("#results")).includes("Rust async notes"));
  await pop.fill("#q", "");
  await pop.waitForTimeout(400);
  await pop.screenshot({ path: `${shots}/command-bar.png` });

  const tabsFromCli = await new Promise((res) => {
    const p = spawn(bin, ["--json", "tabs"], { env });
    let out = "";
    p.stdout.on("data", (d) => (out += d));
    p.on("close", () => res(out));
  });
  ok("tobari tabs (CLI) lists the browser's tabs", tabsFromCli.includes("帳 Tobari test page"), tabsFromCli.slice(0, 200));
} catch (e) {
  console.error(e);
  if (debugPage) {
    await debugPage.screenshot({ path: `${shots}/../failure.png` }).catch(() => {});
    console.error((await debugPage.textContent("#thread").catch(() => "")).slice(0, 1500));
  }
  checks.push(["no exception", false]);
} finally {
  await ctx.close();
  server.kill();
}
const failed = checks.filter(([, c]) => !c);
console.log(`\n${checks.length - failed.length}/${checks.length} passed`);
process.exit(failed.length ? 1 : 0);
