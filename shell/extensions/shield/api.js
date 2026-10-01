export function api(path, body = {}) {
  return fetch(`https://tobari.internal${path}`, {
    method: "POST",
    headers: { "Content-Type": "text/plain" },
    body: JSON.stringify(body),
    cache: "no-store",
    referrerPolicy: "origin",
  }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
}
