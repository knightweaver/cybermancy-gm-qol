#!/usr/bin/env node

import { promises as fs } from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const manifest = JSON.parse(
  await fs.readFile(path.join(ROOT, "module.json"), "utf8")
);
const errors = [];

function requireCompatibility(label, value, expected) {
  if (!value || typeof value !== "object") {
    errors.push(`${label}: compatibility object is missing`);
    return;
  }

  for (const key of ["minimum", "verified", "maximum"]) {
    if (String(value[key] ?? "") !== String(expected[key])) {
      errors.push(
        `${label}: ${key} must be ${JSON.stringify(expected[key])}, got ${JSON.stringify(value[key])}`
      );
    }
  }
}

if (manifest.type !== "module") {
  errors.push(`manifest type must be "module", got ${JSON.stringify(manifest.type)}`);
}
if (manifest.id !== "cybermancy-gm-qol") {
  errors.push(
    `module id must be "cybermancy-gm-qol", got ${JSON.stringify(manifest.id)}`
  );
}
if (!/^\d+\.\d+\.\d+$/.test(String(manifest.version ?? ""))) {
  errors.push(
    `module version must be semantic x.y.z, got ${JSON.stringify(manifest.version)}`
  );
}

requireCompatibility("Foundry", manifest.compatibility, {
  minimum: "13",
  verified: "13",
  maximum: "13"
});

const daggerheart = (manifest.relationships?.systems ?? []).find(
  system => system?.id === "daggerheart"
);

if (!daggerheart) {
  errors.push("Daggerheart system relationship is missing");
} else {
  if (daggerheart.type !== "system") {
    errors.push(
      `Daggerheart relationship type must be "system", got ${JSON.stringify(daggerheart.type)}`
    );
  }

  requireCompatibility("Daggerheart", daggerheart.compatibility, {
    minimum: "1.2",
    verified: "1.9",
    maximum: "1.9"
  });
}

if (!Array.isArray(manifest.esmodules) || manifest.esmodules.length !== 1 ||
    manifest.esmodules[0] !== "scripts/main.js") {
  errors.push(
    'module must declare exactly one runtime entry point: "scripts/main.js"'
  );
}

for (const rel of manifest.esmodules ?? []) {
  try {
    const stat = await fs.stat(path.join(ROOT, rel));
    if (!stat.isFile()) errors.push(`runtime reference is not a file: ${rel}`);
  } catch {
    errors.push(`runtime reference is missing: ${rel}`);
  }
}

for (const rel of ["scripts/bundle.js", "README.md"]) {
  try {
    const stat = await fs.stat(path.join(ROOT, rel));
    if (!stat.isFile()) errors.push(`required package file is not a file: ${rel}`);
  } catch {
    errors.push(`required package file is missing: ${rel}`);
  }
}

const expectedManifest =
  "https://github.com/knightweaver/cybermancy-gm-qol/releases/latest/download/module.json";
const archive = `cybermancy-gm-qol-v${manifest.version}.zip`;
const expectedDownload =
  `https://github.com/knightweaver/cybermancy-gm-qol/releases/download/v${manifest.version}/${archive}`;

if (manifest.url !== "https://github.com/knightweaver/cybermancy-gm-qol") {
  errors.push(`repository URL mismatch: ${JSON.stringify(manifest.url)}`);
}
if (manifest.manifest !== expectedManifest) {
  errors.push(`manifest URL mismatch: ${JSON.stringify(manifest.manifest)}`);
}
if (manifest.download !== expectedDownload) {
  errors.push(
    `download URL mismatch: expected ${expectedDownload}, got ${JSON.stringify(manifest.download)}`
  );
}

if (errors.length) {
  console.error("Cybermancy GM QOL release manifest validation FAILED");
  for (const error of errors) console.error(` - ${error}`);
  process.exit(1);
}

console.log("Cybermancy GM QOL release manifest validation PASS");
console.log(` - version: ${manifest.version}`);
console.log(" - Foundry compatibility: 13 / 13 / 13");
console.log(" - Daggerheart compatibility: 1.2 / 1.9 / 1.9");
console.log(" - clean-install manifest/download URLs: declared");
