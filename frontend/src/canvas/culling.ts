import { create } from "zustand";
import { applyToPoint, boundsOfPoints, cornersOf, localMatrix, type Matrix, type Rect } from "../document/geometry";
import { isContainer, type NodeId, type Page, type SceneNode } from "../document/types";
import { currentPage, currentViewport, useEditor, type Viewport } from "../editor/store";

// Layers that cannot be seen are not drawn: ones outside the window, and ones
// too small to make out at the current zoom. Without this a page of thousands
// of layers is repainted in full on every pan, zoom and drag.
//
// Top-level layers and their direct children are checked; that is where a
// large page keeps its bulk (a board of frames, a frame full of icons), and it
// keeps the check itself cheap. Only the canvas is affected: selection,
// snapping and export work from the document, not from what is drawn.

interface CullState {
  hidden: ReadonlySet<NodeId>;
}

export const useCulled = create<CullState>()(() => ({ hidden: new Set() }));

/** How far outside the window layers stay drawn, as a fraction of its size, so a small pan needs no new drawing. */
const MARGIN = 0.5;
/** A layer smaller than this many screen pixels, both ways, is left out. */
const SPECK = 1;
/** Pages with fewer layers than this are simply drawn whole. */
const WORTH_IT = 400;

/** A child's box in its parent's space, remembered while neither the child nor its box changes. */
const boxes = new WeakMap<SceneNode, Rect>();
function boxInParent(node: SceneNode): Rect {
  let box = boxes.get(node);
  if (!box) {
    box = boundsOfPoints(cornersOf(localMatrix(node), node.width, node.height));
    boxes.set(node, box);
  }
  return box;
}

/** The effects a layer casts can reach past its box. */
const reach = (node: SceneNode) => (node.effects.length > 0 ? node.effects.reduce((most, e) => Math.max(most, e.blur * 2 + ("spread" in e ? Math.abs(e.spread) + Math.abs(e.offsetX) + Math.abs(e.offsetY) : 0)), 0) : 0) + node.strokeWidth;

/** The layers of a page that need not be drawn for this view. */
export function culledNodes(page: Page, viewport: Viewport, size: { width: number; height: number }): Set<NodeId> {
  const hidden = new Set<NodeId>();
  if (size.width === 0 || size.height === 0) return hidden;
  const zoom = viewport.zoom;
  const left = (-viewport.x - size.width * MARGIN) / zoom;
  const top = (-viewport.y - size.height * MARGIN) / zoom;
  const right = (size.width * (1 + MARGIN) - viewport.x) / zoom;
  const bottom = (size.height * (1 + MARGIN) - viewport.y) / zoom;
  const speck = SPECK / zoom;

  const outOfSight = (box: Rect, pad: number) => box.x - pad > right || box.x + box.width + pad < left || box.y - pad > bottom || box.y + box.height + pad < top;
  for (const id of page.children) {
    const node = page.nodes[id];
    if (!node) continue;
    const box = boxInParent(node);
    // A group or an unclipped frame can show children beyond its own box, so only its children are judged.
    const contains = !isContainer(node) || (node.type === "frame" && node.clipContent);
    if (contains && outOfSight(box, reach(node))) {
      hidden.add(id);
      continue;
    }
    if (!isContainer(node)) continue;
    const toPage: Matrix = localMatrix(node);
    const upright = toPage[1] === 0 && toPage[2] === 0;
    for (const childId of node.children) {
      const child = page.nodes[childId];
      if (!child) continue;
      const local = boxInParent(child);
      const world = upright
        ? { x: local.x + toPage[4], y: local.y + toPage[5], width: local.width, height: local.height }
        : boundsOfPoints([applyToPoint(toPage, { x: local.x, y: local.y }), applyToPoint(toPage, { x: local.x + local.width, y: local.y }), applyToPoint(toPage, { x: local.x + local.width, y: local.y + local.height }), applyToPoint(toPage, { x: local.x, y: local.y + local.height })]);
      const holds = !isContainer(child) || (child.type === "frame" && child.clipContent);
      if (holds && (outOfSight(world, reach(child)) || (world.width < speck && world.height < speck))) hidden.add(childId);
    }
  }
  return hidden;
}

function sameSet(a: ReadonlySet<NodeId>, b: ReadonlySet<NodeId>): boolean {
  if (a.size !== b.size) return false;
  for (const id of a) if (!b.has(id)) return false;
  return true;
}
const NONE: ReadonlySet<NodeId> = new Set();

/** Keeps the set of undrawn layers in step with the page and the view. */
export function watchCulling(): void {
  let scheduled = false;
  let seen: { page: Page; viewport: Viewport; width: number; height: number } | null = null;
  const update = () => {
    scheduled = false;
    const s = useEditor.getState();
    const page = currentPage(s);
    const viewport = currentViewport(s);
    const { width, height } = s.canvasSize;
    if (seen && seen.page === page && seen.viewport === viewport && seen.width === width && seen.height === height) return;
    seen = { page, viewport, width, height };
    const next = Object.keys(page.nodes).length < WORTH_IT ? NONE : culledNodes(page, viewport, s.canvasSize);
    if (!sameSet(next, useCulled.getState().hidden)) useCulled.setState({ hidden: next });
  };
  useEditor.subscribe(() => {
    if (scheduled) return;
    scheduled = true;
    requestAnimationFrame(update);
  });
}
