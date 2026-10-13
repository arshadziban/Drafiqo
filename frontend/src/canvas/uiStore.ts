import { create } from "zustand";
import type { SlideView } from "../editor/present";
import type { Point, Rect } from "../document/geometry";
import type { NodeId, PathPoint } from "../document/types";
import type { SnapGuide } from "./snapping";

/**
 * Pointer-driven state that never reaches the document: kept apart from the
 * editor store so a drag only repaints the canvas overlay.
 */
interface CanvasUiState {
  marquee: Rect | null;
  guides: SnapGuide[];
  /** While a layer is dragged through an auto layout frame: where it will land, and where the pointer holds it. In page space. */
  layoutDrop: { line: [Point, Point]; ghosts: Point[][] } | null;
  /** Path being drawn with the pen tool, in page space. */
  penPoints: PathPoint[];
  penCursor: { x: number; y: number } | null;
  contextMenu: { x: number; y: number } | null;
  renamingId: NodeId | null;
  /** The frame or section whose name is being edited on the canvas label. */
  labelEditId: NodeId | null;
  exportOpen: boolean;
  /** The slideshow, while one is running. */
  presenting: { slides: SlideView[]; index: number } | null;
  /** A short confirmation shown at the top of the window, e.g. after an export. */
  toast: { id: number; title: string; detail?: string; warnings?: string[] } | null;
}

export const useCanvasUi = create<CanvasUiState>()(() => ({
  marquee: null,
  guides: [],
  layoutDrop: null,
  penPoints: [],
  penCursor: null,
  contextMenu: null,
  renamingId: null,
  labelEditId: null,
  exportOpen: false,
  presenting: null,
  toast: null,
}));
