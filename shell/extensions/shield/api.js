export function api(path, body = {}) {
  return fetch(`https://tobari.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "origin",
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}

// A streaming bridge call: yields {t} objects as the reply is written, then
// {done, error}.
export async function* streamApi(path, body = {}, signal) {
  let r;
  try {
    r = await fetch(`https://tobari.internal${path}`, {
      method: "POST",
      headers: { "Content-Type": "text/plain" },
      body: JSON.stringify(body),
      cache: "no-store",
      referrerPolicy: "origin",
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
