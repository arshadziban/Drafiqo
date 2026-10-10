import type { CornerRadii, PathPoint, PolygonNode, SceneNode, StarNode } from "../document/types";

const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

function radialPoints(count: number, width: number, height: number, radiusAt: (i: number) => number): string {
  const cx = width / 2;
  const cy = height / 2;
  const parts: string[] = [];
  for (let i = 0; i < count; i++) {
    const angle = -Math.PI / 2 + (i * 2 * Math.PI) / count;
    const r = radiusAt(i);
    parts.push(`${fmt(cx + Math.cos(angle) * cx * r)},${fmt(cy + Math.sin(angle) * cy * r)}`);
  }
  return parts.join(" ");
}

/** `points` attribute for a regular polygon inscribed in the node's box. */
export function polygonPoints(node: Pick<PolygonNode, "sides" | "width" | "height">): string {
  return radialPoints(Math.max(3, node.sides), node.width, node.height, () => 1);
}

export function starPoints(node: Pick<StarNode, "pointCount" | "innerRatio" | "width" | "height">): string {
  return radialPoints(Math.max(3, node.pointCount) * 2, node.width, node.height, (i) => (i % 2 === 0 ? 1 : node.innerRatio));
}

/** SVG path data for a vector node's anchors and Bézier handles. */
export function vectorPath(points: readonly PathPoint[], closed: boolean): string {
  const first = points[0];
  if (!first) return "";
  let d = `M${fmt(first.x)} ${fmt(first.y)}`;
  const segment = (from: PathPoint, to: PathPoint) => {
    const hasOut = from.outX !== undefined && from.outY !== undefined;
    const hasIn = to.inX !== undefined && to.inY !== undefined;
    if (!hasOut && !hasIn) return ` L${fmt(to.x)} ${fmt(to.y)}`;
    const c1x = hasOut ? from.outX! : from.x;
    const c1y = hasOut ? from.outY! : from.y;
    const c2x = hasIn ? to.inX! : to.x;
    const c2y = hasIn ? to.inY! : to.y;
    return ` C${fmt(c1x)} ${fmt(c1y)} ${fmt(c2x)} ${fmt(c2y)} ${fmt(to.x)} ${fmt(to.y)}`;
  };
  for (let i = 1; i < points.length; i++) d += segment(points[i - 1]!, points[i]!);
  if (closed && points.length > 1) d += `${segment(points[points.length - 1]!, first)} Z`;
  return d;
}

const K = 0.5522847498; // control-point offset that makes a cubic Bézier approximate a quarter circle

/**
 * A frame's or rectangle's corner radii, scaled down together when neighbouring corners
 * would overlap along a side (the same rule as CSS border-radius).
 */
export function cornerRadiiOf(node: { width: number; height: number; cornerRadii: CornerRadii }): CornerRadii {
  const [tl, tr, br, bl] = node.cornerRadii;
  const fit = (side: number, sum: number) => (sum > side ? side / sum : 1);
  const f = Math.min(fit(node.width, tl + tr), fit(node.width, bl + br), fit(node.height, tl + bl), fit(node.height, tr + br));
  return [tl * f, tr * f, br * f, bl * f];
}

/**
 * A node's outline as path data using only absolute M, L, C and Z commands,
 * for writers (such as PDF) that have no shape primitives.
 */
export function outlinePath(node: SceneNode): string {
  const { width: w, height: h } = node;
  switch (node.type) {
    case "frame":
    case "rectangle":
    case "section": {
      const [tl, tr, br, bl] = node.type === "section" ? [2, 2, 2, 2] : cornerRadiiOf(node);
      const c = (r: number) => r * (1 - K);
      return [
        `M${fmt(tl)} 0`,
        `L${fmt(w - tr)} 0 C${fmt(w - c(tr))} 0 ${fmt(w)} ${fmt(c(tr))} ${fmt(w)} ${fmt(tr)}`,
        `L${fmt(w)} ${fmt(h - br)} C${fmt(w)} ${fmt(h - c(br))} ${fmt(w - c(br))} ${fmt(h)} ${fmt(w - br)} ${fmt(h)}`,
        `L${fmt(bl)} ${fmt(h)} C${fmt(c(bl))} ${fmt(h)} 0 ${fmt(h - c(bl))} 0 ${fmt(h - bl)}`,
        `L0 ${fmt(tl)} C0 ${fmt(c(tl))} ${fmt(c(tl))} 0 ${fmt(tl)} 0 Z`,
      ].join(" ");
    }
    case "ellipse": {
      const rx = w / 2;
      const ry = h / 2;
      const kx = rx * K;
      const ky = ry * K;
      return [
        `M${fmt(rx)} 0`,
        `C${fmt(rx + kx)} 0 ${fmt(w)} ${fmt(ry - ky)} ${fmt(w)} ${fmt(ry)}`,
        `C${fmt(w)} ${fmt(ry + ky)} ${fmt(rx + kx)} ${fmt(h)} ${fmt(rx)} ${fmt(h)}`,
        `C${fmt(rx - kx)} ${fmt(h)} 0 ${fmt(ry + ky)} 0 ${fmt(ry)}`,
        `C0 ${fmt(ry - ky)} ${fmt(rx - kx)} 0 ${fmt(rx)} 0 Z`,
      ].join(" ");
    }
    case "line":
      return `M0 0 L${fmt(w)} 0`;
    case "polygon":
    case "star": {
      const points = (node.type === "polygon" ? polygonPoints(node) : starPoints(node)).split(" ").map((p) => p.replace(",", " "));
      return `M${points[0]} ${points.slice(1).map((p) => `L${p}`).join(" ")} Z`;
    }
    case "vector":
      return vectorPath(node.points, node.closed);
    default:
      return "";
  }
}
