const [, , port, ...urls] = process.argv;
const version = await (await fetch(`http://127.0.0.1:${port}/json/version`)).json();
const ws = new WebSocket(version.webSocketDebuggerUrl);
let id = 1;
const pending = new Map();
ws.addEventListener("message", (e) => {
  const m = JSON.parse(e.data);
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id); }
});
const send = (method, params) =>
  new Promise((r) => { const i = id++; pending.set(i, r); ws.send(JSON.stringify({ id: i, method, params })); });

ws.addEventListener("open", async () => {
  for (const url of urls) {
    await send("Target.createTarget", { url });
    await new Promise((r) => setTimeout(r, 900));
  }
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
  for (const t of list) {
    if (t.type === "page" && /newtab/.test(t.url)) await send("Target.closeTarget", { targetId: t.id });
  }
  console.log(`opened ${urls.length} tabs`);
  process.exit(0);
});
setTimeout(() => process.exit(1), 60000);
