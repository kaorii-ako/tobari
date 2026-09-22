export interface ExtractedPage {
  title: string;
  byline: string;
  text: string;
  origin: string;
}

export function extractReadable(): ExtractedPage {
  const origin = location.origin;
  const title = document.title;
  const article = document.querySelector("article");
  const root = article ?? document.body;
  const clone = root.cloneNode(true) as HTMLElement;
  clone.querySelectorAll("script, style, nav, header, footer, aside, form, button").forEach((el) => el.remove());
  const text = (clone.innerText ?? "").replace(/\n{3,}/g, "\n\n").trim().slice(0, 20000);
  return { title, byline: "", text, origin };
}

export interface PageSchema {
  origin: string;
  title: string;
  claims: string[];
}

export function toStructured(page: ExtractedPage, maxClaims = 12): PageSchema {
  const paras = page.text.split("\n").map((p) => p.trim()).filter((p) => p.length > 40);
  return {
    origin: page.origin,
    title: page.title,
    claims: paras.slice(0, maxClaims)
  };
}
