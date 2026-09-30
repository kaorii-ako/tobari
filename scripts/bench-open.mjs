const [, , port, ...urls] = process.argv;
const list = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
const ui = list.find((t) => (t.url || "").includes("ui/index.html"));
if (!ui) { console.error("chrome UI not found"); process.exit(1); }
const ws = new WebSocket(ui.webSocketDebuggerUrl);
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
    await send("Runtime.evaluate", {
      expression: `window.cefQuery({request:JSON.stringify({type:"new_tab",url:${JSON.stringify(url)}}),onSuccess(){},onFailure(){}})`,
    });
    await new Promise((r) => setTimeout(r, 900));
  }
  console.log(`opened ${urls.length} tabs`);
  process.exit(0);
});
setTimeout(() => process.exit(1), 60000);
