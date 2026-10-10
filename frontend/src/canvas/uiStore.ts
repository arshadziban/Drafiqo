import { create } from "zustand";
import type { Rect } from "../document/geometry";
import type { NodeId, PathPoint } from "../document/types";
import type { SnapGuide } from "./snapping";

/**
 * Pointer-driven state that never reaches the document: kept apart from the
 * editor store so a drag only repaints the canvas overlay.
 */
interface CanvasUiState {
  marquee: Rect | null;
  guides: SnapGuide[];
  /** Path being drawn with the pen tool, in page space. */
  penPoints: PathPoint[];
  penCursor: { x: number; y: number } | null;
  contextMenu: { x: number; y: number } | null;
  renamingId: NodeId | null;
  exportOpen: boolean;
}

export const useCanvasUi = create<CanvasUiState>()(() => ({
  marquee: null,
  guides: [],
  penPoints: [],
  penCursor: null,
  contextMenu: null,
  renamingId: null,
  exportOpen: false,
}));
