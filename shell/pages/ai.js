import { api, stream, followSystemTheme } from "/page.js";
followSystemTheme();
const $ = (s) => document.querySelector(s);

function size(bytes) {
  return bytes >= 1e9 ? `${(bytes / 1e9).toFixed(1)} GB` : `${Math.round(bytes / 1e6)} MB`;
}

function button(label, onClick, primary = false) {
  const b = document.createElement("button");
  b.type = "button";
  b.className = primary ? "btn btn-primary" : "btn";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

let polling = null;

function paint(s) {
  if (!s) return;
  $("[data-no-engine]").hidden = s.engineIncluded;
  $("[data-dir]").textContent = s.modelsDir;
  const dl = s.download;
  const busy = dl.state === "downloading" || dl.state === "verifying";
  const ul = $("[data-models]");
  ul.textContent = "";
  for (const [i, m] of s.models.entries()) {
    const li = document.createElement("li");
    li.className = m.selected ? "model on" : "model";
    const text = document.createElement("div");
    const name = document.createElement("strong");
    name.textContent = m.name;
    const meta = document.createElement("span");
    meta.className = "note";
    meta.textContent = ` · ${size(m.size)}`;
    const note = document.createElement("p");
    note.className = "muted small";
    note.textContent = m.note;
    text.append(name, meta, note);
    const actions = document.createElement("div");
    actions.className = "model-actions";
    if (dl.model === m.id && busy) {
      const bar = document.createElement("progress");
      bar.max = dl.total || m.size;
      bar.value = dl.received;
      const label = document.createElement("span");
      label.className = "note";
      label.textContent = dl.state === "verifying" ? "checking…" : `${Math.floor((100 * dl.received) / (dl.total || m.size))}%`;
      actions.append(bar, label);
      if (dl.state === "downloading") actions.append(button("Cancel", async () => paint(await api("ai/cancel"))));
    } else if (m.installed) {
      if (m.selected) {
        const tag = document.createElement("span");
        tag.className = "tag";
        tag.textContent = "in use";
        actions.append(tag);
      } else {
        actions.append(button("Use", async () => paint(await api("ai/select", { model: m.id }))));
      }
      actions.append(button("Delete", async () => {
        if (confirm(`Delete ${m.name} (${size(m.size)}) from this computer?`)) paint(await api("ai/delete", { model: m.id }));
      }));
    } else {
      const b = button("Download", async () => paint(await api("ai/download", { model: m.id })), !s.selected && i === 0);
      b.disabled = busy || !s.engineIncluded;
      actions.append(b);
    }
    li.append(text, actions);
    ul.append(li);
  }
  if (dl.state === "failed" && dl.error && dl.error !== "cancelled") {
    const li = document.createElement("li");
    li.className = "error";
    li.textContent = `Download failed: ${dl.error}`;
    ul.append(li);
  }
  $("[data-try]").hidden = !s.selected || !s.engineIncluded;
  $("[data-engine]").textContent =
    s.engine === "ready" ? "Model loaded." : s.engine === "loading" ? "Loading the model…" : "The model loads on first use and unloads after ten idle minutes.";
  if (busy && !polling) {
    polling = setInterval(async () => paint(await api("ai/state")), 700);
  } else if (!busy && polling) {
    clearInterval(polling);
    polling = null;
  }
}

// ------------------------------------------------------------------ try it

const history = [];
let controller = null;

function bubble(role, text) {
  const p = document.createElement("p");
  p.className = `msg ${role}`;
  p.textContent = text;
  $("[data-log]").append(p);
  p.scrollIntoView({ block: "nearest" });
  return p;
}

$("[data-form]").addEventListener("submit", async (e) => {
  e.preventDefault();
  const input = $("[data-input]");
  const text = input.value.trim();
  if (!text || controller) return;
  input.value = "";
  history.push({ role: "user", content: text });
  bubble("user", text);
  const out = bubble("assistant", "");
  out.classList.add("pending");
  controller = new AbortController();
  $("[data-send]").disabled = true;
  let reply = "";
  for await (const ev of stream("ai/chat", { messages: history }, controller.signal)) {
    if (ev.t) {
      out.classList.remove("pending");
      reply += ev.t;
      out.textContent = reply;
    }
    if (ev.done) {
      out.classList.remove("pending");
      if (ev.error) {
        out.classList.add("error");
        out.textContent = ev.error;
      }
    }
  }
  if (reply) history.push({ role: "assistant", content: reply });
  controller = null;
  $("[data-send]").disabled = false;
  paint(await api("ai/state"));
});

paint(await api("ai/state"));
