import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: ["src/lib/markdown.ts"], bundle: true, format: "esm", write: false });
const { renderMarkdown } = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("escapes HTML from the model", () => {
  const out = renderMarkdown('<img src=x onerror="alert(1)"> **hi**');
  assert.ok(!out.includes("<img"));
  assert.ok(out.includes("<strong>hi</strong>"));
});

test("only http links become anchors", () => {
  assert.ok(!renderMarkdown("[x](javascript:alert(1))").includes("<a"));
  assert.ok(renderMarkdown("[x](https://example.org)").includes('href="https://example.org"'));
});

test("tables, lists and CJK", () => {
  const out = renderMarkdown("| 果物 | 価格 |\n|---|---|\n| りんご | 120 |\n\n- ภาษาไทย\n- two");
  assert.ok(out.includes("<th>果物</th>"));
  assert.ok(out.includes("<li>ภาษาไทย</li>"));
});
