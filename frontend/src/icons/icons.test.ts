import { readdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

// The icon components are generated from assets/icons. These tests catch a
// changed, added or removed SVG that was not followed by `npm run icons`.

const dir = fileURLToPath(new URL("../../../assets/icons/", import.meta.url));
const generated = readFileSync(fileURLToPath(new URL("./icons.tsx", import.meta.url)), "utf8");
const files = readdirSync(dir).filter((f) => f.toLowerCase().endsWith(".svg"));
const componentName = (file: string) =>
  "Icon" +
  file
    .replace(/\.svg$/i, "")
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
    .map((part) => part[0]!.toUpperCase() + part.slice(1))
    .join("");

describe("generated icons", () => {
  it("finds the icon files", () => {
    expect(files.length).toBeGreaterThan(0);
  });

  it.each(files)("%s has a matching component with identical path data", (file) => {
    const svg = readFileSync(dir + file, "utf8");
    expect(generated).toContain(`export function ${componentName(file)}(`);
    for (const [, d] of svg.matchAll(/\sd="([^"]+)"/g)) expect(generated).toContain(`d="${d}"`);
  });

  it("has no component without a source file", () => {
    const names = [...generated.matchAll(/export function (Icon\w+)\(/g)].map((m) => m[1]);
    expect(names.sort()).toEqual(files.map(componentName).sort());
  });

  it("follows the surrounding text colour instead of the files' fixed white", () => {
    expect(generated).not.toContain('"white"');
    expect(generated).toContain('stroke="currentColor"');
  });
});
