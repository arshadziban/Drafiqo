// Turns document content into a standalone SVG, straight from the document
// model. Raster formats rasterise this SVG at the requested output size, so
// a 4× export is drawn at 4×, never upscaled from a smaller picture.

import { renderToStaticMarkup } from "react-dom/server";
import { NodeElement } from "../canvas/renderNode";
import { applyToPoint, boundsOfPoints, cornersOf, parentWorldMatrix, unionRects, worldMatrix, type Rect } from "../document/geometry";
import { topLevelSelection } from "../document/tree";
import { isContainer, type NodeId, type Page } from "../document/types";
import type { ExportTarget, FitMode, Size } from "./exportTypes";

/** What can be exported right now: the selection first, then frames, then the whole page. */
export function listExportTargets(page: Page, selection: readonly NodeId[]): ExportTarget[] {
  const targets: ExportTarget[] = [];
  const selected = topLevelSelection(page, selection);
  if (selected.length > 1) {
    targets.push({ key: "selection", label: `Selection (${selected.length} layers)`, kind: "selection", nodeIds: selected });
  }
  const listed = new Set<NodeId>();
  const addNode = (id: NodeId) => {
    const node = page.nodes[id];
    if (!node || listed.has(id)) return;
    listed.add(id);
    targets.push({ key: id, label: node.name, kind: "node", nodeIds: [id] });
  };
  selected.forEach(addNode);
  for (const id of page.children) {
    const type = page.nodes[id]?.type;
    if (type === "frame" || type === "section") addNode(id);
  }
  if (page.children.length > 0) {
    targets.push({ key: "page", label: `Entire page (${page.name})`, kind: "page", nodeIds: [...page.children] });
  }
  return targets;
}

/** Page-space area a node paints into, including strokes, shadows and unclipped children. */
function paintedBounds(page: Page, id: NodeId): Rect | null {
  const node = page.nodes[id];
  if (!node || !node.visible) return null;
  // Work out how far paint reaches past the node's box in its own (unrotated) space.
  const stroke = node.strokeWidth > 0 && node.strokes.some((s) => s.visible) ? node.strokeWidth / 2 : 0;
  // A butt-capped line stops exactly at its end points.
  const along = node.type === "line" && node.strokeCap === "butt" ? 0 : stroke;
  let left = along;
  let right = along;
  let top = stroke;
  let bottom = stroke;
  for (const effect of node.effects) {
    if (!effect.visible) continue;
    left = Math.max(left, along + effect.blur - effect.offsetX);
    right = Math.max(right, along + effect.blur + effect.offsetX);
    top = Math.max(top, stroke + effect.blur - effect.offsetY);
    bottom = Math.max(bottom, stroke + effect.blur + effect.offsetY);
  }
  const m = worldMatrix(page, id);
  const own = boundsOfPoints([
    applyToPoint(m, { x: -left, y: -top }),
    applyToPoint(m, { x: node.width + right, y: -top }),
    applyToPoint(m, { x: node.width + right, y: node.height + bottom }),
    applyToPoint(m, { x: -left, y: node.height + bottom }),
  ]);
  const clips = node.type === "frame" && node.clipContent;
  if (!isContainer(node) || clips) return own;
  const parts = node.children.map((c) => paintedBounds(page, c)).filter((r): r is Rect => r !== null);
  // A group has no pixels of its own.
  return unionRects(node.type === "group" ? parts : [own, ...parts]);
}

/**
 * The area an export target covers. A single frame or section exports as
 * exactly its own box (an artboard of 375 × 812 is 375 × 812). Anything else
 * is measured by what it paints, so strokes and shadows are not cut off.
 */
export function sourceBounds(page: Page, target: ExportTarget): Rect {
  const only = target.nodeIds.length === 1 ? page.nodes[target.nodeIds[0]!] : undefined;
  if (only && (only.type === "frame" || only.type === "section")) {
    const box = boundsOfPoints(cornersOf(worldMatrix(page, only.id), only.width, only.height));
    return { x: box.x, y: box.y, width: Math.max(1, box.width), height: Math.max(1, box.height) };
  }
  const painted = unionRects(target.nodeIds.map((id) => paintedBounds(page, id)).filter((r): r is Rect => r !== null));
  if (!painted) return { x: 0, y: 0, width: 0, height: 0 };
  // Whole pixels, growing outward so nothing is shaved off.
  const x = Math.floor(painted.x + 1e-6);
  const y = Math.floor(painted.y + 1e-6);
  return {
    x,
    y,
    width: Math.max(1, Math.ceil(painted.x + painted.width - 1e-6) - x),
    height: Math.max(1, Math.ceil(painted.y + painted.height - 1e-6) - y),
  };
}

const ASPECT: Record<FitMode, string> = { contain: "xMidYMid meet", cover: "xMidYMid slice", stretch: "none" };

function StaticNode({ page, id }: { page: Page; id: NodeId }) {
  const node = page.nodes[id];
  if (!node) return null;
  return <NodeElement node={node} interactive={false} renderChild={(child) => <StaticNode key={child} page={page} id={child} />} />;
}

export interface SvgOptions {
  /** Output size in pixels. Defaults to the source size. */
  size?: Size;
  fit?: FitMode;
  /** #rrggbb painted behind the artwork across the whole output, or null for transparent. */
  background?: string | null;
}

/** A complete, self-contained SVG document for an export target. */
export function renderSvg(page: Page, target: ExportTarget, options: SvgOptions = {}): string {
  const bounds = sourceBounds(page, target);
  const size = options.size ?? { width: bounds.width, height: bounds.height };
  const markup = renderToStaticMarkup(
    <svg xmlns="http://www.w3.org/2000/svg" width={size.width} height={size.height} viewBox={`0 0 ${size.width} ${size.height}`}>
      {options.background && <rect width={size.width} height={size.height} fill={options.background} />}
      <svg
        width={size.width}
        height={size.height}
        viewBox={`${bounds.x} ${bounds.y} ${bounds.width} ${bounds.height}`}
        preserveAspectRatio={ASPECT[options.fit ?? "contain"]}
      >
        {target.nodeIds.map((id) => (
          <g key={id} transform={`matrix(${parentWorldMatrix(page, page.nodes[id]?.parentId ?? null).join(" ")})`}>
            <StaticNode page={page} id={id} />
          </g>
        ))}
      </svg>
    </svg>,
  );
  return `<?xml version="1.0" encoding="UTF-8"?>\n${markup}\n`;
}
