import { rectsIntersect, worldBounds, type Rect } from "../document/geometry";
import { ancestorsOf, pathTo } from "../document/tree";
import type { NodeId, Page } from "../document/types";

const isFrameLike = (page: Page, id: NodeId) => {
  const type = page.nodes[id]?.type;
  return type === "frame" || type === "section";
};

/**
 * Decides which node a click on `hitId` selects.
 *
 * Frames and sections are see-through for selection: their children are
 * picked directly. Groups are picked as a whole until the user has drilled
 * into them (the current selection is inside the group) or deep-selects.
 * Clicking the background of a top-level frame that has children picks
 * nothing, so a marquee can be started there.
 */
export function resolveClickTarget(page: Page, hitId: NodeId, selection: readonly NodeId[], deep: boolean): NodeId | null {
  const hit = page.nodes[hitId];
  if (!hit) return null;
  if (deep) return hitId;
  const path = pathTo(page, hitId);
  let i = 0;
  while (i < path.length - 1 && isFrameLike(page, path[i]!)) i++;

  // Stay inside whichever group the current selection already lives in.
  const scopes = new Set(selection.flatMap((id) => ancestorsOf(page, id)));
  while (i < path.length - 1 && scopes.has(path[i]!)) i++;

  const target = path[i]!;
  const node = page.nodes[target]!;
  const isBackgroundOfBusyTopFrame =
    target === hitId && (node.type === "frame" || node.type === "section") && node.parentId === null && node.children.length > 0;
  return isBackgroundOfBusyTopFrame ? null : target;
}

/** One level deeper than `resolveClickTarget`, for double-click drilling. */
export function resolveDrillTarget(page: Page, hitId: NodeId, current: NodeId | null): NodeId | null {
  if (!current) return null;
  const path = pathTo(page, hitId);
  const index = path.indexOf(current);
  return index >= 0 && index < path.length - 1 ? path[index + 1]! : null;
}

/** Nodes picked by a marquee: leaves it touches, and frames it fully encloses. */
export function nodesInMarquee(page: Page, marquee: Rect): NodeId[] {
  const out: NodeId[] = [];
  const visit = (ids: readonly NodeId[]) => {
    for (const id of ids) {
      const node = page.nodes[id];
      if (!node || !node.visible || node.locked) continue;
      const bounds = worldBounds(page, id);
      if (!rectsIntersect(bounds, marquee)) continue;
      if ((node.type === "frame" || node.type === "section") && node.children.length > 0) {
        const enclosed =
          bounds.x >= marquee.x &&
          bounds.y >= marquee.y &&
          bounds.x + bounds.width <= marquee.x + marquee.width &&
          bounds.y + bounds.height <= marquee.y + marquee.height;
        if (enclosed) out.push(id);
        else visit(node.children);
      } else {
        out.push(id);
      }
    }
  };
  visit(page.children);
  return out;
}
