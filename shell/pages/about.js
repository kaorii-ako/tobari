import { api, followSystemTheme } from "/page.js";
followSystemTheme();
const about = await api("about");
if (about) for (const el of document.querySelectorAll("[data-k]")) el.textContent = about[el.dataset.k] ?? "—";
