import { api, followSystemTheme } from "/page.js";
followSystemTheme();
const nf = new Intl.NumberFormat();
const $ = (s) => document.querySelector(s);

function age(seconds) {
  if (!seconds) return "";
  const d = (Date.now() / 1000 - seconds) / 86400;
  return d < 1 ? "updated today" : `updated ${Math.floor(d)} day${d >= 2 ? "s" : ""} ago`;
}

function paintStats(s) {
  if (!s) return;
  $('[data-k="total"]').textContent = nf.format(s.total);
  $('[data-k="rules"]').textContent = nf.format(s.rules);
  $('[data-k="bangs"]').textContent = nf.format(s.bangs);
  const ul = $("[data-lists]");
  ul.textContent = "";
  for (const l of s.lists) {
    const li = document.createElement("li");
    const name = document.createElement("code");
    name.textContent = l.name;
    const note = document.createElement("span");
    note.className = "note";
    note.textContent = `${nf.format(l.rules)} rules · ${l.bundled ? "shipped with Tobari" : age(l.modified)}`;
    li.append(name, note);
    ul.append(li);
  }
  const running = s.updateState === "running";
  $("[data-update]").disabled = running;
  $("[data-update-state]").textContent = running ? "updating…" : (s.updateState.startsWith("updated") ? s.updateState : "");
}

function paintHosts(h) {
  const ul = $("[data-hosts]");
  ul.textContent = "";
  const hosts = h?.hosts || [];
  $("[data-hosts-empty]").hidden = hosts.length > 0;
  for (const host of hosts) {
    const li = document.createElement("li");
    const name = document.createElement("code");
    name.textContent = host;
    const b = document.createElement("button");
    b.className = "btn";
    b.type = "button";
    b.textContent = "Block again";
    b.addEventListener("click", async () => paintHosts(await api("unblock", { host })));
    li.append(name, b);
    ul.append(li);
  }
}

$("[data-update]").addEventListener("click", async () => {
  paintStats(await api("update"));
  const poll = setInterval(async () => {
    const s = await api("stats");
    paintStats(s);
    if (!s || s.updateState !== "running") clearInterval(poll);
  }, 1500);
});

paintStats(await api("stats"));
paintHosts(await api("hosts"));
