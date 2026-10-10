// User-level operations shared by menus, shortcuts, the context menu and the
// panels. They read the current selection and go through the store so every
// one of them is undoable.

import { createFrame } from "../document/factory";
import { selectionBounds } from "../document/geometry";
import { childrenOf, isEffectivelyLocked, nextName, topLevelSelection } from "../document/tree";
import { isContainer, type NodeId } from "../document/types";
import {
  addPage,
  alignNodes,
  copyNodes,
  deletePage,
  distributeNodes,
  duplicateNodes,
  freeSpotFor,
  groupNodes,
  insertNode,
  pasteNodes,
  patchNodes,
  removeNodes,
  reorderNodes,
  translateNodes,
  ungroupNodes,
  type AlignMode,
  type ClipboardPayload,
  type ReorderMode,
} from "./commands";
import { currentPage, currentViewport, useEditor, type Viewport } from "./store";

const state = () => useEditor.getState();

/** Selected nodes that may be changed (nothing locked, directly or through a parent). */
function editableSelection(): NodeId[] {
  const s = state();
  const page = currentPage(s);
  return s.selection.filter((id) => page.nodes[id] && !isEffectivelyLocked(page, id));
}

export function deleteSelection(): void {
  const ids = editableSelection();
  if (ids.length > 0) state().edit((page) => removeNodes(page, ids), []);
}

export function duplicateSelection(): void {
  const ids = editableSelection();
  if (ids.length === 0) return;
  let created: NodeId[] = [];
  const s = state();
  const result = duplicateNodes(currentPage(s), ids);
  created = result.ids;
  s.edit(() => result.page, created);
}

export function groupSelection(): void {
  const ids = editableSelection();
  if (ids.length === 0) return;
  const s = state();
  const result = groupNodes(currentPage(s), ids);
  if (result.groupId) s.edit(() => result.page, [result.groupId]);
}

export function ungroupSelection(): void {
  const s = state();
  const page = currentPage(s);
  const ids = editableSelection().filter((id) => {
    const node = page.nodes[id];
    return node && isContainer(node);
  });
  if (ids.length === 0) return;
  const result = ungroupNodes(page, ids);
  s.edit(() => result.page, result.ids);
}

export function reorderSelection(mode: ReorderMode): void {
  const ids = editableSelection();
  state().edit((page) => reorderNodes(page, ids, mode));
}

export function alignSelection(mode: AlignMode): void {
  const ids = editableSelection();
  state().edit((page) => alignNodes(page, ids, mode));
}

export function distributeSelection(axis: "horizontal" | "vertical"): void {
  const ids = editableSelection();
  state().edit((page) => distributeNodes(page, ids, axis));
}

export function nudgeSelection(dx: number, dy: number): void {
  const ids = editableSelection();
  state().edit((page) => translateNodes(page, ids, dx, dy));
}

/** Locks everything selected, or unlocks if it is all locked already. */
export function toggleLockSelection(): void {
  const s = state();
  const page = currentPage(s);
  const allLocked = s.selection.every((id) => page.nodes[id]?.locked);
  s.edit((p) => patchNodes(p, s.selection, { locked: !allLocked }));
}

export function toggleVisibleSelection(): void {
  const s = state();
  const page = currentPage(s);
  const allHidden = s.selection.every((id) => page.nodes[id]?.visible === false);
  s.edit((p) => patchNodes(p, s.selection, { visible: allHidden }));
}

/** Selects the siblings of the current selection, or the top level of the page. */
export function selectAll(): void {
  const s = state();
  const page = currentPage(s);
  const first = s.selection[0];
  const parentId = first ? (page.nodes[first]?.parentId ?? null) : null;
  s.select(childrenOf(page, parentId).filter((id) => page.nodes[id]?.visible && !page.nodes[id]?.locked));
}

// Clipboard -----------------------------------------------------------------

let clipboard: ClipboardPayload | null = null;

export function copySelection(): boolean {
  const s = state();
  if (s.selection.length === 0) return false;
  clipboard = copyNodes(currentPage(s), s.selection);
  return true;
}

export function cutSelection(): void {
  if (copySelection()) deleteSelection();
}

export function hasClipboard(): boolean {
  return clipboard !== null;
}

export function paste(): void {
  if (!clipboard) return;
  const s = state();
  const result = pasteNodes(currentPage(s), clipboard);
  s.edit(() => result.page, result.ids);
}

// Frames --------------------------------------------------------------------

export interface FramePreset {
  group: "Desktop" | "Tablet" | "Mobile";
  name: string;
  width: number;
  height: number;
}

export const FRAME_PRESETS: FramePreset[] = [
  { group: "Desktop", name: "Desktop", width: 1440, height: 1024 },
  { group: "Desktop", name: "Laptop", width: 1280, height: 832 },
  { group: "Desktop", name: "Wide", width: 1920, height: 1080 },
  { group: "Tablet", name: "Tablet", width: 768, height: 1024 },
  { group: "Tablet", name: "Tablet landscape", width: 1024, height: 768 },
  { group: "Mobile", name: "Mobile", width: 390, height: 844 },
  { group: "Mobile", name: "Mobile small", width: 375, height: 812 },
  { group: "Mobile", name: "Mobile large", width: 430, height: 932 },
];

export function insertFramePreset(preset: FramePreset): void {
  const s = state();
  const page = currentPage(s);
  const v = currentViewport(s);
  const centre = { x: (s.canvasSize.width / 2 - v.x) / v.zoom, y: (s.canvasSize.height / 2 - v.y) / v.zoom };
  const frame = { ...createFrame(freeSpotFor(page, preset, centre)), name: nextName(page, preset.name) };
  s.edit((p) => insertNode(p, frame), [frame.id]);
  s.setTool("select");
  zoomToFit();
}

// Pages ---------------------------------------------------------------------

export function createPageAction(): void {
  const s = state();
  const result = addPage(s.doc);
  s.editDoc(() => result.doc, { pageId: result.pageId, selection: [] });
}

export function deletePageAction(pageId: string): void {
  state().editDoc((doc) => deletePage(doc, pageId));
}

// Viewport ------------------------------------------------------------------

export const MIN_ZOOM = 0.02;
export const MAX_ZOOM = 64;

export function zoomAt(point: { x: number; y: number }, zoom: number): void {
  const s = state();
  const v = currentViewport(s);
  const next = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, zoom));
  const worldX = (point.x - v.x) / v.zoom;
  const worldY = (point.y - v.y) / v.zoom;
  s.setViewport({ x: point.x - worldX * next, y: point.y - worldY * next, zoom: next });
}

function canvasCentre() {
  const { width, height } = state().canvasSize;
  return { x: width / 2, y: height / 2 };
}

const ZOOM_STEPS = [0.02, 0.05, 0.1, 0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4, 8, 16, 32, 64];

export function zoomIn(): void {
  const z = currentViewport(state()).zoom;
  zoomAt(canvasCentre(), ZOOM_STEPS.find((step) => step > z * 1.001) ?? MAX_ZOOM);
}

export function zoomOut(): void {
  const z = currentViewport(state()).zoom;
  zoomAt(canvasCentre(), [...ZOOM_STEPS].reverse().find((step) => step < z * 0.999) ?? MIN_ZOOM);
}

export function zoomTo(zoom: number): void {
  zoomAt(canvasCentre(), zoom);
}

/** Frames the selection, or the whole page when nothing is selected. */
export function zoomToFit(): void {
  const s = state();
  const page = currentPage(s);
  const ids = s.selection.length > 0 ? topLevelSelection(page, s.selection) : page.children;
  const bounds = selectionBounds(page, ids);
  const { width, height } = s.canvasSize;
  if (!bounds || width === 0 || height === 0) return;
  const margin = 64;
  const zoom = Math.min(
    4,
    Math.max(MIN_ZOOM, Math.min((width - margin * 2) / Math.max(bounds.width, 1), (height - margin * 2) / Math.max(bounds.height, 1))),
  );
  const viewport: Viewport = {
    x: width / 2 - (bounds.x + bounds.width / 2) * zoom,
    y: height / 2 - (bounds.y + bounds.height / 2) * zoom,
    zoom,
  };
  s.setViewport(viewport);
}
