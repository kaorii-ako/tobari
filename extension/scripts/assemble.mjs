import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";

mkdirSync("dist/icons", { recursive: true });

copyFileSync("src/background/worker.js", "dist/background.js");
copyFileSync("src/background/native.js", "dist/background-native.js");
copyFileSync("src/sidepanel/sidepanel.js", "dist/sidepanel.js");
copyFileSync("src/sidepanel/sidepanel.html", "dist/sidepanel.html");
copyFileSync("src/sidepanel/sidepanel.css", "dist/sidepanel.css");
copyFileSync("src/content/extract.js", "dist/content-extract.js");
for (const size of [16, 48, 128]) {
  copyFileSync(`icons/tobari-${size}.png`, `dist/icons/tobari-${size}.png`);
}

let worker = readFileSync("dist/background.js", "utf8");
worker = worker.replace(
  'from "./background/native.js"',
  'from "./background-native.js"'
);
worker = worker.replace('from "../background/native.js"', 'from "./background-native.js"');
writeFileSync("dist/background.js", worker);

const manifest = JSON.parse(readFileSync("manifest.json", "utf8"));
manifest.background.service_worker = "background.js";
manifest.side_panel.default_path = "sidepanel.html";
for (const k of Object.keys(manifest.icons)) {
  manifest.icons[k] = manifest.icons[k].replace(/^icons\//, "icons/");
}
writeFileSync("dist/manifest.json", JSON.stringify(manifest, null, 2) + "\n");
console.log("assembled dist/");
