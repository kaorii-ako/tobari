// Shared by every tobari:// page: calls into the browser through the page's
// own /api/ path. The browser answers only tobari:// pages.
export async function api(name, body = {}) {
  try {
    const r = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      cache: "no-store",
    });
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

// Follow the system theme, as the new tab does.
const light = window.matchMedia("(prefers-color-scheme: light)");
export function followSystemTheme() {
  const apply = () => (document.documentElement.dataset.theme = light.matches ? "daybreak" : "night");
  apply();
  light.addEventListener("change", apply);
}

// Calls a streaming endpoint and yields its NDJSON lines as objects:
// {t: "text"} as the reply is written, then {done: true, error}.
export async function* stream(name, body = {}, signal) {
  let r;
  try {
    r = await fetch(`/api/${name}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      cache: "no-store",
      signal,
    });
  } catch {
    yield { done: true, error: signal?.aborted ? "" : "Tobari did not answer." };
    return;
  }
  if (!r.ok || !r.body) {
    yield { done: true, error: "Tobari did not answer." };
    return;
  }
  const reader = r.body.pipeThrough(new TextDecoderStream()).getReader();
  let buf = "";
  for (;;) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch {
      yield { done: true, error: "" };
      return;
    }
    if (chunk.done) break;
    buf += chunk.value;
    let nl;
    while ((nl = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, nl);
      buf = buf.slice(nl + 1);
      if (line) yield JSON.parse(line);
    }
  }
}
