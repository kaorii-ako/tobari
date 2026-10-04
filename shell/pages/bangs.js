import { followSystemTheme } from "/page.js";
followSystemTheme();
const table = await (await fetch("/bangs.json")).json();
const list = document.querySelector("[data-bangs]");
const filter = document.querySelector("[data-filter]");

function render() {
  const q = filter.value.trim().toLowerCase().replace(/^!/, "");
  list.textContent = "";
  for (const b of table) {
    if (q && !b.token.includes(q) && !b.name.toLowerCase().includes(q)) continue;
    const li = document.createElement("li");
    const tok = document.createElement("span");
    tok.className = "tok";
    tok.textContent = "!" + b.token;
    const name = document.createElement("span");
    name.textContent = b.name;
    li.append(tok, name);
    list.append(li);
  }
}
filter.addEventListener("input", render);
render();
