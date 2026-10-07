// Smoke test for Tobari's local AI: run against a browser started with
// --remote-debugging-port, with a model already in Tobari's models folder.
// Opens tobari://ai, checks that the engine is bundled and the model is
// found, then streams one chat reply through the browser.
//
//   node scripts/ai-smoke.mjs <port>
const port = Number(process.argv[2] || 9222);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const fail = (msg) => { console.error(`FAIL: ${msg}`); process.exit(1); };
const base = `http://127.0.0.1:${port}`;

for (let i = 0; i < 60; i++) {
  try { await fetch(`${base}/json/version`); break; } catch { await sleep(1000); }
}
const target = await (await fetch(`${base}/json/new?tobari://ai/`, { method: "PUT" })).json();
await sleep(2000);

const ws = new WebSocket(target.webSocketDebuggerUrl);
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

const state = await evaluate("fetch('/api/ai/state', {method: 'POST', body: '{}'}).then(r => r.json())");
if (!state) fail("tobari://ai/api/ai/state did not answer");
if (!state.engineIncluded) fail("the AI engine is not bundled");
if (!state.selected) fail(`no model found in ${state.modelsDir}`);
console.log(`engine bundled; model ${state.selected}`);

const reply = await evaluate(`(async () => {
  const r = await fetch('/api/ai/chat', {method: 'POST', body: JSON.stringify({messages: [{role: 'user', content: 'Reply with one short sentence about the sea.'}]})});
  const t0 = performance.now();
  const text = await r.text();
  const events = text.trim().split('\\n').map((l) => JSON.parse(l));
  return {ms: Math.round(performance.now() - t0), text: events.filter((e) => e.t).map((e) => e.t).join(''), end: events.at(-1)};
})()`);
if (!reply?.end?.done) fail(`chat did not finish: ${JSON.stringify(reply)}`);
if (reply.end.error) fail(`chat failed: ${reply.end.error}`);
if (!reply.text.trim()) fail("chat answered with no text");
console.log(`chat answered in ${reply.ms} ms: ${JSON.stringify(reply.text.trim())}`);
console.log("PASS");
process.exit(0);
