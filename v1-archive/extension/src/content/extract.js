export function extractReadable() {
    const origin = location.origin;
    const title = document.title;
    const article = document.querySelector("article");
    const root = article ?? document.body;
    const clone = root.cloneNode(true);
    clone.querySelectorAll("script, style, nav, header, footer, aside, form, button").forEach((el) => el.remove());
    const text = (clone.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
    return { title, byline: "", text, origin };
}
export function toStructured(page, maxClaims = 12) {
    const paras = page.text.split("\n").map((p) => p.trim()).filter((p) => p.length > 40);
    return {
        origin: page.origin,
        title: page.title,
        claims: paras.slice(0, maxClaims)
    };
}
