import * as pdfjs from "pdfjs-dist";

let ready = false;

export async function pdfText(data: ArrayBuffer, maxChars = 120_000): Promise<{ text: string; pages: number }> {
  if (!ready) {
    pdfjs.GlobalWorkerOptions.workerSrc = chrome.runtime.getURL("pdf.worker.min.mjs");
    ready = true;
  }
  const doc = await pdfjs.getDocument({ data: new Uint8Array(data) }).promise;
  const out: string[] = [];
  let len = 0;
  for (let i = 1; i <= doc.numPages && len < maxChars; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    let line = "";
    let lastY: number | null = null;
    const lines: string[] = [];
    for (const item of content.items as { str: string; transform: number[]; hasEOL?: boolean }[]) {
      const y = item.transform?.[5] ?? 0;
      if (lastY !== null && Math.abs(y - lastY) > 2) {
        lines.push(line);
        line = "";
      }
      line += (line && !line.endsWith(" ") ? " " : "") + item.str;
      lastY = y;
      if (item.hasEOL) {
        lines.push(line);
        line = "";
        lastY = null;
      }
    }
    if (line) lines.push(line);
    const pageText = `--- page ${i} ---\n${lines.map((l) => l.trim()).filter(Boolean).join("\n")}`;
    out.push(pageText);
    len += pageText.length;
  }
  return { text: out.join("\n\n").slice(0, maxChars), pages: doc.numPages };
}

export async function pdfFromUrl(url: string): Promise<{ text: string; pages: number }> {
  const r = await fetch(url, { credentials: "include" });
  if (!r.ok) throw new Error(`could not fetch the PDF (HTTP ${r.status})`);
  return pdfText(await r.arrayBuffer());
}
