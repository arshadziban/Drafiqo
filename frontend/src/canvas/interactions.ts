// Pointer handling for the canvas. Gestures read the page as it was when they
// started and recompute the result from that on every move, so nothing drifts
// and a whole drag collapses into a single history entry.

import type { PointerEvent as ReactPointerEvent, MouseEvent as ReactMouseEvent } from "react";
import {
  DEFAULT_NAMES,
  createEllipse,
  createFrame,
  createLine,
  createPolygon,
  createRectangle,
  createSection,
  createStar,
  createText,
  createVector,
} from "../document/factory";
import {
  applyToPoint,
  boundsOfPoints,
  cornersOf,
  invert,
  localMatrix,
  multiply,
  rectFromPoints,
  selectionBounds,
  translation,
  worldBounds,
  worldMatrix,
  type Matrix,
  type Point,
  type Rect,
} from "../document/geometry";
import { childrenOf, isEffectivelyLocked, isEffectivelyVisible, nextName, paintOrder, subtreeIds, topLevelSelection } from "../document/tree";
import type { NodeId, Page, PathPoint, SceneNode } from "../document/types";
import { duplicateNodes, findContainerAt, insertNodeAtWorld, layoutSlotAt, placeNode, removeNodes, resizeNode, scaleNode } from "../editor/commands";
import { currentPage, currentViewport, useEditor, type Tool } from "../editor/store";
import { nodesInMarquee, resolveClickTarget, resolveDrillTarget } from "./hitTest";
import { snapRect } from "./snapping";
import { useCanvasUi } from "./uiStore";

type Drag =
  | { kind: "pan"; startX: number; startY: number; x: number; y: number }
  | {
      kind: "move";
      start: Point;
      screen: Point;
      base: Page;
      ids: NodeId[];
      worlds: Map<NodeId, Matrix>;
      bounds: Rect;
      excluded: Set<NodeId>;
      targets: Rect[];
      moved: boolean;
      /** Clicking an already-selected node narrows the selection to it on release. */
      narrowTo: NodeId | null;
    }
  | { kind: "resize"; id: NodeId; base: Page; hx: number; hy: number }
  | { kind: "scale"; id: NodeId; base: Page; hx: number; hy: number }
  | { kind: "rotate"; id: NodeId; base: Page; centre: Point; startPointer: number; startWorld: Matrix }
  | { kind: "marquee"; start: Point; additive: NodeId[] }
  | { kind: "create"; tool: Tool; start: Point; screen: Point; base: Page; parentId: NodeId | null; node: SceneNode | null }
  | { kind: "pen" };

let drag: Drag | null = null;
let spaceHeld = false;
/** True while the text being edited was created by the current transaction. */
let editingNewText = false;

const editor = () => useEditor.getState();
const ui = useCanvasUi;

export function setSpaceHeld(held: boolean): void {
  spaceHeld = held;
}

export function isSpaceHeld(): boolean {
  return spaceHeld;
}

function screenPoint(e: { clientX: number; clientY: number; currentTarget: Element }): Point {
  const rect = e.currentTarget.getBoundingClientRect();
  return { x: e.clientX - rect.left, y: e.clientY - rect.top };
}

function toWorld(screen: Point): Point {
  const v = currentViewport(editor());
  return { x: (screen.x - v.x) / v.zoom, y: (screen.y - v.y) / v.zoom };
}

const roundPoint = (p: Point): Point => ({ x: Math.round(p.x), y: Math.round(p.y) });

function hitNode(target: EventTarget | null, page: Page): NodeId | null {
  const el = target instanceof Element ? target.closest("[data-node-id]") : null;
  const id = el?.getAttribute("data-node-id") ?? null;
  return id && page.nodes[id] && !isEffectivelyLocked(page, id) ? id : null;
}

// ---------------------------------------------------------------------------
// Text editing
// ---------------------------------------------------------------------------

export function startTextEdit(id: NodeId, isNew = false): void {
  const s = editor();
  s.begin();
  editingNewText = isNew;
  useEditor.setState({ editingTextId: id, selection: [id] });
}

export function finishTextEdit(): void {
  const s = editor();
  const id = s.editingTextId;
  if (!id) return;
  const node = currentPage(s).nodes[id];
  useEditor.setState({ editingTextId: null });
  if (node?.type === "text" && node.text.trim() === "") {
    // Empty text is never left behind on the canvas.
    if (editingNewText) s.cancel();
    else {
      s.transient((page) => removeNodes(page, [id]), []);
      s.commit();
    }
  } else {
    s.commit();
  }
  editingNewText = false;
}

// ---------------------------------------------------------------------------
// Pen tool
// ---------------------------------------------------------------------------

/** Turns the path being drawn into a vector node (needs at least two points). */
export function finishPen(closed = false, returnToSelect = true): void {
  const { penPoints } = ui.getState();
  ui.setState({ penPoints: [], penCursor: null });
  const s = editor();
  if (penPoints.length >= 2) {
    const page = currentPage(s);
    const first = penPoints[0]!;
    const vector = { ...createVector(penPoints, closed), name: nextName(page, DEFAULT_NAMES.vector) };
    s.edit((p) => insertNodeAtWorld(p, vector, findContainerAt(p, first)), [vector.id]);
  }
  if (returnToSelect) s.setTool("select");
}

function penPointerDown(world: Point, clickCount: number): void {
  const { penPoints } = ui.getState();
  const zoom = currentViewport(editor()).zoom;
  if (clickCount >= 2) return finishPen(false);
  const first = penPoints[0];
  if (first && penPoints.length >= 2 && Math.hypot(first.x - world.x, first.y - world.y) <= 8 / zoom) {
    return finishPen(true);
  }
  ui.setState({ penPoints: [...penPoints, roundPoint(world)] });
  drag = { kind: "pen" };
}

function penDrag(world: Point): void {
  const { penPoints } = ui.getState();
  const last = penPoints[penPoints.length - 1];
  if (!last) return;
  // Dragging pulls out a symmetric pair of Bézier handles.
  const next: PathPoint = { x: last.x, y: last.y, outX: world.x, outY: world.y, inX: 2 * last.x - world.x, inY: 2 * last.y - world.y };
  ui.setState({ penPoints: [...penPoints.slice(0, -1), next] });
}

// ---------------------------------------------------------------------------
// Creating shapes
// ---------------------------------------------------------------------------

function buildShape(tool: Tool, a: Point, b: Point, square: boolean): SceneNode | null {
  if (tool === "line") {
    let end = b;
    if (square) {
      const step = Math.PI / 4;
      const angle = Math.round(Math.atan2(b.y - a.y, b.x - a.x) / step) * step;
      const length = Math.hypot(b.x - a.x, b.y - a.y);
      end = { x: a.x + Math.cos(angle) * length, y: a.y + Math.sin(angle) * length };
    }
    return createLine(a, end);
  }
  let box = rectFromPoints(a, b);
  if (square) {
    const side = Math.max(box.width, box.height);
    box = { x: b.x < a.x ? a.x - side : a.x, y: b.y < a.y ? a.y - side : a.y, width: side, height: side };
  }
  box = { ...box, width: Math.max(1, box.width), height: Math.max(1, box.height) };
  switch (tool) {
    case "frame":
      return createFrame(box);
    case "section":
      return createSection(box);
    case "rectangle":
      return createRectangle(box);
    case "ellipse":
      return createEllipse(box);
    case "polygon":
      return createPolygon(box);
    case "star":
      return createStar(box);
    case "text":
      return createText(box, "", "height");
    default:
      return null;
  }
}

function containerFor(page: Page, tool: Tool, point: Point): NodeId | null {
  const container = findContainerAt(page, point);
  // Sections organise the page; they only nest inside other sections.
  if (tool === "section" && container && page.nodes[container]?.type !== "section") return null;
  return container;
}

function updateCreate(d: Extract<Drag, { kind: "create" }>, world: Point, square: boolean): void {
  const built = buildShape(d.tool, d.start, roundPoint(world), square);
  if (!built) return;
  const name = d.node?.name ?? nextName(d.base, DEFAULT_NAMES[built.type]);
  d.node = { ...built, id: d.node?.id ?? built.id, name } as SceneNode;
  const node = d.node;
  editor().begin();
  editor().transient(() => insertNodeAtWorld(d.base, node, d.parentId), [node.id]);
}

function finishCreate(d: Extract<Drag, { kind: "create" }>): void {
  const s = editor();
  if (d.tool === "text") {
    let node = d.node;
    if (!node) {
      // A plain click makes auto-sized text starting at the pointer.
      const text = createText({ x: d.start.x, y: d.start.y - 11, width: 1, height: 22 }, "", "auto");
      node = { ...text, name: nextName(d.base, DEFAULT_NAMES.text) };
      s.begin();
      const created = node;
      s.transient(() => insertNodeAtWorld(d.base, created, d.parentId), [created.id]);
    }
    s.setTool("select");
    startTextEdit(node.id, true);
    return;
  }
  if (!d.node) {
    const size = 100;
    updateCreate(d, { x: d.start.x + size, y: d.start.y + (d.tool === "line" ? 0 : size) }, false);
  }
  s.commit();
  s.setTool("select");
}

// ---------------------------------------------------------------------------
// Moving, resizing, rotating
// ---------------------------------------------------------------------------

function beginMove(e: ReactPointerEvent, world: Point, screen: Point, narrowTo: NodeId | null): void {
  const s = editor();
  let base = currentPage(s);
  let ids = topLevelSelection(base, s.selection).filter((id) => !isEffectivelyLocked(base, id));
  if (ids.length === 0) return;
  if (e.altKey) {
    // Alt-drag leaves the originals in place and moves copies.
    const copy = duplicateNodes(base, ids);
    base = copy.page;
    ids = copy.ids;
    narrowTo = null;
  }
  const excluded = new Set(ids.flatMap((id) => subtreeIds(base, id)));
  const bounds = selectionBounds(base, ids);
  if (!bounds) return;
  const targets = paintOrder(base)
    .filter((id) => !excluded.has(id) && isEffectivelyVisible(base, id))
    .slice(0, 400)
    .map((id) => worldBounds(base, id));
  drag = {
    kind: "move",
    start: world,
    screen,
    base,
    ids,
    worlds: new Map(ids.map((id) => [id, worldMatrix(base, id)])),
    bounds,
    excluded,
    targets,
    moved: false,
    narrowTo,
  };
}

function updateMove(d: Extract<Drag, { kind: "move" }>, e: ReactPointerEvent, world: Point, screen: Point): void {
  const s = editor();
  if (!d.moved) {
    if (Math.hypot(screen.x - d.screen.x, screen.y - d.screen.y) < 3) return;
    d.moved = true;
    s.begin();
  }
  let dx = world.x - d.start.x;
  let dy = world.y - d.start.y;
  if (e.shiftKey) {
    if (Math.abs(dx) > Math.abs(dy)) dy = 0;
    else dx = 0;
  }
  // Land on whole pixels unless a snap decides otherwise.
  dx = Math.round(d.bounds.x + dx) - d.bounds.x;
  dy = Math.round(d.bounds.y + dy) - d.bounds.y;
  if (s.snapEnabled && !e.ctrlKey) {
    const zoom = currentViewport(s).zoom;
    const snap = snapRect({ ...d.bounds, x: d.bounds.x + dx, y: d.bounds.y + dy }, d.targets, 5 / zoom);
    dx += snap.dx;
    dy += snap.dy;
    ui.setState({ guides: snap.guides });
  }

  const container = findContainerAt(d.base, world, d.excluded);
  let page = d.base;
  /** The first dragged layer that an auto layout frame has given a slot. */
  let slotted: NodeId | null = null;
  for (const id of d.ids) {
    const node = d.base.nodes[id]!;
    const parent = node.parentId ? d.base.nodes[node.parentId] : undefined;
    let target: NodeId | null | undefined = container;
    // Members of a group stay in it; sections only nest in sections.
    if (parent?.type === "group") target = undefined;
    else if (node.type === "section" && container && d.base.nodes[container]?.type !== "section") target = null;
    if (target === node.parentId) target = undefined;
    // In an auto layout frame the pointer picks a slot between the other layers.
    const parentId = target === undefined ? node.parentId : target;
    const before = node.layoutItem?.absolute ? undefined : layoutSlotAt(d.base, parentId, world, d.excluded);
    let index: number | undefined;
    if (before !== undefined) {
      slotted ??= id;
      const siblings = childrenOf(page, parentId).filter((c) => c !== id);
      index = before === null ? siblings.length : siblings.indexOf(before);
    }
    page = placeNode(page, id, multiply(translation(dx, dy), d.worlds.get(id)!), target, index);
  }
  const result = page;
  s.transient(() => result, d.ids);
  // A slotted layer goes where the frame puts it, so alignment guides would point at nothing.
  if (slotted) ui.setState({ layoutDrop: layoutDrop(d, result, slotted, dx, dy), guides: [] });
  else ui.setState({ layoutDrop: null });
}

/** The insertion line in front of a slotted layer, and outlines of the dragged layers under the pointer. */
function layoutDrop(d: Extract<Drag, { kind: "move" }>, page: Page, id: NodeId, dx: number, dy: number) {
  const placed = page.nodes[id];
  const parent = placed?.parentId ? page.nodes[placed.parentId] : undefined;
  if (!placed || parent?.type !== "frame" || !parent.layout) return null;
  const box = boundsOfPoints(cornersOf(localMatrix(placed), placed.width, placed.height));
  // Halfway into the gap, unless the layer is the first one.
  const back = parent.children.indexOf(id) > 0 ? Math.max(0, parent.layout.gap) / 2 : 0;
  const ends: [Point, Point] =
    parent.layout.mode === "horizontal"
      ? [{ x: box.x - back, y: box.y }, { x: box.x - back, y: box.y + box.height }]
      : [{ x: box.x, y: box.y - back }, { x: box.x + box.width, y: box.y - back }];
  const toPage = worldMatrix(page, parent.id);
  const line: [Point, Point] = [applyToPoint(toPage, ends[0]), applyToPoint(toPage, ends[1])];
  const ghosts = d.ids.map((dragged) => {
    const node = d.base.nodes[dragged]!;
    return [...cornersOf(multiply(translation(dx, dy), d.worlds.get(dragged)!), node.width, node.height)];
  });
  return { line, ghosts };
}

function updateResize(d: Extract<Drag, { kind: "resize" }>, e: ReactPointerEvent, world: Point): void {
  const node = d.base.nodes[d.id];
  if (!node) return;
  const local = applyToPoint(invert(worldMatrix(d.base, d.id)), world);
  const fromCentre = e.altKey;
  const along = (h: number, pointer: number, size: number) => {
    if (h === 0.5) return size;
    if (fromCentre) return Math.abs(pointer - size / 2) * 2;
    return h === 1 ? pointer : size - pointer;
  };
  let width = Math.max(1, Math.round(along(d.hx, local.x, node.width)));
  let height = Math.max(1, Math.round(along(d.hy, local.y, node.height)));
  if (e.shiftKey && node.width > 0 && node.height > 0) {
    const ratio = node.width / node.height;
    if (d.hy === 0.5 || (d.hx !== 0.5 && width / node.width > height / node.height)) height = Math.max(1, Math.round(width / ratio));
    else width = Math.max(1, Math.round(height * ratio));
  }
  const ax = fromCentre ? 0.5 : 1 - d.hx;
  const ay = fromCentre ? 0.5 : 1 - d.hy;
  editor().transient(() => resizeNode(d.base, d.id, width, height, ax, ay));
}

/** The scale tool: a handle enlarges or shrinks the layer as a whole, strokes and type included. */
function updateScale(d: Extract<Drag, { kind: "scale" }>, e: ReactPointerEvent, world: Point): void {
  const node = d.base.nodes[d.id];
  if (!node) return;
  const local = applyToPoint(invert(worldMatrix(d.base, d.id)), world);
  const fromCentre = e.altKey;
  const ratio = (h: number, pointer: number, size: number) => {
    if (h === 0.5 || size === 0) return 0;
    if (fromCentre) return (Math.abs(pointer - size / 2) * 2) / size;
    return (h === 1 ? pointer : size - pointer) / size;
  };
  // Land the longer side on a whole pixel, and never let it collapse.
  const longest = Math.max(node.width, node.height);
  if (longest <= 0) return;
  const pulled = Math.max(ratio(d.hx, local.x, node.width), ratio(d.hy, local.y, node.height));
  const factor = Math.max(1, Math.round(longest * pulled)) / longest;
  const ax = fromCentre ? 0.5 : 1 - d.hx;
  const ay = fromCentre ? 0.5 : 1 - d.hy;
  editor().transient(() => scaleNode(d.base, d.id, factor, ax, ay));
}

function updateRotate(d: Extract<Drag, { kind: "rotate" }>, e: ReactPointerEvent, world: Point): void {
  const pointer = Math.atan2(world.y - d.centre.y, world.x - d.centre.x);
  let delta = pointer - d.startPointer;
  const startAngle = Math.atan2(d.startWorld[1], d.startWorld[0]);
  // Whole degrees by default, 15° steps with Shift.
  const step = ((e.shiftKey ? 15 : 1) * Math.PI) / 180;
  delta = Math.round((startAngle + delta) / step) * step - startAngle;
  const cos = Math.cos(delta);
  const sin = Math.sin(delta);
  const { x: cx, y: cy } = d.centre;
  const aboutCentre: Matrix = [cos, sin, -sin, cos, cx - cos * cx + sin * cy, cy - sin * cx - cos * cy];
  editor().transient(() => placeNode(d.base, d.id, multiply(aboutCentre, d.startWorld)));
}

// ---------------------------------------------------------------------------
// Event handlers
// ---------------------------------------------------------------------------

export function onPointerDown(e: ReactPointerEvent<Element>): void {
  const s = editor();
  if (s.editingTextId) finishTextEdit();
  ui.setState({ contextMenu: null });
  if (e.button === 2) return;
  const screen = screenPoint(e);
  const world = toWorld(screen);
  e.currentTarget.setPointerCapture(e.pointerId);

  if (e.button === 1 || spaceHeld || s.tool === "hand") {
    const v = currentViewport(s);
    drag = { kind: "pan", startX: e.clientX, startY: e.clientY, x: v.x, y: v.y };
    return;
  }
  const page = currentPage(s);

  if (s.tool === "pen") return penPointerDown(world, e.detail);
  if (s.tool !== "select" && s.tool !== "scale") {
    const start = roundPoint(world);
    drag = { kind: "create", tool: s.tool, start, screen, base: page, parentId: containerFor(page, s.tool, start), node: null };
    return;
  }

  const target = e.target instanceof Element ? e.target : null;
  const single = s.selection.length === 1 ? s.selection[0]! : null;

  const handle = target?.closest("[data-handle]");
  if (handle && single) {
    const [hx, hy] = (handle.getAttribute("data-handle") ?? "1,1").split(",").map(Number);
    s.begin();
    drag = { kind: s.tool === "scale" ? "scale" : "resize", id: single, base: page, hx: hx ?? 1, hy: hy ?? 1 };
    return;
  }
  if (target?.closest("[data-rotate]") && single) {
    const node = page.nodes[single]!;
    const startWorld = worldMatrix(page, single);
    const centre = applyToPoint(startWorld, { x: node.width / 2, y: node.height / 2 });
    s.begin();
    drag = { kind: "rotate", id: single, base: page, centre, startWorld, startPointer: Math.atan2(world.y - centre.y, world.x - centre.x) };
    return;
  }

  const labelId = target?.closest("[data-label-id]")?.getAttribute("data-label-id") ?? null;
  const hit = hitNode(target, page);
  const picked = labelId && page.nodes[labelId] ? labelId : hit ? resolveClickTarget(page, hit, s.selection, e.metaKey || e.ctrlKey) : null;

  if (!picked) {
    if (!e.shiftKey) s.select([]);
    drag = { kind: "marquee", start: world, additive: e.shiftKey ? s.selection : [] };
    return;
  }
  const already = s.selection.includes(picked);
  if (e.shiftKey) {
    s.select(already ? s.selection.filter((id) => id !== picked) : [...s.selection, picked]);
    if (already) return;
  } else if (!already) {
    s.select([picked]);
  }
  beginMove(e, world, screen, already && !e.shiftKey && s.selection.length > 1 ? picked : null);
}

export function onPointerMove(e: ReactPointerEvent<Element>): void {
  const s = editor();
  const screen = screenPoint(e);
  const world = toWorld(screen);
  if (s.tool === "pen" && ui.getState().penPoints.length > 0) {
    if (drag?.kind === "pen") penDrag(world);
    else ui.setState({ penCursor: world });
  }
  if (!drag) return;
  switch (drag.kind) {
    case "pan":
      s.setViewport({ ...currentViewport(s), x: drag.x + e.clientX - drag.startX, y: drag.y + e.clientY - drag.startY });
      break;
    case "move":
      updateMove(drag, e, world, screen);
      break;
    case "resize":
      updateResize(drag, e, world);
      break;
    case "scale":
      updateScale(drag, e, world);
      break;
    case "rotate":
      updateRotate(drag, e, world);
      break;
    case "marquee": {
      const marquee = rectFromPoints(drag.start, world);
      ui.setState({ marquee });
      const found = nodesInMarquee(currentPage(s), marquee);
      const additive = drag.additive;
      s.select([...additive, ...found.filter((id) => !additive.includes(id))]);
      break;
    }
    case "create":
      if (drag.node || Math.hypot(screen.x - drag.screen.x, screen.y - drag.screen.y) >= 3) updateCreate(drag, world, e.shiftKey);
      break;
    case "pen":
      break;
  }
}

export function onPointerUp(e: ReactPointerEvent<Element>): void {
  if (e.currentTarget.hasPointerCapture(e.pointerId)) e.currentTarget.releasePointerCapture(e.pointerId);
  const d = drag;
  drag = null;
  if (!d) return;
  const s = editor();
  switch (d.kind) {
    case "move":
      if (d.moved) s.commit();
      else if (d.narrowTo) s.select([d.narrowTo]);
      ui.setState({ guides: [], layoutDrop: null });
      break;
    case "resize":
    case "scale":
    case "rotate":
      s.commit();
      break;
    case "marquee":
      ui.setState({ marquee: null });
      break;
    case "create":
      finishCreate(d);
      break;
    default:
      break;
  }
}

export function onDoubleClick(e: ReactMouseEvent<Element>): void {
  const s = editor();
  if (s.tool !== "select") return;
  const page = currentPage(s);
  // Pointer capture retargets the click to the canvas, so look up what is really under it.
  const under = document.elementFromPoint(e.clientX, e.clientY);
  // Double-clicking a frame's name above it renames it in place.
  const labelId = under?.closest("[data-label-id]")?.getAttribute("data-label-id") ?? null;
  if (labelId && page.nodes[labelId]) {
    s.select([labelId]);
    ui.setState({ labelEditId: labelId });
    return;
  }
  const hit = hitNode(under, page);
  if (!hit) return;
  const current = s.selection.length === 1 ? s.selection[0]! : null;
  const currentNode = current ? page.nodes[current] : undefined;
  if (currentNode?.type === "text") return startTextEdit(currentNode.id);
  const deeper = resolveDrillTarget(page, hit, current);
  if (deeper) s.select([deeper]);
}

export function onContextMenu(e: ReactMouseEvent<Element>): void {
  e.preventDefault();
  const s = editor();
  if (s.editingTextId) finishTextEdit();
  const page = currentPage(s);
  const labelId = e.target instanceof Element ? (e.target.closest("[data-label-id]")?.getAttribute("data-label-id") ?? null) : null;
  const hit = hitNode(e.target, page);
  const picked = labelId ?? (hit ? resolveClickTarget(page, hit, s.selection, false) : null);
  if (picked && !s.selection.includes(picked)) s.select([picked]);
  else if (!picked) s.select([]);
  ui.setState({ contextMenu: { x: e.clientX, y: e.clientY } });
}

export function cancelGesture(): void {
  if (drag && drag.kind !== "pan" && drag.kind !== "marquee" && drag.kind !== "pen") editor().cancel();
  drag = null;
  ui.setState({ marquee: null, guides: [], layoutDrop: null });
}
