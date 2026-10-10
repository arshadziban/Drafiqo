// A small PDF writer. Vector mode draws shapes and text as real PDF vectors;
// image mode embeds a picture of the artwork for an exact match.

import { outlinePath } from "../canvas/shapes";
import { localMatrix, parentWorldMatrix, type Matrix, type Rect } from "../document/geometry";
import { layoutText } from "../document/textLayout";
import { isContainer, type NodeId, type Page, type Paint, type SceneNode, type TextNode } from "../document/types";
import { sourceBounds } from "./exportRenderer";
import type { ExportRequest, ExportResult, Size } from "./exportTypes";

const n = (value: number) => {
  const text = (Math.round(value * 1000) / 1000).toFixed(3).replace(/\.?0+$/, "");
  return text === "-0" ? "0" : text;
};

const rgb = (hex: string) => [1, 3, 5].map((i) => n(parseInt(hex.slice(i, i + 2), 16) / 255)).join(" ");

/** Converts M/L/C/Z path data into PDF path operators. */
function pathOps(d: string): string {
  const tokens = d.match(/[MLCZ]|-?\d*\.?\d+(?:e-?\d+)?/g) ?? [];
  const out: string[] = [];
  let i = 0;
  const take = (count: number) => tokens.slice(i + 1, (i += count + 1)).map((t) => n(Number(t))).join(" ");
  while (i < tokens.length) {
    const command = tokens[i];
    if (command === "M") out.push(`${take(2)} m`);
    else if (command === "L") out.push(`${take(2)} l`);
    else if (command === "C") out.push(`${take(6)} c`);
    else if (command === "Z") {
      out.push("h");
      i++;
    } else i++;
  }
  return out.join("\n");
}

// Characters outside Latin-1 that the standard PDF text encoding can still show.
const WIN_ANSI: Record<string, number> = {
  "€": 0x80, "‚": 0x82, "ƒ": 0x83, "„": 0x84, "…": 0x85, "†": 0x86, "‡": 0x87, "ˆ": 0x88, "‰": 0x89, "Š": 0x8a, "‹": 0x8b, "Œ": 0x8c,
  "Ž": 0x8e, "‘": 0x91, "’": 0x92, "“": 0x93, "”": 0x94, "•": 0x95, "–": 0x96, "—": 0x97, "˜": 0x98, "™": 0x99, "š": 0x9a, "›": 0x9b,
  "œ": 0x9c, "ž": 0x9e, "Ÿ": 0x9f,
};

/** Encodes text as a PDF string literal; returns whether every character could be represented. */
function pdfString(text: string): { literal: string; complete: boolean } {
  let literal = "(";
  let complete = true;
  for (const ch of text) {
    let code = ch.codePointAt(0)!;
    if (code > 0xff || (code >= 0x80 && code <= 0x9f)) {
      const mapped = WIN_ANSI[ch];
      if (mapped === undefined) complete = false;
      code = mapped ?? 0x3f;
    }
    if (ch === "(" || ch === ")" || ch === "\\") literal += `\\${ch}`;
    else if (code < 0x20 || code > 0x7e) literal += `\\${code.toString(8).padStart(3, "0")}`;
    else literal += String.fromCharCode(code);
  }
  return { literal: `${literal})`, complete };
}

/** The closest of the fonts every PDF reader has built in. */
function standardFont(node: TextNode): string {
  const family = node.fontFamily.toLowerCase();
  const bold = node.fontWeight >= 600;
  if (/georgia|times|serif$/.test(family) && !/sans/.test(family)) return bold ? "Times-Bold" : "Times-Roman";
  if (/courier|menlo|mono/.test(family)) return bold ? "Courier-Bold" : "Courier";
  return bold ? "Helvetica-Bold" : "Helvetica";
}

class VectorPage {
  ops: string[] = [];
  fonts = new Map<string, string>();
  alphas = new Map<string, number>();
  warnings = new Set<string>();

  private alpha(value: number): string {
    const rounded = Math.round(Math.min(1, Math.max(0, value)) * 1000) / 1000;
    const name = `GS${Math.round(rounded * 1000)}`;
    this.alphas.set(name, rounded);
    return `/${name} gs`;
  }

  private font(name: string): string {
    if (!this.fonts.has(name)) this.fonts.set(name, `F${this.fonts.size + 1}`);
    return this.fonts.get(name)!;
  }

  private text(node: TextNode, paint: Paint, opacity: number) {
    const layout = layoutText(node);
    const font = standardFont(node);
    if (!/^(arial|helvetica|times new roman|courier new)$/i.test(node.fontFamily)) {
      this.warnings.add(`Text set in ${node.fontFamily} uses the PDF's built-in ${font.split("-")[0]} font, so letter shapes and spacing differ slightly.`);
    }
    this.ops.push("BT", this.alpha(opacity * paint.opacity), `${rgb(paint.color)} rg`, `/${this.font(font)} ${n(node.fontSize)} Tf`, `${n(node.letterSpacing)} Tc`);
    layout.lines.forEach((line, i) => {
      const { literal, complete } = pdfString(line);
      if (!complete) this.warnings.add("Some characters are not available in the PDF's built-in fonts and were replaced with “?”. Use Image mode to keep them.");
      const width = layout.lineWidths[i] ?? 0;
      const x = node.textAlign === "center" ? (node.width - width) / 2 : node.textAlign === "right" ? node.width - width : 0;
      // The page is flipped to a top-left origin, so glyphs are flipped back.
      this.ops.push(`1 0 0 -1 ${n(x)} ${n(i * layout.lineHeightPx + layout.baseline)} Tm`, `${literal} Tj`);
    });
    this.ops.push("ET");
  }

  node(page: Page, id: NodeId, inherited: number) {
    const node = page.nodes[id];
    if (!node || !node.visible) return;
    const opacity = inherited * node.opacity;
    if (node.effects.some((e) => e.visible)) this.warnings.add("Drop shadows are not included in a vector PDF. Use Image mode to keep them.");
    if (node.opacity < 1 && isContainer(node) && node.children.length > 1) {
      this.warnings.add("Layer opacity on a container is applied to each child separately, so overlapping children may look denser than on the canvas.");
    }
    this.ops.push("q", `${localMatrix(node).map(n).join(" ")} cm`);
    const outline = pathOps(outlinePath(node));

    if (node.type === "text") {
      for (const paint of node.fills) if (paint.visible) this.text(node, paint, opacity);
    } else if (outline && node.type !== "line") {
      for (const paint of node.fills) {
        if (paint.visible) this.ops.push(this.alpha(opacity * paint.opacity), `${rgb(paint.color)} rg`, outline, "f");
      }
    }
    if (isContainer(node)) {
      const clip = node.type === "frame" && node.clipContent;
      if (clip) this.ops.push("q", outline, "W n");
      for (const child of node.children) this.node(page, child, opacity);
      if (clip) this.ops.push("Q");
    }
    if (outline && node.type !== "text" && node.strokeWidth > 0) {
      this.strokes(node, opacity, outline);
    }
    this.ops.push("Q");
  }

  private strokes(node: SceneNode, opacity: number, outline: string) {
    const caps = { butt: 0, round: 1, square: 2 } as const;
    const joins = { miter: 0, round: 1, bevel: 2 } as const;
    const cap = node.type === "line" || node.type === "vector" ? caps[node.strokeCap] : 0;
    const join = node.type === "vector" ? joins[node.strokeJoin] : 0;
    for (const paint of node.strokes) {
      if (!paint.visible) continue;
      this.ops.push(this.alpha(opacity * paint.opacity), `${rgb(paint.color)} RG`, `${n(node.strokeWidth)} w ${cap} J ${join} j`, outline, "S");
    }
  }
}

/** Assembles PDF objects into a file with a cross-reference table. */
function assemble(objects: (string | Uint8Array)[][]): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const offsets: number[] = [];
  let length = 0;
  const push = (part: string | Uint8Array) => {
    const bytes = typeof part === "string" ? encoder.encode(part) : part;
    chunks.push(bytes);
    length += bytes.length;
  };
  push("%PDF-1.4\n%âãÏÓ\n");
  objects.forEach((parts, i) => {
    offsets.push(length);
    push(`${i + 1} 0 obj\n`);
    parts.forEach(push);
    push("\nendobj\n");
  });
  const xref = length;
  push(`xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`);
  for (const offset of offsets) push(`${String(offset).padStart(10, "0")} 00000 n \n`);
  push(`trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`);
  const out = new Uint8Array(length);
  let at = 0;
  for (const chunk of chunks) {
    out.set(chunk, at);
    at += chunk.length;
  }
  return out;
}

function stream(dictionary: string, data: string | Uint8Array): (string | Uint8Array)[] {
  const bytes = typeof data === "string" ? new TextEncoder().encode(data) : data;
  return [`<< ${dictionary}/Length ${bytes.length} >>\nstream\n`, bytes, "\nendstream"];
}

function document(size: Size, resources: string, content: string, extra: (string | Uint8Array)[][] = []): Uint8Array {
  return assemble([
    ["<< /Type /Catalog /Pages 2 0 R >>"],
    ["<< /Type /Pages /Kids [3 0 R] /Count 1 >>"],
    [`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${n(size.width)} ${n(size.height)}] /Resources << ${resources} >> /Contents 4 0 R >>`],
    stream("", content),
    ...extra,
  ]);
}

/** One PDF page the size of the artwork (1 px = 1 pt), drawn as vectors. */
export function exportVectorPdf(page: Page, request: ExportRequest): ExportResult {
  const bounds: Rect = sourceBounds(page, request.target);
  const writer = new VectorPage();
  // Flip to a top-left origin and move the artwork's corner to the page corner.
  writer.ops.push(`1 0 0 -1 0 ${n(bounds.height)} cm`);
  if (!request.transparent) writer.ops.push(`${rgb(request.background)} rg`, `0 0 ${n(bounds.width)} ${n(bounds.height)} re`, "f");
  writer.ops.push(`1 0 0 1 ${n(-bounds.x)} ${n(-bounds.y)} cm`);
  for (const id of request.target.nodeIds) {
    const parent: Matrix = parentWorldMatrix(page, page.nodes[id]?.parentId ?? null);
    writer.ops.push("q", `${parent.map(n).join(" ")} cm`);
    writer.node(page, id, 1);
    writer.ops.push("Q");
  }
  const fonts = [...writer.fonts].map(([base, name]) => `/${name} << /Type /Font /Subtype /Type1 /BaseFont /${base} /Encoding /WinAnsiEncoding >>`).join(" ");
  const states = [...writer.alphas].map(([name, alpha]) => `/${name} << /ca ${n(alpha)} /CA ${n(alpha)} >>`).join(" ");
  const resources = `/Font << ${fonts} >> /ExtGState << ${states} >>`;
  return {
    bytes: document(bounds, resources, writer.ops.join("\n")),
    width: bounds.width,
    height: bounds.height,
    warnings: [...writer.warnings],
  };
}

/** One PDF page holding a JPEG of the artwork. `jpeg` must be baseline RGB of `pixels` size. */
export function exportImagePdf(pageSize: Size, jpeg: Uint8Array, pixels: Size): ExportResult {
  const image = stream(
    `/Type /XObject /Subtype /Image /Width ${pixels.width} /Height ${pixels.height} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode `,
    jpeg,
  );
  const content = `q ${n(pageSize.width)} 0 0 ${n(pageSize.height)} 0 0 cm /Im1 Do Q`;
  return {
    bytes: document(pageSize, "/XObject << /Im1 5 0 R >>", content, [image]),
    width: pageSize.width,
    height: pageSize.height,
    warnings: ["Image mode stores a picture of the artwork: it matches the canvas exactly but text is not selectable and it will not stay sharp when zoomed far in."],
  };
}
