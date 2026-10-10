import type { NodeId, Page, SceneNode } from "./types";

export interface Point {
  x: number;
  y: number;
}

export interface Rect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** 2D affine matrix [a, b, c, d, e, f] as used by SVG/CSS `matrix()`. */
export type Matrix = readonly [number, number, number, number, number, number];

export const IDENTITY: Matrix = [1, 0, 0, 1, 0, 0];

/** Returns `m1 · m2` (m2 is applied first). */
export function multiply(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ];
}

export function invert(m: Matrix): Matrix {
  const det = m[0] * m[3] - m[1] * m[2];
  if (det === 0) return IDENTITY;
  return [
    m[3] / det,
    -m[1] / det,
    -m[2] / det,
    m[0] / det,
    (m[2] * m[5] - m[3] * m[4]) / det,
    (m[1] * m[4] - m[0] * m[5]) / det,
  ];
}

export function translation(x: number, y: number): Matrix {
  return [1, 0, 0, 1, x, y];
}

export function applyToPoint(m: Matrix, p: Point): Point {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] };
}

export function rotatePoint(p: Point, degrees: number): Point {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { x: p.x * cos - p.y * sin, y: p.x * sin + p.y * cos };
}

type Box = Pick<SceneNode, "x" | "y" | "width" | "height" | "rotation">;

/** Maps a node's local space (origin at its top-left) into its parent's space. */
export function localMatrix(node: Box): Matrix {
  const r = (node.rotation * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  const cx = node.width / 2;
  const cy = node.height / 2;
  return [cos, sin, -sin, cos, node.x + cx - cos * cx + sin * cy, node.y + cy - sin * cx - cos * cy];
}

/** Maps a node's local space into page (world) space. */
export function worldMatrix(page: Page, id: NodeId): Matrix {
  let m: Matrix = IDENTITY;
  let current = page.nodes[id];
  while (current) {
    m = multiply(localMatrix(current), m);
    current = current.parentId ? page.nodes[current.parentId] : undefined;
  }
  return m;
}

/** World matrix of the space a node's children live in (identity for the page). */
export function parentWorldMatrix(page: Page, parentId: NodeId | null): Matrix {
  return parentId ? worldMatrix(page, parentId) : IDENTITY;
}

/**
 * Recovers x / y / rotation for a box of the given size whose local matrix is
 * the rigid transform `m`.
 */
export function decompose(m: Matrix, width: number, height: number): { x: number; y: number; rotation: number } {
  const rotation = normalizeAngle((Math.atan2(m[1], m[0]) * 180) / Math.PI);
  const centre = applyToPoint(m, { x: width / 2, y: height / 2 });
  return { x: centre.x - width / 2, y: centre.y - height / 2, rotation };
}

export function normalizeAngle(degrees: number): number {
  let a = degrees % 360;
  if (a > 180) a -= 360;
  if (a <= -180) a += 360;
  return Math.abs(a) < 1e-9 ? 0 : a;
}

export function cornersOf(m: Matrix, width: number, height: number): [Point, Point, Point, Point] {
  return [
    applyToPoint(m, { x: 0, y: 0 }),
    applyToPoint(m, { x: width, y: 0 }),
    applyToPoint(m, { x: width, y: height }),
    applyToPoint(m, { x: 0, y: height }),
  ];
}

export function boundsOfPoints(points: readonly Point[]): Rect {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    minX = Math.min(minX, p.x);
    minY = Math.min(minY, p.y);
    maxX = Math.max(maxX, p.x);
    maxY = Math.max(maxY, p.y);
  }
  if (minX === Infinity) return { x: 0, y: 0, width: 0, height: 0 };
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

export function unionRects(rects: readonly Rect[]): Rect | null {
  if (rects.length === 0) return null;
  return boundsOfPoints(
    rects.flatMap((r) => [
      { x: r.x, y: r.y },
      { x: r.x + r.width, y: r.y + r.height },
    ]),
  );
}

/** Axis-aligned bounds of a node in page space. */
export function worldBounds(page: Page, id: NodeId): Rect {
  const node = page.nodes[id];
  if (!node) return { x: 0, y: 0, width: 0, height: 0 };
  return boundsOfPoints(cornersOf(worldMatrix(page, id), node.width, node.height));
}

export function selectionBounds(page: Page, ids: readonly NodeId[]): Rect | null {
  return unionRects(ids.filter((id) => page.nodes[id]).map((id) => worldBounds(page, id)));
}

export function rectsIntersect(a: Rect, b: Rect): boolean {
  return a.x <= b.x + b.width && a.x + a.width >= b.x && a.y <= b.y + b.height && a.y + a.height >= b.y;
}

export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

export function rectFromPoints(a: Point, b: Point): Rect {
  return { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), width: Math.abs(a.x - b.x), height: Math.abs(a.y - b.y) };
}

export function round(value: number, decimals = 2): number {
  const f = 10 ** decimals;
  const r = Math.round(value * f) / f;
  return r === 0 ? 0 : r;
}
