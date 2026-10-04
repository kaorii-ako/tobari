// Smoke test for a Tobari build: run against a browser started with
// --remote-debugging-port on a fresh profile. Checks that the engine runs,
// that the first launch opens the setup window (tobari://welcome), that the
// tobari:// page renders and its API answers, and that the browser window
// opened beside it.
//
//   node scripts/smoke.mjs <port>
const port = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };

let version = null;
for (let i = 0; i < 60 && !version; i++) {
  try { version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json(); } catch { await sleep(1000); }
}
if (!version) fail("browser did not open its debugging port");
console.log(`engine: ${version.Browser}`);

let welcome = null;
for (let i = 0; i < 20 && !welcome; i++) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  welcome = list.find((t) => t.url.startsWith("tobari://welcome"));
  if (!welcome) await sleep(1000);
}
if (!welcome) fail("first launch did not open the setup window (tobari://welcome)");
{
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  if (!list.some((t) => t.type === "page" && t.url.startsWith("chrome://newtab"))) {
    fail("the browser window with a new tab did not open");
  }
}

const ws = new WebSocket(welcome.webSocketDebuggerUrl);
await new Promise((r, j) => { ws.onopen = r; ws.onerror = j; });
let id = 0;
const evaluate = (expression) => new Promise((resolve) => {
  const mine = ++id;
  ws.addEventListener("message", function on(e) {
    const m = JSON.parse(e.data);
    if (m.id !== mine) return;
    ws.removeEventListener("message", on);
    resolve(m.result?.result?.value);
  });
  ws.send(JSON.stringify({ id: mine, method: "Runtime.evaluate", params: { expression, awaitPromise: true, returnByValue: true } }));
});
await sleep(1500);
const title = await evaluate("document.title");
if (title !== "Welcome to Tobari") fail(`welcome page title was ${JSON.stringify(title)}`);
const engines = await evaluate("fetch('/api/setup/state', {method: 'POST', body: '{}'}).then(r => r.json()).then(s => s.engines.length).catch(() => -1)");
if (!(engines > 0)) fail("tobari://welcome/api/setup/state did not answer");
const logos = await evaluate("[...document.querySelectorAll('.logo-tile')].filter(i => i.naturalWidth > 0).length");
console.log(`setup window rendered; ${engines} search engines offered, ${logos} logos loaded`);
console.log("PASS");
process.exit(0);
