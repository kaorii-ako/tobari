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
