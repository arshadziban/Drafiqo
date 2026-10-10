import type { TextNode } from "./types";

export interface FontSpec {
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  letterSpacing: number;
}

/**
 * Text measurement is injected so the document model stays free of DOM
 * dependencies. The app installs a canvas-backed measurer at startup; the
 * default is a deterministic estimate used by unit tests.
 */
export interface TextMeasurer {
  width(text: string, font: FontSpec): number;
  /** Ascent / descent of the font's content area, in pixels. */
  metrics(font: FontSpec): { ascent: number; descent: number };
}

const estimateMeasurer: TextMeasurer = {
  width: (text, font) => text.length * (font.fontSize * 0.55 + font.letterSpacing),
  metrics: (font) => ({ ascent: font.fontSize * 0.93, descent: font.fontSize * 0.24 }),
};

let measurer: TextMeasurer = estimateMeasurer;

export function setTextMeasurer(next: TextMeasurer | null): void {
  measurer = next ?? estimateMeasurer;
}

export interface TextLayout {
  lines: string[];
  /** Measured width of each line. */
  lineWidths: number[];
  width: number;
  height: number;
  lineHeightPx: number;
  /** Distance from the top of a line box to its baseline. */
  baseline: number;
}

function breakLine(line: string, maxWidth: number, font: FontSpec): string[] {
  if (measurer.width(line, font) <= maxWidth) return [line];
  const out: string[] = [];
  let current = "";
  // Tokens keep their trailing whitespace so words stay separated when rejoined.
  for (const token of line.match(/\S+\s*|\s+/g) ?? []) {
    if (current && measurer.width((current + token).trimEnd(), font) > maxWidth) {
      out.push(current.trimEnd());
      current = "";
    }
    if (!current && measurer.width(token.trimEnd(), font) > maxWidth) {
      // A single word wider than the box is broken by character.
      for (const ch of token) {
        if (current && measurer.width(current + ch, font) > maxWidth) {
          out.push(current);
          current = "";
        }
        current += ch;
      }
    } else {
      current += token;
    }
  }
  out.push(current.trimEnd());
  return out;
}

export function layoutText(node: TextNode): TextLayout {
  const font: FontSpec = node;
  const paragraphs = node.text.split("\n");
  const wrap = node.autoResize !== "auto";
  const lines = wrap ? paragraphs.flatMap((p) => breakLine(p, Math.max(node.width, 1), font)) : paragraphs;
  const lineHeightPx = node.fontSize * node.lineHeight;
  const { ascent, descent } = measurer.metrics(font);
  const lineWidths = lines.map((l) => measurer.width(l, font));
  return {
    lines,
    lineWidths,
    width: Math.max(0, ...lineWidths),
    height: lines.length * lineHeightPx,
    lineHeightPx,
    baseline: (lineHeightPx - (ascent + descent)) / 2 + ascent,
  };
}

/** Applies the node's auto-resize mode, returning the same object if nothing changes. */
export function fitTextNode(node: TextNode): TextNode {
  if (node.autoResize === "fixed") return node;
  const layout = layoutText(node);
  const width = node.autoResize === "auto" ? Math.max(1, Math.ceil(layout.width)) : node.width;
  const height = Math.max(1, Math.ceil(layout.height));
  if (width === node.width && height === node.height) return node;
  // Keep the edge implied by the alignment fixed while the box hugs the text.
  let x = node.x;
  if (node.autoResize === "auto" && node.rotation === 0) {
    if (node.textAlign === "center") x += (node.width - width) / 2;
    else if (node.textAlign === "right") x += node.width - width;
  }
  return { ...node, x, width, height };
}
