import { test } from "node:test";
import assert from "node:assert/strict";
import { build } from "esbuild";

const { outputFiles } = await build({ entryPoints: ["src/lib/core.ts"], bundle: true, format: "esm", write: false, platform: "neutral" });
const mod = await import(`data:text/javascript;base64,${Buffer.from(outputFiles[0].text).toString("base64")}`);

test("local model ids read like names", () => {
  assert.equal(mod.prettyModel("qwen3-4b-instruct-2507-q4_k_m"), "Qwen3 4B Instruct");
  assert.equal(mod.prettyModel("qwen3-1.7b-q4_k_m"), "Qwen3 1.7B");
  assert.equal(mod.prettyModel("llama3.1:8b"), "Llama3.1:8b");
});

test("cloud model ids stay exact", () => {
  assert.equal(mod.prettyModel("gpt-4.1-mini"), "gpt-4.1-mini");
});

test("destination label says where prompts go", () => {
  assert.equal(mod.destinationLabel({ model: "qwen3-4b-instruct-2507-q4_k_m", local: true, host: "this device", region: "" }), "Qwen3 4B Instruct · on this device");
  assert.equal(mod.destinationLabel({ model: "m", local: false, host: "api.anthropic.com", region: "US" }), "M · api.anthropic.com (US)");
});
