// Pure editing commands. Each takes a page (or document) and returns a new
// one, sharing every untouched node with the input so history snapshots stay
// cheap and React can skip unchanged layers.

import { DEFAULT_NAMES, createFrame, createGroup, createId, createPage, type Box } from "../document/factory";
import {
  applyToPoint,
  boundsOfPoints,
  cornersOf,
  decompose,
  invert,
  localMatrix,
  multiply,
  parentWorldMatrix,
  rotatePoint,
  round,
  translation,
  worldBounds,
  worldMatrix,
  type Matrix,
  type Point,
  type Rect,
} from "../document/geometry";
import { fitTextNode } from "../document/textLayout";
import { childrenOf, isDescendantOf, nextName, subtreeIds, topLevelSelection } from "../document/tree";
import {
  isContainer,
  type AutoLayout,
  type BaseNode,
  type LayoutItem,
  type DrafiqoDocument,
  type FrameNode,
  type LineNode,
  type NodeId,
  type Page,
  type PageId,
  type PolygonNode,
  type SceneNode,
  type StarNode,
  type TextNode,
  type VectorNode,
} from "../document/types";

type Nodes = Record<NodeId, SceneNode>;

/** Editable properties. Size goes through `resizeNode`; structure through the tree commands. */
export type NodePatch = Partial<Omit<BaseNode, "id" | "parentId" | "width" | "height">> &
  Partial<Pick<FrameNode, "clipContent" | "cornerRadii">> &
  Partial<Pick<LineNode, "strokeCap">> &
  Partial<Pick<PolygonNode, "sides">> &
  Partial<Pick<StarNode, "pointCount" | "innerRatio">> &
  Partial<Pick<TextNode, "text" | "fontFamily" | "fontSize" | "fontWeight" | "lineHeight" | "letterSpacing" | "textAlign" | "autoResize">> &
  Partial<Pick<VectorNode, "strokeJoin">>;

// ---------------------------------------------------------------------------
// Low-level helpers
// ---------------------------------------------------------------------------

function withChildren(page: Page, nodes: Nodes, parentId: NodeId | null, children: NodeId[]): Page {
  if (parentId === null) return { ...page, nodes, children };
  const parent = nodes[parentId];
  if (!parent || !isContainer(parent)) return { ...page, nodes };
  nodes[parentId] = { ...parent, children };
  return { ...page, nodes };
}

function detach(page: Page, id: NodeId): Page {
  const node = page.nodes[id];
  if (!node) return page;
  const siblings = childrenOf(page, node.parentId).filter((c) => c !== id);
  return withChildren(page, { ...page.nodes }, node.parentId, siblings);
}

function attach(page: Page, id: NodeId, parentId: NodeId | null, index?: number): Page {
  const node = page.nodes[id];
  if (!node) return page;
  const siblings = [...childrenOf(page, parentId)];
  siblings.splice(index ?? siblings.length, 0, id);
  const nodes = { ...page.nodes, [id]: { ...node, parentId } };
  return withChildren(page, nodes, parentId, siblings);
}

function normalize(node: SceneNode): SceneNode {
  if (node.type === "text") return fitTextNode(node);
  if (node.type === "line" && node.height !== 0) return { ...node, height: 0 };
  return node;
}

/** The box a rotated child takes up in its parent's space. */
const boxInParent = (node: SceneNode): Rect => boundsOfPoints(cornersOf(localMatrix(node), node.width, node.height));

/** A node's x/y after its size changes, with its top-left corner staying where it is in the parent. */
function keepTopLeft(node: SceneNode, width: number, height: number): Point {
  const fixed = applyToPoint(localMatrix(node), { x: 0, y: 0 });
  const offset = rotatePoint({ x: -width / 2, y: -height / 2 }, node.rotation);
  return { x: fixed.x - offset.x - width / 2, y: fixed.y - offset.y - height / 2 };
}

type Axis = "x" | "y";
const AXES: readonly Axis[] = ["x", "y"];
const sizeAlong = (box: { width: number; height: number }, axis: Axis) => (axis === "x" ? box.width : box.height);

/** A size the layout wants for a node, kept within the node's own minimum and maximum. */
function withinLimits(node: SceneNode, axis: Axis, value: number): number {
  const item = node.layoutItem;
  const min = axis === "x" ? item?.minWidth : item?.minHeight;
  const max = axis === "x" ? item?.maxWidth : item?.maxHeight;
  let size = value;
  if (max !== undefined) size = Math.min(size, max);
  if (min !== undefined) size = Math.max(size, min);
  return Math.max(1, size);
}

/** Whether a layer takes part in its auto layout parent's flow. */
const flows = (node: SceneNode) => node.visible && !node.layoutItem?.absolute;

/**
 * Lays out every auto layout frame. Each frame settles its children first,
 * then its widths, then its heights (a text that is made narrower gets taller),
 * and finally places the children. Returns the input page when everything is
 * already in place.
 */
function applyAutoLayout(page: Page, dirty: ReadonlySet<NodeId> | null): Page {
  let nodes: Nodes | null = null;
  const current = () => nodes ?? page.nodes;
  const mutable = () => (nodes ??= { ...page.nodes });
  const eps = 1e-6;

  /**
   * `stretchX`/`stretchY`: the parent decides this node's size along that axis, so it cannot hug there.
   * A container nothing has changed in is already laid out and is skipped, unless its parent was
   * looked at (`force`): the parent may have just resized it, or changed how it is sized.
   */
  const visit = (id: NodeId, stretchX: boolean, stretchY: boolean, force: boolean) => {
    if (dirty && !force && !dirty.has(id)) return;
    const before = current()[id];
    if (!before || !isContainer(before)) return;
    if (before.type !== "frame" || !before.layout) {
      before.children.forEach((childId) => visit(childId, false, false, true));
      return;
    }
    const layout = before.layout;
    const horizontal = layout.mode === "horizontal";
    const fills = (child: SceneNode, axis: Axis) =>
      !layout.wrap && child.rotation === 0 && flows(child) && (axis === "x" ? child.layoutItem?.fillWidth : child.layoutItem?.fillHeight) === true;
    const settle = (childId: NodeId) => {
      const child = current()[childId];
      if (child) visit(childId, fills(child, "x"), fills(child, "y"), true);
    };
    const frameNow = () => current()[id] as FrameNode;
    const itemsNow = () =>
      frameNow().children.flatMap((childId) => {
        const child = current()[childId];
        return child && flows(child) ? [{ child, box: boxInParent(child) }] : [];
      });
    const hugs = (axis: Axis) => (axis === "x" ? layout.widthSizing === "hug" && !stretchX : layout.heightSizing === "hug" && !stretchY);
    const padding = (axis: Axis) => (axis === "x" ? layout.paddingLeft + layout.paddingRight : layout.paddingTop + layout.paddingBottom);
    const setFrameSize = (axis: Axis, size: number) => {
      const frame = frameNow();
      if (Math.abs(size - sizeAlong(frame, axis)) <= eps) return;
      const width = axis === "x" ? size : frame.width;
      const height = axis === "y" ? size : frame.height;
      mutable()[id] = { ...frame, ...keepTopLeft(frame, width, height), width, height };
    };

    before.children.forEach(settle);
    if (itemsNow().length === 0) return;

    for (const axis of AXES) {
      const items = itemsNow();
      const isMain = (axis === "x") === horizontal;
      const stretched = items.filter((item) => fills(item.child, axis));
      const rigid = items.filter((item) => !fills(item.child, axis));
      const sum = (list: typeof items) => list.reduce((total, item) => total + sizeAlong(item.box, axis), 0);
      const targets = new Map<NodeId, number>();
      if (isMain) {
        const gaps = layout.gap * (items.length - 1);
        if (hugs(axis)) setFrameSize(axis, withinLimits(frameNow(), axis, padding(axis) + sum(items) + gaps));
        // In a frame that hugs, there is no spare room to share out.
        else if (stretched.length > 0) {
          const share = (sizeAlong(frameNow(), axis) - padding(axis) - gaps - sum(rigid)) / stretched.length;
          for (const { child } of stretched) targets.set(child.id, withinLimits(child, axis, share));
        }
      } else if (!layout.wrap) {
        if (hugs(axis)) {
          const tallest = Math.max(...(rigid.length > 0 ? rigid : items).map((item) => sizeAlong(item.box, axis)));
          setFrameSize(axis, withinLimits(frameNow(), axis, padding(axis) + tallest));
        }
        const room = sizeAlong(frameNow(), axis) - padding(axis);
        for (const { child } of stretched) targets.set(child.id, withinLimits(child, axis, room));
      }
      for (const [childId, size] of targets) {
        const child = current()[childId]!;
        if (Math.abs(size - sizeAlong(child, axis)) <= eps) continue;
        resizeIn(page, mutable(), childId, axis === "x" ? size : child.width, axis === "y" ? size : child.height, 0, 0);
        settle(childId);
      }
    }

    const items = itemsNow();
    const main = (r: { width: number; height: number }) => (horizontal ? r.width : r.height);
    const cross = (r: { width: number; height: number }) => (horizontal ? r.height : r.width);
    const mainAxis: Axis = horizontal ? "x" : "y";
    const crossAxis: Axis = horizontal ? "y" : "x";
    const mainStart = horizontal ? layout.paddingLeft : layout.paddingTop;
    const crossStart = horizontal ? layout.paddingTop : layout.paddingLeft;
    const room = main(frameNow()) - padding(mainAxis);

    // Rows (or columns): one, unless the frame wraps and has a length to wrap at.
    const lines: (typeof items)[] = [[]];
    let used = 0;
    for (const item of items) {
      const line = lines[lines.length - 1]!;
      const next = used + (line.length > 0 ? layout.gap : 0) + main(item.box);
      if (layout.wrap && !hugs(mainAxis) && line.length > 0 && next > room + eps) {
        lines.push([item]);
        used = main(item.box);
      } else {
        line.push(item);
        used = next;
      }
    }
    const depths = lines.map((line) => Math.max(...line.map((item) => cross(item.box))));
    if (layout.wrap && hugs(crossAxis)) {
      const stacked = depths.reduce((total, depth) => total + depth, 0) + layout.gap * (lines.length - 1);
      setFrameSize(crossAxis, withinLimits(frameNow(), crossAxis, padding(crossAxis) + stacked));
    }

    const lean = layout.counterAlign === "center" ? 0.5 : layout.counterAlign === "end" ? 1 : 0;
    let across = crossStart;
    lines.forEach((line, lineIndex) => {
      // A single row aligns across the whole frame; wrapped rows align within their own height.
      const depth = layout.wrap ? depths[lineIndex]! : cross(frameNow()) - padding(crossAxis);
      const content = line.reduce((total, item) => total + main(item.box), 0);
      const gaps = line.length - 1;
      let gap = layout.gap;
      let cursor = mainStart;
      if (!hugs(mainAxis)) {
        const free = room - content;
        if (layout.primaryAlign === "space-between" && gaps > 0) gap = free / gaps;
        else if (layout.primaryAlign === "center") cursor += (free - gap * gaps) / 2;
        else if (layout.primaryAlign === "end") cursor += free - gap * gaps;
      }
      for (const { child, box } of line) {
        const offset = across + (depth - cross(box)) * lean;
        const dx = (horizontal ? cursor : offset) - box.x;
        const dy = (horizontal ? offset : cursor) - box.y;
        if (Math.abs(dx) > eps || Math.abs(dy) > eps) mutable()[child.id] = { ...current()[child.id]!, x: child.x + dx, y: child.y + dy };
        cursor += main(box) + gap;
      }
      across += depth + layout.gap;
    });
  };

  page.children.forEach((id) => visit(id, false, false, false));
  return nodes ? { ...page, nodes } : page;
}

/**
 * The containers that may need settling again: every layer that differs from
 * the page as it was last settled, and everything above those. Null means all
 * of them (there is nothing to compare with).
 */
function unsettled(page: Page, settled: Page | null): Set<NodeId> | null {
  if (!settled) return null;
  if (settled.nodes === page.nodes) return new Set();
  const dirty = new Set<NodeId>();
  const before = settled.nodes;
  const nodes = page.nodes;
  for (const id in nodes) {
    let node = nodes[id];
    if (node === before[id]) continue;
    // Up the tree, until a layer that is already marked.
    while (node && !dirty.has(node.id)) {
      dirty.add(node.id);
      node = node.parentId ? nodes[node.parentId] : undefined;
    }
  }
  return dirty;
}

/** The page as `refitGroups` last returned it. A page is mostly the same from one edit to the next, so only what differs is looked at. */
let lastSettled: Page | null = null;

/**
 * Settles what follows from an edit: auto layout frames place their children
 * and groups hug theirs. Returns the input page when nothing needs to change.
 */
export function refitGroups(page: Page): Page {
  if (page === lastSettled) return page;
  let dirty = unsettled(page, lastSettled);
  let next = fitGroupBoxes(page, dirty);
  // A frame that grows can move a group's edge and the other way round, so repeat until both agree.
  for (let pass = 0; pass < 4; pass++) {
    if (next !== page) dirty = unsettled(next, lastSettled);
    const laid = applyAutoLayout(next, dirty);
    if (laid === next) break;
    next = fitGroupBoxes(laid, unsettled(laid, lastSettled));
  }
  lastSettled = next;
  return next;
}

/**
 * Keeps every group's box tight around its children and removes groups that
 * have become empty. Returns the input page when nothing needs to change.
 */
function fitGroupBoxes(page: Page, dirty: ReadonlySet<NodeId> | null): Page {
  let nodes: Nodes | null = null;
  let rootChildren: NodeId[] | null = null;
  const current = () => nodes ?? page.nodes;
  const mutable = () => (nodes ??= { ...page.nodes });

  const removeFromParent = (id: NodeId, parentId: NodeId | null) => {
    if (parentId === null) {
      rootChildren = (rootChildren ?? page.children).filter((c) => c !== id);
      return;
    }
    const parent = current()[parentId];
    if (parent && isContainer(parent)) {
      mutable()[parentId] = { ...parent, children: parent.children.filter((c) => c !== id) };
    }
  };

  const visit = (id: NodeId) => {
    // Nothing changed in or under it since it was last fitted.
    if (dirty && !dirty.has(id)) return;
    const before = current()[id];
    if (!before || !isContainer(before)) return;
    before.children.forEach(visit);
    const node = current()[id];
    if (!node || node.type !== "group") return;

    if (node.children.length === 0) {
      removeFromParent(id, node.parentId);
      delete mutable()[id];
      return;
    }
    const corners = node.children.flatMap((childId) => {
      const child = current()[childId];
      return child ? cornersOf(localMatrix(child), child.width, child.height) : [];
    });
    const box = boundsOfPoints(corners);
    const eps = 1e-6;
    if (
      Math.abs(box.x) < eps &&
      Math.abs(box.y) < eps &&
      Math.abs(box.width - node.width) < eps &&
      Math.abs(box.height - node.height) < eps
    ) {
      return;
    }
    const draft = mutable();
    for (const childId of node.children) {
      const child = draft[childId];
      if (child) draft[childId] = { ...child, x: child.x - box.x, y: child.y - box.y };
    }
    // Move the group's origin so its children keep their place in the parent.
    const oldCentre = { x: node.width / 2, y: node.height / 2 };
    const newCentre = { x: box.width / 2, y: box.height / 2 };
    const shift = rotatePoint(
      { x: box.x + newCentre.x - oldCentre.x, y: box.y + newCentre.y - oldCentre.y },
      node.rotation,
    );
    draft[id] = {
      ...node,
      x: node.x + oldCentre.x - newCentre.x + shift.x,
      y: node.y + oldCentre.y - newCentre.y + shift.y,
      width: box.width,
      height: box.height,
    };
  };

  page.children.forEach(visit);
  if (!nodes && !rootChildren) return page;
  return { ...page, nodes: nodes ?? page.nodes, children: rootChildren ?? page.children };
}

// ---------------------------------------------------------------------------
// Creating, removing and editing nodes
// ---------------------------------------------------------------------------

/** Inserts a node whose x/y are already expressed in the target parent's space. */
export function insertNode(page: Page, node: SceneNode, parentId: NodeId | null = null, index?: number): Page {
  const named = { ...node, parentId: null };
  return refitGroups(attach({ ...page, nodes: { ...page.nodes, [node.id]: normalize(named) } }, node.id, parentId, index));
}

/** Inserts a node whose box is expressed in page space, converting into the parent's space. */
export function insertNodeAtWorld(page: Page, node: SceneNode, parentId: NodeId | null = null): Page {
  const world = localMatrix(node);
  const withNode = attach({ ...page, nodes: { ...page.nodes, [node.id]: { ...node, parentId: null } } }, node.id, null);
  return placeNode(withNode, node.id, world, parentId);
}

export function removeNodes(page: Page, ids: readonly NodeId[]): Page {
  let next = page;
  for (const id of topLevelSelection(page, ids)) {
    const doomed = subtreeIds(next, id);
    next = detach(next, id);
    const nodes = { ...next.nodes };
    for (const d of doomed) delete nodes[d];
    next = { ...next, nodes };
  }
  return refitGroups(next);
}

export function patchNodes(page: Page, ids: readonly NodeId[], patch: NodePatch | ((node: SceneNode) => NodePatch)): Page {
  const nodes = { ...page.nodes };
  let changed = false;
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const values = typeof patch === "function" ? patch(node) : patch;
    const applicable: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(values)) {
      // Only properties the node type actually has are applied.
      if (value !== undefined && key in node && (node as unknown as Record<string, unknown>)[key] !== value) {
        applicable[key] = value;
      }
    }
    if (Object.keys(applicable).length === 0) continue;
    nodes[id] = normalize({ ...node, ...applicable } as SceneNode);
    changed = true;
  }
  return changed ? refitGroups({ ...page, nodes }) : page;
}

/**
 * Moves a node so that its local space maps to `world` in page space,
 * optionally re-parenting it. Children come along unchanged.
 */
export function placeNode(page: Page, id: NodeId, world: Matrix, parentId?: NodeId | null, index?: number): Page {
  const node = page.nodes[id];
  if (!node) return page;
  const targetParent = parentId === undefined ? node.parentId : parentId;
  if (targetParent !== null && (targetParent === id || isDescendantOf(page, targetParent, id))) return page;
  let next = page;
  if (targetParent !== node.parentId || index !== undefined) {
    next = attach(detach(next, id), id, targetParent, index);
  }
  const local = multiply(invert(parentWorldMatrix(next, targetParent)), world);
  const placed = { ...next.nodes[id]!, ...decompose(local, node.width, node.height) };
  return refitGroups({ ...next, nodes: { ...next.nodes, [id]: placed } });
}

export function translateNodes(page: Page, ids: readonly NodeId[], dx: number, dy: number): Page {
  let next = page;
  for (const id of topLevelSelection(page, ids)) {
    next = placeNode(next, id, multiply(translation(dx, dy), worldMatrix(next, id)));
  }
  return next;
}

function scaleContents(nodes: Nodes, id: NodeId, sx: number, sy: number): void {
  const node = nodes[id];
  if (!node) return;
  if (node.type === "vector") {
    nodes[id] = {
      ...node,
      points: node.points.map((p) => ({
        x: p.x * sx,
        y: p.y * sy,
        ...(p.inX !== undefined && p.inY !== undefined ? { inX: p.inX * sx, inY: p.inY * sy } : {}),
        ...(p.outX !== undefined && p.outY !== undefined ? { outX: p.outX * sx, outY: p.outY * sy } : {}),
      })),
    };
  } else if (node.type === "group") {
    // Groups have no geometry of their own, so resizing one scales its children.
    for (const childId of node.children) {
      const child = nodes[childId];
      if (!child) continue;
      const width = child.width * sx;
      const height = child.height * sy;
      nodes[childId] = {
        ...child,
        x: (child.x + child.width / 2) * sx - width / 2,
        y: (child.y + child.height / 2) * sy - height / 2,
        width,
        height,
      };
      scaleContents(nodes, childId, sx, sy);
    }
  }
}

/** The work of `resizeNode` on a draft node map, without settling layouts. Returns false when the size is unchanged. */
function resizeIn(page: Page, nodes: Nodes, id: NodeId, width: number, height: number, anchorX: number, anchorY: number): boolean {
  const node = nodes[id];
  if (!node) return false;
  const newWidth = Math.max(1, width);
  const newHeight = node.type === "line" ? 0 : Math.max(1, height);
  if (newWidth === node.width && newHeight === node.height) return false;

  const fixed = applyToPoint(localMatrix(node), { x: anchorX * node.width, y: anchorY * node.height });
  const centre = { x: newWidth / 2, y: newHeight / 2 };
  const offset = rotatePoint({ x: anchorX * newWidth - centre.x, y: anchorY * newHeight - centre.y }, node.rotation);
  let resized: SceneNode = {
    ...node,
    x: fixed.x - offset.x - centre.x,
    y: fixed.y - offset.y - centre.y,
    width: newWidth,
    height: newHeight,
  };
  if (resized.type === "text") {
    // Dragging the height pins both dimensions; otherwise the height keeps hugging the text.
    const autoResize = newHeight !== node.height && newWidth === node.width ? "fixed" : resized.autoResize === "fixed" ? "fixed" : "height";
    resized = fitTextNode({ ...resized, autoResize });
  }
  nodes[id] = resized;
  scaleContents(nodes, id, node.width ? newWidth / node.width : 1, node.height ? newHeight / node.height : 1);
  for (const sub of subtreeIds({ ...page, nodes }, id)) {
    const n = nodes[sub];
    if (n && sub !== id) nodes[sub] = normalize(n);
  }
  return true;
}

/**
 * Resizes a node, keeping the point at the given fraction of its box
 * (0,0 = top-left, 1,1 = bottom-right) fixed in the parent's space.
 */
export function resizeNode(page: Page, id: NodeId, width: number, height: number, anchorX = 0, anchorY = 0): Page {
  const node = page.nodes[id];
  const nodes = { ...page.nodes };
  if (!node || !resizeIn(page, nodes, id, width, height, anchorX, anchorY)) return page;
  // A side that is given a size by hand stops hugging its content or filling its parent.
  const widthSet = Math.max(1, width) !== node.width;
  const heightSet = node.type !== "line" && Math.max(1, height) !== node.height;
  let resized = nodes[id]!;
  if (resized.type === "frame" && resized.layout) {
    const layout = { ...resized.layout, ...(widthSet ? { widthSizing: "fixed" as const } : {}), ...(heightSet ? { heightSizing: "fixed" as const } : {}) };
    resized = { ...resized, layout };
  }
  if ((widthSet && resized.layoutItem?.fillWidth) || (heightSet && resized.layoutItem?.fillHeight)) {
    const layoutItem = { ...resized.layoutItem };
    if (widthSet) delete layoutItem.fillWidth;
    if (heightSet) delete layoutItem.fillHeight;
    resized = { ...resized, layoutItem };
  }
  nodes[id] = resized;
  return refitGroups({ ...page, nodes });
}

/** Scales everything a node is drawn with: its box, strokes, corners, effects, type and path. */
function scaleAppearance(node: SceneNode, factor: number): SceneNode {
  const by = (value: number) => round(value * factor);
  const limits = node.layoutItem && { ...node.layoutItem };
  if (limits) {
    for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
      if (limits[key] !== undefined) limits[key] = by(limits[key]);
    }
  }
  const scaled = {
    ...node,
    ...(limits ? { layoutItem: limits } : {}),
    width: by(node.width),
    height: by(node.height),
    strokeWidth: by(node.strokeWidth),
    effects: node.effects.map((e) =>
      e.type === "layer-blur" ? { ...e, blur: by(e.blur) } : { ...e, offsetX: by(e.offsetX), offsetY: by(e.offsetY), blur: by(e.blur), spread: by(e.spread) },
    ),
  } as SceneNode;
  if (scaled.type === "frame" || scaled.type === "rectangle") {
    const cornerRadii = scaled.cornerRadii.map(by) as unknown as typeof scaled.cornerRadii;
    if (scaled.type === "frame" && scaled.layout) {
      const { gap, paddingTop, paddingRight, paddingBottom, paddingLeft } = scaled.layout;
      const layout = { ...scaled.layout, gap: by(gap), paddingTop: by(paddingTop), paddingRight: by(paddingRight), paddingBottom: by(paddingBottom), paddingLeft: by(paddingLeft) };
      return { ...scaled, cornerRadii, layout };
    }
    return { ...scaled, cornerRadii };
  }
  if (scaled.type === "text") {
    return { ...scaled, fontSize: Math.max(0.01, by(scaled.fontSize)), letterSpacing: by(scaled.letterSpacing) };
  }
  if (scaled.type === "vector") {
    return {
      ...scaled,
      points: scaled.points.map((p) => ({
        x: by(p.x),
        y: by(p.y),
        ...(p.inX !== undefined && p.inY !== undefined ? { inX: by(p.inX), inY: by(p.inY) } : {}),
        ...(p.outX !== undefined && p.outY !== undefined ? { outX: by(p.outX), outY: by(p.outY) } : {}),
      })),
    };
  }
  return scaled;
}

/**
 * Scales a node and everything inside it by one factor, like enlarging a
 * picture of it: stroke widths, corner radii, effects and font sizes grow
 * along with the boxes. The point at the given fraction of its box stays fixed.
 */
export function scaleNode(page: Page, id: NodeId, factor: number, anchorX = 0, anchorY = 0): Page {
  const node = page.nodes[id];
  if (!node || !Number.isFinite(factor) || factor <= 0 || factor === 1) return page;

  const nodes = { ...page.nodes };
  for (const sub of subtreeIds(page, id)) {
    const n = nodes[sub];
    if (!n) continue;
    const scaled = scaleAppearance(n, factor);
    // A child's place in its parent scales with the parent; the root's is settled below.
    nodes[sub] = normalize(sub === id ? scaled : { ...scaled, x: round(n.x * factor), y: round(n.y * factor) });
  }

  // Text re-fits its own box, so the anchor is placed using the size it ended up with.
  const root = nodes[id]!;
  const fixed = applyToPoint(localMatrix(node), { x: anchorX * node.width, y: anchorY * node.height });
  const centre = { x: root.width / 2, y: root.height / 2 };
  const offset = rotatePoint({ x: anchorX * root.width - centre.x, y: anchorY * root.height - centre.y }, node.rotation);
  nodes[id] = { ...root, x: round(fixed.x - offset.x - centre.x), y: round(fixed.y - offset.y - centre.y) };
  return refitGroups({ ...page, nodes });
}

// ---------------------------------------------------------------------------
// Structure
// ---------------------------------------------------------------------------

function cloneSubtree(source: Nodes, rootId: NodeId): { rootId: NodeId; nodes: SceneNode[] } {
  const out: SceneNode[] = [];
  const copy = (id: NodeId, parentId: NodeId | null): NodeId | null => {
    const node = source[id];
    if (!node) return null;
    const newId = createId("n");
    if (isContainer(node)) {
      const placeholder = { ...node, id: newId, parentId, children: [] as NodeId[] };
      out.push(placeholder);
      placeholder.children = node.children.map((c) => copy(c, newId)).filter((c): c is NodeId => c !== null);
    } else {
      out.push({ ...node, id: newId, parentId });
    }
    return newId;
  };
  const newRoot = copy(rootId, null);
  return { rootId: newRoot ?? rootId, nodes: out };
}

/** Duplicates each selected subtree in place, directly above its original. */
export function duplicateNodes(page: Page, ids: readonly NodeId[]): { page: Page; ids: NodeId[] } {
  let next = page;
  const created: NodeId[] = [];
  for (const id of topLevelSelection(page, ids)) {
    const original = next.nodes[id];
    if (!original) continue;
    const clone = cloneSubtree(next.nodes, id);
    const nodes = { ...next.nodes };
    for (const n of clone.nodes) nodes[n.id] = n;
    const index = childrenOf(next, original.parentId).indexOf(id) + 1;
    next = attach({ ...next, nodes }, clone.rootId, original.parentId, index);
    created.push(clone.rootId);
  }
  return { page: refitGroups(next), ids: created };
}

export interface ClipboardPayload {
  kind: "drafiqo/nodes";
  roots: { rootId: NodeId; world: Matrix; parentId: NodeId | null; nodes: SceneNode[] }[];
}

export function copyNodes(page: Page, ids: readonly NodeId[]): ClipboardPayload {
  return {
    kind: "drafiqo/nodes",
    roots: topLevelSelection(page, ids).map((id) => ({
      rootId: id,
      world: worldMatrix(page, id),
      parentId: page.nodes[id]?.parentId ?? null,
      nodes: subtreeIds(page, id).map((n) => page.nodes[n]!),
    })),
  };
}

/** Pastes at the copied page position, into the original parent when it still exists here. */
export function pasteNodes(page: Page, payload: ClipboardPayload): { page: Page; ids: NodeId[] } {
  let next = page;
  const created: NodeId[] = [];
  for (const root of payload.roots) {
    const source: Nodes = Object.fromEntries(root.nodes.map((n) => [n.id, n]));
    const clone = cloneSubtree(source, root.rootId);
    const nodes = { ...next.nodes };
    for (const n of clone.nodes) nodes[n.id] = n;
    const parent = root.parentId ? next.nodes[root.parentId] : undefined;
    const parentId = parent && isContainer(parent) ? parent.id : null;
    next = attach({ ...next, nodes }, clone.rootId, null);
    next = placeNode(next, clone.rootId, root.world, parentId);
    created.push(clone.rootId);
  }
  return { page: next, ids: created };
}

export function groupNodes(page: Page, ids: readonly NodeId[]): { page: Page; groupId: NodeId | null } {
  const members = topLevelSelection(page, ids);
  const front = members[members.length - 1];
  if (!front) return { page, groupId: null };
  const parentId = page.nodes[front]!.parentId;
  const group = { ...createGroup({ x: 0, y: 0, width: 0, height: 0 }), name: nextName(page, "Group") };
  const index = childrenOf(page, parentId).indexOf(front) + 1;
  let next = attach({ ...page, nodes: { ...page.nodes, [group.id]: group } }, group.id, parentId, index);
  for (const id of members) {
    // refitGroups would delete the still-empty group, so attach without it.
    const world = worldMatrix(next, id);
    next = attach(detach(next, id), id, group.id);
    const local = multiply(invert(parentWorldMatrix(next, group.id)), world);
    const node = next.nodes[id]!;
    next = { ...next, nodes: { ...next.nodes, [id]: { ...node, ...decompose(local, node.width, node.height) } } };
  }
  return { page: refitGroups(next), groupId: group.id };
}

/** Dissolves containers, leaving their children in place in the container's parent. */
export function ungroupNodes(page: Page, ids: readonly NodeId[]): { page: Page; ids: NodeId[] } {
  let next = page;
  const released: NodeId[] = [];
  for (const id of topLevelSelection(page, ids)) {
    const container = next.nodes[id];
    if (!container || !isContainer(container)) continue;
    let index = childrenOf(next, container.parentId).indexOf(id);
    for (const childId of container.children) {
      const world = worldMatrix(next, childId);
      next = attach(detach(next, childId), childId, container.parentId, index++);
      const local = multiply(invert(parentWorldMatrix(next, container.parentId)), world);
      const child = next.nodes[childId]!;
      next = { ...next, nodes: { ...next.nodes, [childId]: { ...child, ...decompose(local, child.width, child.height) } } };
      released.push(childId);
    }
    next = detach(next, id);
    const nodes = { ...next.nodes };
    delete nodes[id];
    next = { ...next, nodes };
  }
  return { page: refitGroups(next), ids: released };
}

export type ReorderMode = "forward" | "backward" | "front" | "back";

export function reorderNodes(page: Page, ids: readonly NodeId[], mode: ReorderMode): Page {
  const byParent = new Map<NodeId | null, NodeId[]>();
  for (const id of topLevelSelection(page, ids)) {
    const parentId = page.nodes[id]!.parentId;
    byParent.set(parentId, [...(byParent.get(parentId) ?? []), id]);
  }
  let next = page;
  for (const [parentId, members] of byParent) {
    const order = [...childrenOf(next, parentId)];
    const selected = new Set(members);
    let result: NodeId[];
    if (mode === "front") result = [...order.filter((c) => !selected.has(c)), ...order.filter((c) => selected.has(c))];
    else if (mode === "back") result = [...order.filter((c) => selected.has(c)), ...order.filter((c) => !selected.has(c))];
    else {
      result = order;
      const forward = mode === "forward";
      // Walk from the leading edge so a block of selected layers moves together.
      for (let step = 0; step < order.length; step++) {
        const i = forward ? order.length - 1 - step : step;
        const j = forward ? i + 1 : i - 1;
        const a = result[i];
        const b = result[j];
        if (a !== undefined && b !== undefined && selected.has(a) && !selected.has(b)) {
          result[i] = b;
          result[j] = a;
        }
      }
    }
    if (result.some((c, i) => c !== childrenOf(next, parentId)[i])) {
      next = withChildren(next, { ...next.nodes }, parentId, result);
    }
  }
  return next;
}

/**
 * Moves nodes to a new place in the layer tree, keeping their position on the
 * canvas. They are inserted directly below `beforeId`, or on top when null.
 */
export function moveNodesInTree(page: Page, ids: readonly NodeId[], parentId: NodeId | null, beforeId: NodeId | null): Page {
  const members = topLevelSelection(page, ids).filter(
    (id) => id !== parentId && (parentId === null || !isDescendantOf(page, parentId, id)),
  );
  if (parentId !== null && !isContainerId(page, parentId)) return page;
  let next = page;
  for (const id of members) {
    if (id === beforeId) continue;
    const world = worldMatrix(next, id);
    next = detach(next, id);
    const siblings = childrenOf(next, parentId);
    const index = beforeId !== null && siblings.includes(beforeId) ? siblings.indexOf(beforeId) : siblings.length;
    next = attach(next, id, parentId, index);
    const local = multiply(invert(parentWorldMatrix(next, parentId)), world);
    const node = next.nodes[id]!;
    next = { ...next, nodes: { ...next.nodes, [id]: { ...node, ...decompose(local, node.width, node.height) } } };
  }
  return refitGroups(next);
}

function isContainerId(page: Page, id: NodeId): boolean {
  const node = page.nodes[id];
  return !!node && isContainer(node);
}

// ---------------------------------------------------------------------------
// Auto layout
// ---------------------------------------------------------------------------

/** Reads a row or a column out of how layers are arranged now: the direction, their order and the gap between them. */
function inferLayout(items: { id: NodeId; box: Rect }[]): { mode: AutoLayout["mode"]; gap: number; order: NodeId[] } {
  const centres = items.map(({ box }) => ({ x: box.x + box.width / 2, y: box.y + box.height / 2 }));
  const spread = (values: number[]) => Math.max(...values) - Math.min(...values);
  const horizontal = items.length < 2 || spread(centres.map((c) => c.x)) >= spread(centres.map((c) => c.y));
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  const sorted = [...items].sort((a, b) => start(a.box) - start(b.box));
  let gap = 10;
  if (sorted.length > 1) {
    const first = sorted[0]!.box;
    const last = sorted[sorted.length - 1]!.box;
    const content = sorted.reduce((sum, item) => sum + size(item.box), 0);
    gap = Math.max(0, Math.round((start(last) + size(last) - start(first) - content) / (sorted.length - 1)));
  }
  return { mode: horizontal ? "horizontal" : "vertical", gap, order: sorted.map((item) => item.id) };
}

/**
 * Turns the selection into an auto layout frame. A single plain frame gets the
 * layout itself, keeping its size; anything else is wrapped in a new frame
 * that hugs it. The layers keep the arrangement they visibly had.
 */
export function addAutoLayout(page: Page, ids: readonly NodeId[]): { page: Page; frameId: NodeId | null } {
  const members = topLevelSelection(page, ids);
  const only = members.length === 1 ? page.nodes[members[0]!] : undefined;

  if (only?.type === "frame") {
    if (only.layout) return { page, frameId: only.id };
    const items = only.children.flatMap((id) => {
      const child = page.nodes[id];
      return child ? [{ id, box: boxInParent(child) }] : [];
    });
    const { mode, gap, order } = inferLayout(items);
    // The padding is the room the frame already leaves around its layers.
    const inset = (values: number[]) => (values.length > 0 ? Math.max(0, Math.round(Math.min(...values))) : 0);
    const boxes = items.filter((item) => page.nodes[item.id]!.visible).map((item) => item.box);
    const layout: AutoLayout = {
      mode,
      gap,
      paddingTop: inset(boxes.map((b) => b.y)),
      paddingRight: inset(boxes.map((b) => only.width - b.x - b.width)),
      paddingBottom: inset(boxes.map((b) => only.height - b.y - b.height)),
      paddingLeft: inset(boxes.map((b) => b.x)),
      primaryAlign: "start",
      counterAlign: "start",
      widthSizing: "fixed",
      heightSizing: "fixed",
      wrap: false,
    };
    const frame = { ...only, children: order, layout };
    return { page: refitGroups({ ...page, nodes: { ...page.nodes, [only.id]: frame } }), frameId: only.id };
  }

  const front = members[members.length - 1];
  if (!front) return { page, frameId: null };
  const worlds = members.map((id) => ({ id, box: worldBounds(page, id) }));
  const { mode, gap, order } = inferLayout(worlds);
  const bounds = boundsOfPoints(worlds.flatMap(({ box }) => [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y + box.height }]));
  const parentId = page.nodes[front]!.parentId;
  const index = childrenOf(page, parentId).indexOf(front) + 1;
  const frame = { ...createFrame(bounds), name: nextName(page, DEFAULT_NAMES.frame), fills: [], clipContent: false };
  let next = attach({ ...page, nodes: { ...page.nodes, [frame.id]: frame } }, frame.id, null);
  next = placeNode(next, frame.id, localMatrix(frame), parentId, index);
  for (const id of order) {
    const world = worldMatrix(next, id);
    next = attach(detach(next, id), id, frame.id);
    const local = multiply(invert(parentWorldMatrix(next, frame.id)), world);
    const node = next.nodes[id]!;
    next = { ...next, nodes: { ...next.nodes, [id]: { ...node, ...decompose(local, node.width, node.height) } } };
  }
  const layout: AutoLayout = {
    mode,
    gap,
    paddingTop: 0,
    paddingRight: 0,
    paddingBottom: 0,
    paddingLeft: 0,
    primaryAlign: "start",
    counterAlign: "center",
    widthSizing: "hug",
    heightSizing: "hug",
    wrap: false,
  };
  const placed = next.nodes[frame.id] as FrameNode;
  next = { ...next, nodes: { ...next.nodes, [frame.id]: { ...placed, layout } } };
  return { page: refitGroups(next), frameId: frame.id };
}

/** Changes the layout of auto layout frames, or with `null` hands their children back to free placement. */
export function setAutoLayout(page: Page, ids: readonly NodeId[], patch: Partial<AutoLayout> | null): Page {
  const nodes = { ...page.nodes };
  let changed = false;
  for (const id of ids) {
    const node = nodes[id];
    if (!node || node.type !== "frame" || !node.layout) continue;
    if (patch === null) {
      const { layout: _removed, ...plain } = node;
      nodes[id] = plain;
    } else {
      const layout = { ...node.layout, ...patch };
      if ((Object.keys(layout) as (keyof AutoLayout)[]).every((key) => layout[key] === node.layout![key])) continue;
      nodes[id] = { ...node, layout };
    }
    changed = true;
  }
  return changed ? refitGroups({ ...page, nodes }) : page;
}

/**
 * Where a layer dropped at a page-space point lands among an auto layout
 * frame's children: the sibling it goes in front of, or null for the end.
 * Undefined when the parent does not lay its children out.
 */
export function layoutSlotAt(page: Page, parentId: NodeId | null, point: Point, exclude: ReadonlySet<NodeId>): NodeId | null | undefined {
  const parent = parentId ? page.nodes[parentId] : undefined;
  if (!parent || parent.type !== "frame" || !parent.layout) return undefined;
  const local = applyToPoint(invert(worldMatrix(page, parent.id)), point);
  const horizontal = parent.layout.mode === "horizontal";
  const along = horizontal ? local.x : local.y;
  const across = horizontal ? local.y : local.x;
  for (const id of parent.children) {
    const child = page.nodes[id];
    if (!child || exclude.has(id) || !flows(child)) continue;
    const box = boxInParent(child);
    const centre = horizontal ? box.x + box.width / 2 : box.y + box.height / 2;
    if (parent.layout.wrap) {
      // Rows come one after another: the slot is in the first row the point has not passed.
      const top = horizontal ? box.y : box.x;
      const bottom = top + (horizontal ? box.height : box.width);
      if (across < top || (across <= bottom && along < centre)) return id;
    } else if (along < centre) return id;
  }
  return null;
}

/**
 * Sets how layers behave in their auto layout parent (fill, absolute) and the
 * limits on their size. A key given as undefined is cleared.
 */
export function setLayoutItem(page: Page, ids: readonly NodeId[], patch: LayoutItem): Page {
  const nodes = { ...page.nodes };
  let changed = false;
  for (const id of ids) {
    const node = nodes[id];
    if (!node) continue;
    const item: LayoutItem = { ...node.layoutItem };
    for (const key of Object.keys(patch) as (keyof LayoutItem)[]) {
      const value = patch[key];
      if (value === undefined || value === false) delete item[key];
      else (item as Record<string, unknown>)[key] = value;
    }
    const keys = Object.keys(item) as (keyof LayoutItem)[];
    const was = node.layoutItem ?? {};
    if (keys.length === Object.keys(was).length && keys.every((key) => item[key] === was[key])) continue;
    const { layoutItem: _old, ...bare } = node;
    nodes[id] = (keys.length > 0 ? { ...bare, layoutItem: item } : bare) as SceneNode;
    changed = true;

    // A frame cannot hug along its direction and hand out spare room there at once: it keeps its size.
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    if (parent?.type === "frame" && parent.layout) {
      const horizontal = parent.layout.mode === "horizontal";
      if (patch.fillWidth && horizontal && parent.layout.widthSizing === "hug") nodes[parent.id] = { ...parent, layout: { ...parent.layout, widthSizing: "fixed" } };
      if (patch.fillHeight && !horizontal && parent.layout.heightSizing === "hug") nodes[parent.id] = { ...parent, layout: { ...parent.layout, heightSizing: "fixed" } };
    }
  }
  return changed ? refitGroups({ ...page, nodes }) : page;
}

// ---------------------------------------------------------------------------
// Alignment
// ---------------------------------------------------------------------------

export type AlignMode = "left" | "center" | "right" | "top" | "middle" | "bottom";

/** Aligns to the selection's bounds, or to the parent frame for a single node. */
export function alignNodes(page: Page, ids: readonly NodeId[], mode: AlignMode): Page {
  const members = topLevelSelection(page, ids);
  if (members.length === 0) return page;
  let target: Rect | null;
  if (members.length === 1) {
    const parentId = page.nodes[members[0]!]!.parentId;
    const parent = parentId ? page.nodes[parentId] : undefined;
    if (!parent || parent.type === "group") return page;
    target = worldBounds(page, parent.id);
  } else {
    target = boundsOfPoints(
      members.flatMap((id) => {
        const b = worldBounds(page, id);
        return [
          { x: b.x, y: b.y },
          { x: b.x + b.width, y: b.y + b.height },
        ];
      }),
    );
  }
  let next = page;
  for (const id of members) {
    const b = worldBounds(next, id);
    let dx = 0;
    let dy = 0;
    if (mode === "left") dx = target.x - b.x;
    else if (mode === "center") dx = target.x + target.width / 2 - (b.x + b.width / 2);
    else if (mode === "right") dx = target.x + target.width - (b.x + b.width);
    else if (mode === "top") dy = target.y - b.y;
    else if (mode === "middle") dy = target.y + target.height / 2 - (b.y + b.height / 2);
    else dy = target.y + target.height - (b.y + b.height);
    if (dx !== 0 || dy !== 0) next = translateNodes(next, [id], dx, dy);
  }
  return next;
}

/** Evens out the gaps between three or more nodes along one axis. */
export function distributeNodes(page: Page, ids: readonly NodeId[], axis: "horizontal" | "vertical"): Page {
  const horizontal = axis === "horizontal";
  const items = topLevelSelection(page, ids)
    .map((id) => ({ id, bounds: worldBounds(page, id) }))
    .sort((a, b) => (horizontal ? a.bounds.x - b.bounds.x : a.bounds.y - b.bounds.y));
  if (items.length < 3) return page;
  const start = (r: Rect) => (horizontal ? r.x : r.y);
  const size = (r: Rect) => (horizontal ? r.width : r.height);
  const first = items[0]!.bounds;
  const last = items[items.length - 1]!.bounds;
  const total = items.reduce((sum, item) => sum + size(item.bounds), 0);
  const gap = (start(last) + size(last) - start(first) - total) / (items.length - 1);
  let cursor = start(first);
  let next = page;
  for (const item of items) {
    const delta = cursor - start(item.bounds);
    if (Math.abs(delta) > 1e-9) next = translateNodes(next, [item.id], horizontal ? delta : 0, horizontal ? 0 : delta);
    cursor += size(item.bounds) + gap;
  }
  return next;
}

// ---------------------------------------------------------------------------
// Hit testing against containers (used to decide where new objects land)
// ---------------------------------------------------------------------------

/** The deepest, front-most frame or section under a page-space point. */
export function findContainerAt(page: Page, point: Point, exclude: ReadonlySet<NodeId> = new Set()): NodeId | null {
  const search = (children: readonly NodeId[]): NodeId | null => {
    for (let i = children.length - 1; i >= 0; i--) {
      const id = children[i]!;
      const node = page.nodes[id];
      if (!node || exclude.has(id) || !node.visible || node.locked) continue;
      if (node.type !== "frame" && node.type !== "section") continue;
      const local = applyToPoint(invert(worldMatrix(page, id)), point);
      if (local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height) {
        return search(node.children) ?? id;
      }
    }
    return null;
  };
  return search(page.children);
}

/** A spot for a new top-level frame: right of everything already on the page. */
export function freeSpotFor(page: Page, size: { width: number; height: number }, near: Point): Box {
  const bounds = page.children.map((id) => worldBounds(page, id));
  if (bounds.length === 0) {
    return { x: Math.round(near.x - size.width / 2), y: Math.round(near.y - size.height / 2), ...size };
  }
  const right = Math.max(...bounds.map((b) => b.x + b.width));
  const top = Math.min(...bounds.map((b) => b.y));
  return { x: Math.round(right + 100), y: Math.round(top), ...size };
}

// ---------------------------------------------------------------------------
// Document-level commands
// ---------------------------------------------------------------------------

export function updatePage(doc: DrafiqoDocument, pageId: PageId, fn: (page: Page) => Page): DrafiqoDocument {
  const index = doc.pages.findIndex((p) => p.id === pageId);
  const page = doc.pages[index];
  if (!page) return doc;
  const next = fn(page);
  if (next === page) return doc;
  const pages = [...doc.pages];
  pages[index] = next;
  return { ...doc, pages };
}

export function addPage(doc: DrafiqoDocument): { doc: DrafiqoDocument; pageId: PageId } {
  let n = doc.pages.length + 1;
  while (doc.pages.some((p) => p.name === `Page ${n}`)) n++;
  const page = createPage(`Page ${n}`);
  return { doc: { ...doc, pages: [...doc.pages, page] }, pageId: page.id };
}

/** A document always keeps at least one page. */
export function deletePage(doc: DrafiqoDocument, pageId: PageId): DrafiqoDocument {
  if (doc.pages.length <= 1 || !doc.pages.some((p) => p.id === pageId)) return doc;
  return { ...doc, pages: doc.pages.filter((p) => p.id !== pageId) };
}

export function movePage(doc: DrafiqoDocument, pageId: PageId, toIndex: number): DrafiqoDocument {
  const from = doc.pages.findIndex((p) => p.id === pageId);
  if (from < 0) return doc;
  const pages = [...doc.pages];
  const [page] = pages.splice(from, 1);
  const index = Math.max(0, Math.min(pages.length, toIndex));
  if (index === from) return doc;
  pages.splice(index, 0, page!);
  return { ...doc, pages };
}
