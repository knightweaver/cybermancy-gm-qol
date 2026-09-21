import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "..");
const srcDir = path.join(root, "scripts", "src");
const outFile = path.join(root, "scripts", "bundle.js");

const order = [
  "00-preamble.js",
  "10-fear.js",
  "20-state.js",
  "30-opportunities.js",
  "40-environments.js",
  "50-adversaries.js",
  "52-pcs.js",
  "60-actions.js",
  "65-environment-actions.js",
  "67-reactions.js",
  "68-combat-state.js",
  "68-writeback.js",
  "69-compatibility.js",
  "70-rendering.js",
  "80-window.js",
  "90-hooks.js"
];

const header = [
  "// GENERATED FILE — DO NOT EDIT DIRECTLY.",
  "// Source: scripts/src/*.js",
  "// Rebuild: node tools/build-bundle.mjs",
  ""
].join("\n");

const body = order.map(file => {
  const full = path.join(srcDir, file);
  if (!fs.existsSync(full)) throw new Error(`Missing source module: ${file}`);
  return [
    `// ===== ${file} =====`,
    fs.readFileSync(full, "utf8").trimEnd(),
    ""
  ].join("\n");
}).join("\n");

fs.writeFileSync(outFile, header + body, "utf8");
console.log(`Built ${path.relative(root, outFile)} from ${order.length} source modules.`);
