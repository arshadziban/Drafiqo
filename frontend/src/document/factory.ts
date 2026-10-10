import {
  FILE_FORMAT,
  SCHEMA_VERSION,
  type BaseNode,
  type DrafiqoDocument,
  type LayerBlurEffect,
  type ShadowEffect,
  type EllipseNode,
  type FrameNode,
  type GroupNode,
  type LineNode,
  type NodeType,
  type Page,
  type PathPoint,
  type PolygonNode,
  type RectangleNode,
  type SectionNode,
  type ImageScaleMode,
  type ImagePaint,
  type SolidPaint,
  type StarNode,
  type TextNode,
  type VectorNode,
} from "./types";
import { fitTextNode } from "./textLayout";

const ID_ALPHABET = "0123456789abcdefghijklmnopqrstuvwxyz";

/** Collision-resistant id; stable for the lifetime of the object it names. */
export function createId(prefix = ""): string {
  const bytes = new Uint8Array(12);
  globalThis.crypto.getRandomValues(bytes);
  let id = "";
  for (const b of bytes) id += ID_ALPHABET[b % ID_ALPHABET.length];
  return prefix ? `${prefix}_${id}` : id;
}

export function solidPaint(color: string, opacity = 1): SolidPaint {
  return { id: createId("p"), type: "solid", color, opacity, visible: true };
}

export function imagePaint(assetId: string, scaleMode: ImageScaleMode = "fill"): ImagePaint {
  return { id: createId("p"), type: "image", assetId, scaleMode, opacity: 1, visible: true };
}

export function dropShadow(): ShadowEffect {
  return {
    id: createId("fx"),
    type: "drop-shadow",
    color: "#000000",
    opacity: 0.25,
    offsetX: 0,
    offsetY: 4,
    blur: 8,
    spread: 0,
    visible: true,
  };
}

export function innerShadow(): ShadowEffect {
  return { ...dropShadow(), type: "inner-shadow" };
}

export function layerBlur(): LayerBlurEffect {
  return { id: createId("fx"), type: "layer-blur", blur: 8, visible: true };
}

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

export const DEFAULT_NAMES: Record<NodeType, string> = {
  frame: "Frame",
  section: "Section",
  group: "Group",
  rectangle: "Rectangle",
  ellipse: "Ellipse",
  line: "Line",
  polygon: "Polygon",
  star: "Star",
  text: "Text",
  vector: "Vector",
};

function base(type: NodeType, box: Box): BaseNode {
  return {
    id: createId("n"),
    name: DEFAULT_NAMES[type],
    parentId: null,
    x: box.x,
    y: box.y,
    width: box.width,
    height: box.height,
    rotation: 0,
    opacity: 1,
    visible: true,
    locked: false,
    fills: [],
    strokes: [],
    strokeWidth: 1,
    effects: [],
  };
}

const SHAPE_FILL = "#d9d9d9";

export function createFrame(box: Box): FrameNode {
  return {
    ...base("frame", box),
    type: "frame",
    fills: [solidPaint("#ffffff")],
    children: [],
    clipContent: true,
    cornerRadius: 0,
  };
}

export function createSection(box: Box): SectionNode {
  return {
    ...base("section", box),
    type: "section",
    fills: [solidPaint("#ffffff", 0.06)],
    strokes: [solidPaint("#7d8596")],
    children: [],
  };
}

export function createGroup(box: Box): GroupNode {
  return { ...base("group", box), type: "group", children: [] };
}

export function createRectangle(box: Box): RectangleNode {
  return { ...base("rectangle", box), type: "rectangle", fills: [solidPaint(SHAPE_FILL)], cornerRadius: 0 };
}

export function createEllipse(box: Box): EllipseNode {
  return { ...base("ellipse", box), type: "ellipse", fills: [solidPaint(SHAPE_FILL)] };
}

export function createLine(from: { x: number; y: number }, to: { x: number; y: number }): LineNode {
  const length = Math.hypot(to.x - from.x, to.y - from.y);
  const midX = (from.x + to.x) / 2;
  const midY = (from.y + to.y) / 2;
  return {
    ...base("line", { x: midX - length / 2, y: midY, width: length, height: 0 }),
    type: "line",
    rotation: (Math.atan2(to.y - from.y, to.x - from.x) * 180) / Math.PI,
    strokes: [solidPaint("#000000")],
    strokeWidth: 2,
    strokeCap: "butt",
  };
}

export function createPolygon(box: Box): PolygonNode {
  return { ...base("polygon", box), type: "polygon", fills: [solidPaint(SHAPE_FILL)], sides: 3 };
}

export function createStar(box: Box): StarNode {
  return { ...base("star", box), type: "star", fills: [solidPaint(SHAPE_FILL)], pointCount: 5, innerRatio: 0.4 };
}

export function createText(box: Box, text = "", autoResize: TextNode["autoResize"] = "auto"): TextNode {
  return fitTextNode({
    ...base("text", box),
    type: "text",
    fills: [solidPaint("#000000")],
    text,
    fontFamily: "Arial",
    fontSize: 16,
    fontWeight: 400,
    lineHeight: 1.4,
    letterSpacing: 0,
    textAlign: "left",
    autoResize,
  });
}

/** Builds a vector node from points given in the parent's space. */
export function createVector(points: PathPoint[], closed: boolean): VectorNode {
  const xs = points.map((p) => p.x);
  const ys = points.map((p) => p.y);
  const minX = Math.min(...xs);
  const minY = Math.min(...ys);
  const local = points.map((p) => shiftPoint(p, -minX, -minY));
  return {
    ...base("vector", { x: minX, y: minY, width: Math.max(...xs) - minX, height: Math.max(...ys) - minY }),
    type: "vector",
    strokes: [solidPaint("#000000")],
    strokeWidth: 2,
    points: local,
    closed,
    strokeCap: "round",
    strokeJoin: "round",
  };
}

export function shiftPoint(p: PathPoint, dx: number, dy: number): PathPoint {
  const out: PathPoint = { x: p.x + dx, y: p.y + dy };
  if (p.inX !== undefined && p.inY !== undefined) {
    out.inX = p.inX + dx;
    out.inY = p.inY + dy;
  }
  if (p.outX !== undefined && p.outY !== undefined) {
    out.outX = p.outX + dx;
    out.outY = p.outY + dy;
  }
  return out;
}

export function createPage(name: string): Page {
  return { id: createId("pg"), name, background: "#1e1f24", children: [], nodes: {} };
}

export function createDocument(name = "Untitled"): DrafiqoDocument {
  const now = new Date().toISOString();
  return {
    format: FILE_FORMAT,
    schemaVersion: SCHEMA_VERSION,
    id: createId("doc"),
    name,
    createdAt: now,
    updatedAt: now,
    pages: [createPage("Page 1")],
    assets: {},
  };
}
