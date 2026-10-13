// Writes the list of Google Fonts families the font picker offers
// (frontend/src/fonts/googleFonts.json), with the weights each one comes in.
//
//   npm run fonts
//
// Run it now and then to pick up families Google has added, and commit the result.

import { writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const target = join(root, "frontend", "src", "fonts", "googleFonts.json");

const response = await fetch("https://fonts.google.com/metadata/fonts");
if (!response.ok) throw new Error(`Google Fonts answered ${response.status}`);
// The catalogue is JSON, sometimes behind an anti-hijacking prefix.
const { familyMetadataList } = JSON.parse((await response.text()).replace(/^\)\]\}'/, ""));

const families = {};
for (const { family, fonts } of familyMetadataList) {
  // Upright weights only: the editor has no italic yet.
  const weights = Object.keys(fonts)
    .filter((key) => /^\d+$/.test(key))
    .map(Number)
    .sort((a, b) => a - b);
  if (weights.length > 0) families[family] = weights;
}

const names = Object.keys(families).sort((a, b) => a.localeCompare(b));
const lines = names.map((name) => `  ${JSON.stringify(name)}: [${families[name].join(",")}]`);
writeFileSync(target, `{\n${lines.join(",\n")}\n}\n`);
console.log(`Wrote ${names.length} families to ${target}`);
