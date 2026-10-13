// Which typefaces the editor offers and how they get onto the page: fonts
// installed on this computer are used as they are, Google Fonts are fetched
// the first time a family is used.

import type { Page } from "../document/types";
import { platform } from "../storage/platform";
import catalogue from "./googleFonts.json";

/** Every Google Fonts family, with the upright weights it comes in. */
const GOOGLE: Record<string, number[]> = catalogue;
export const GOOGLE_FAMILIES: readonly string[] = Object.keys(GOOGLE);

/** Offered until the installed fonts are known, and when the host cannot list them (a plain browser). */
export const COMMON_FAMILIES: readonly string[] = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Menlo", "Segoe UI", "system-ui"];

let installed: Promise<readonly string[]> | null = null;
const installedNames = new Set<string>();

/** The families installed on this computer, sorted by name. Asked for once. */
export function installedFamilies(): Promise<readonly string[]> {
  installed ??= platform
    .listFonts()
    .catch(() => [])
    .then((families) => {
      const list = families.length > 0 ? families : COMMON_FAMILIES;
      for (const family of list) installedNames.add(family.toLowerCase());
      return list;
    });
  return installed;
}

/** A family that has to come from Google: in its catalogue and not already on this computer. */
export function isGoogleFont(family: string): boolean {
  return Object.hasOwn(GOOGLE, family) && !installedNames.has(family.toLowerCase());
}

/** The weight of a Google family closest to the one asked for. */
function nearestWeight(family: string, weight: number): number {
  const available = GOOGLE[family] ?? [400];
  return available.reduce((best, w) => (Math.abs(w - weight) < Math.abs(best - weight) ? w : best), available[0]!);
}

/** The stylesheet Google serves for a family, optionally cut down to the characters in `text`. */
export function googleCssUrl(family: string, weights: readonly number[], text?: string): string {
  const unique = [...new Set(weights.map((w) => nearestWeight(family, w)))].sort((a, b) => a - b);
  const name = encodeURIComponent(family).replace(/%20/g, "+");
  const subset = text ? `&text=${encodeURIComponent(text)}` : "";
  return `https://fonts.googleapis.com/css2?family=${name}:wght@${unique.join(";")}${subset}&display=swap`;
}

const LOAD_TIMEOUT_MS = 6000;
const stylesheets = new Map<string, Promise<boolean>>();

function stylesheetFor(family: string): Promise<boolean> {
  let pending = stylesheets.get(family);
  if (!pending) {
    pending = new Promise<boolean>((resolve) => {
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = googleCssUrl(family, GOOGLE[family] ?? [400]);
      link.onload = () => resolve(true);
      link.onerror = () => {
        // Offline, most likely: forget it so the next use tries again.
        link.remove();
        stylesheets.delete(family);
        resolve(false);
      };
      document.head.append(link);
    });
    stylesheets.set(family, pending);
  }
  return pending;
}

/**
 * Makes a family ready to draw and measure with, in the given weights. Resolves
 * either way: without a connection the text falls back to a system font.
 */
export async function ensureFont(family: string, weights: readonly number[] = [400]): Promise<void> {
  if (typeof document === "undefined" || !isGoogleFont(family)) return;
  const timeout = new Promise<void>((resolve) => setTimeout(resolve, LOAD_TIMEOUT_MS));
  const load = async () => {
    if (!(await stylesheetFor(family))) return;
    await Promise.all(weights.map((weight) => document.fonts.load(`${nearestWeight(family, weight)} 16px "${family}"`).catch(() => undefined)));
  };
  await Promise.race([load(), timeout]);
}

// ---------------------------------------------------------------------------
// Fonts inside exported pictures
// ---------------------------------------------------------------------------
// A picture rendered from SVG cannot reach web fonts, so the Google fonts a page
// uses are embedded in it, cut down to the characters the page actually has.

interface FontUse {
  weights: Set<number>;
  characters: Set<string>;
}

/** The Google families a page's text is set in, with the weights and characters used. */
export function googleFontUses(page: Page): Map<string, FontUse> {
  const uses = new Map<string, FontUse>();
  for (const node of Object.values(page.nodes)) {
    if (node.type !== "text" || !isGoogleFont(node.fontFamily)) continue;
    let use = uses.get(node.fontFamily);
    if (!use) uses.set(node.fontFamily, (use = { weights: new Set(), characters: new Set() }));
    use.weights.add(node.fontWeight);
    for (const character of node.text) if (character.trim()) use.characters.add(character);
  }
  return uses;
}

const RETRY_AFTER_MS = 60_000;
const embedded = new Map<string, { css: string; at: number; ok: boolean }>();
const embedding = new Map<string, Promise<string>>();
const listeners = new Set<() => void>();

async function toDataUrl(url: string): Promise<string> {
  const blob = await (await fetch(url)).blob();
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Swaps every font file a stylesheet points at for the file itself. */
export async function inlineFontFiles(css: string, load: (url: string) => Promise<string> = toDataUrl): Promise<string> {
  const urls = [...new Set([...css.matchAll(/url\((https:[^)]+)\)/g)].map((match) => match[1]!))];
  const files = new Map(await Promise.all(urls.map(async (url) => [url, await load(url)] as const)));
  return css.replace(/url\((https:[^)]+)\)/g, (_, url: string) => `url(${files.get(url)})`);
}

function embedFamily(family: string, use: FontUse): Promise<string> {
  const url = googleCssUrl(family, [...use.weights], [...use.characters].sort().join(""));
  const known = embedded.get(url);
  if (known && (known.ok || Date.now() - known.at < RETRY_AFTER_MS)) return Promise.resolve(known.css);
  let pending = embedding.get(url);
  if (!pending) {
    pending = fetch(url)
      .then((response) => (response.ok ? response.text() : Promise.reject(new Error(String(response.status)))))
      .then((css) => inlineFontFiles(css))
      .then(
        (css) => ({ css, ok: true }),
        () => ({ css: "", ok: false }),
      )
      .then(({ css, ok }) => {
        embedded.set(url, { css, ok, at: Date.now() });
        embedding.delete(url);
        if (ok) listeners.forEach((listener) => listener());
        return css;
      });
    embedding.set(url, pending);
  }
  return pending;
}

/** @font-face rules, files included, for every Google font the page uses. Empty when there are none or they cannot be fetched. */
export async function embeddedFontCss(page: Page): Promise<string> {
  const uses = googleFontUses(page);
  if (uses.size === 0 || typeof fetch === "undefined") return "";
  return (await Promise.all([...uses].map(([family, use]) => embedFamily(family, use)))).join("\n");
}

/**
 * The same, for code that cannot wait: what is already fetched, while the rest
 * is fetched in the background (`onFontsEmbedded` says when it has arrived).
 */
export function readyFontCss(page: Page): string {
  const uses = googleFontUses(page);
  if (uses.size === 0 || typeof fetch === "undefined") return "";
  return [...uses]
    .map(([family, use]) => {
      const known = embedded.get(googleCssUrl(family, [...use.weights], [...use.characters].sort().join("")));
      if (!known?.ok) void embedFamily(family, use);
      return known?.css ?? "";
    })
    .join("\n");
}

export function onFontsEmbedded(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
