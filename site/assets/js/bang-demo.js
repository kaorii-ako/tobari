// The bang demo on the landing page. It imports the resolver and the table
// that ship in the browser's new-tab page (shell/ui/bangs.js and bangs.json,
// copied into the site at build time), so what this shows is what Tobari does.
// Nothing typed here leaves the page.

const demo = document.querySelector("[data-bang-demo]");

async function setup() {
  if (!demo) return;
  const input = demo.querySelector("[data-bang-input]");
  const out = demo.querySelector("[data-bang-out]");
  const token = demo.querySelector("[data-bang-token]");
  const name = demo.querySelector("[data-bang-name]");
  const dest = demo.querySelector("[data-bang-dest]");
  const open = demo.querySelector("[data-bang-open]");
  const note = demo.querySelector("[data-bang-note]");
  const list = demo.querySelector("[data-bang-list]");

  let mod;
  try {
    mod = await import(new URL("../bang/bangs.js", import.meta.url).href);
  } catch {
    note.textContent = "This browser cannot load the demo's module. The bang list is on the new-tab page in Tobari.";
    input.disabled = true;
    return;
  }
  const { parseBang, applyBang, allBangs, bangCount } = mod;

  function render() {
    const text = input.value;
    const bang = parseBang(text);
    out.dataset.state = bang ? (bang.query ? "resolved" : "partial") : text.trim() ? "plain" : "empty";
    if (!bang) {
      token.textContent = "—";
      name.textContent = text.trim() ? "No bang: this would go to your search engine as typed." : "Type a bang, like !gh or !w, and a query.";
      dest.textContent = "";
      open.hidden = true;
      return;
    }
    token.textContent = "!" + bang.token;
    name.textContent = bang.name;
    if (!bang.query) {
      dest.textContent = "";
      open.hidden = true;
      return;
    }
    const url = applyBang(bang, bang.query);
    dest.textContent = url;
    open.href = url;
    open.hidden = false;
  }

  input.addEventListener("input", render);
  demo.addEventListener("submit", (event) => {
    event.preventDefault();
    if (!open.hidden) window.open(open.href, "_blank", "noopener,noreferrer");
  });
  for (const example of demo.querySelectorAll("[data-bang-example]")) {
    example.addEventListener("click", () => {
      input.value = example.dataset.bangExample;
      input.focus();
      render();
    });
  }

  const frag = document.createDocumentFragment();
  for (const b of allBangs()) {
    const li = document.createElement("li");
    const t = document.createElement("button");
    t.type = "button";
    t.className = "bang-chip";
    t.textContent = "!" + b.token;
    t.title = b.name;
    t.addEventListener("click", () => {
      const rest = input.value.replace(/(?:^|\s)![^\s]+/, "").trim();
      input.value = `!${b.token} ${rest}`.trimEnd() + (rest ? "" : " ");
      input.focus();
      render();
    });
    const n = document.createElement("span");
    n.textContent = b.name;
    li.append(t, n);
    frag.append(li);
  }
  list.append(frag);
  demo.querySelector("[data-bang-count]").textContent = String(bangCount());
  render();
}

setup();
