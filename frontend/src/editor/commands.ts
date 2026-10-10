// Pure editing commands. Each takes a page (or document) and returns a new
// one, sharing every untouched node with the input so history snapshots stay
// cheap and React can skip unchanged layers.

import { createGroup, createId, createPage, type Box } from "../document/factory";
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
  type BaseNode,
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
  Partial<Pick<FrameNode, "clipContent" | "cornerRadius">> &
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

/**
 * Keeps every group's box tight around its children and removes groups that
 * have become empty. Returns the input page when nothing needs to change.
 */
export function refitGroups(page: Page): Page {
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

/**
 * Resizes a node, keeping the point at the given fraction of its box
 * (0,0 = top-left, 1,1 = bottom-right) fixed in the parent's space.
 */
export function resizeNode(page: Page, id: NodeId, width: number, height: number, anchorX = 0, anchorY = 0): Page {
  const node = page.nodes[id];
  if (!node) return page;
  const newWidth = Math.max(1, width);
  const newHeight = node.type === "line" ? 0 : Math.max(1, height);
  if (newWidth === node.width && newHeight === node.height) return page;

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
  const nodes = { ...page.nodes, [id]: resized };
  scaleContents(nodes, id, node.width ? newWidth / node.width : 1, node.height ? newHeight / node.height : 1);
  for (const sub of subtreeIds({ ...page, nodes }, id)) {
    const n = nodes[sub];
    if (n && sub !== id) nodes[sub] = normalize(n);
  }
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
