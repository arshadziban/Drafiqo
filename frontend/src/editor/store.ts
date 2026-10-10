import { create } from "zustand";
import { createDocument } from "../document/factory";
import { setAssets } from "../document/assets";
import { getPage } from "../document/tree";
import type { DrafiqoDocument, NodeId, Page, PageId } from "../document/types";
import { emptyHistory, record, redo, undo, type History } from "../history/history";
import { updatePage } from "./commands";

export type Tool = "select" | "hand" | "frame" | "section" | "rectangle" | "ellipse" | "line" | "polygon" | "star" | "text" | "pen";

export interface Viewport {
  /** Screen-space offset of the page origin, in CSS pixels. */
  x: number;
  y: number;
  zoom: number;
}

export type SaveStatus = "idle" | "saving" | "saved" | "error";

/** Everything undo/redo restores. */
interface Snapshot {
  doc: DrafiqoDocument;
  pageId: PageId;
  selection: NodeId[];
}

export interface EditorState {
  doc: DrafiqoDocument;
  pageId: PageId;
  selection: NodeId[];
  history: History<Snapshot>;
  /** State captured when a transaction (drag, text edit) began. */
  transaction: Snapshot | null;

  tool: Tool;
  viewports: Record<PageId, Viewport>;
  canvasSize: { width: number; height: number };
  editingTextId: NodeId | null;
  showGrid: boolean;
  snapEnabled: boolean;
  showLeftSidebar: boolean;
  collapsed: Record<NodeId, boolean>;

  filePath: string | null;
  /** The document as last written to disk (or as created/opened). */
  savedDoc: DrafiqoDocument;
  saveStatus: SaveStatus;
  saveError: string | null;

  /** Applies an edit to the current page as one undoable step. */
  edit: (fn: (page: Page) => Page, selection?: NodeId[]) => void;
  /** Applies a document-level edit as one undoable step. */
  editDoc: (fn: (doc: DrafiqoDocument) => DrafiqoDocument, next?: { pageId?: PageId; selection?: NodeId[] }) => void;
  /** Starts a transaction: following `transient` edits collapse into one history entry. */
  begin: () => void;
  transient: (fn: (page: Page) => Page, selection?: NodeId[]) => void;
  commit: () => void;
  cancel: () => void;
  undo: () => void;
  redo: () => void;

  select: (ids: NodeId[]) => void;
  setTool: (tool: Tool) => void;
  setPage: (pageId: PageId) => void;
  setViewport: (viewport: Viewport) => void;
  loadDocument: (doc: DrafiqoDocument, filePath: string | null) => void;
}

export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

function snapshot(s: EditorState): Snapshot {
  return { doc: s.doc, pageId: s.pageId, selection: s.selection };
}

/** Restores a snapshot, dropping anything it refers to that no longer exists. */
function restore(snap: Snapshot, name: string): Pick<EditorState, "doc" | "pageId" | "selection" | "editingTextId"> {
  const page = getPage(snap.doc, snap.pageId) ?? snap.doc.pages[0]!;
  return {
    // The project name follows the file on disk and is not part of history.
    doc: snap.doc.name === name ? snap.doc : { ...snap.doc, name },
    pageId: page.id,
    selection: snap.selection.filter((id) => page.nodes[id]),
    editingTextId: null,
  };
}

const initialDoc = createDocument();

export const useEditor = create<EditorState>()((set, get) => ({
  doc: initialDoc,
  pageId: initialDoc.pages[0]!.id,
  selection: [],
  history: emptyHistory(),
  transaction: null,

  tool: "select",
  viewports: {},
  canvasSize: { width: 0, height: 0 },
  editingTextId: null,
  showGrid: false,
  snapEnabled: true,
  showLeftSidebar: true,
  collapsed: {},

  filePath: null,
  savedDoc: initialDoc,
  saveStatus: "idle",
  saveError: null,

  edit: (fn, selection) => {
    const s = get();
    if (s.transaction) return s.transient(fn, selection);
    const doc = updatePage(s.doc, s.pageId, fn);
    if (doc === s.doc) {
      if (selection) set({ selection });
      return;
    }
    set({ doc, selection: selection ?? s.selection, history: record(s.history, snapshot(s)) });
  },

  editDoc: (fn, next) => {
    const s = get();
    const doc = fn(s.doc);
    if (doc === s.doc) return;
    const pageId = next?.pageId ?? (getPage(doc, s.pageId) ? s.pageId : doc.pages[0]!.id);
    const selection = next?.selection ?? (pageId === s.pageId ? s.selection : []);
    // Inside a transaction the snapshot taken at `begin` is what gets recorded.
    const history = s.transaction ? s.history : record(s.history, snapshot(s));
    set({ doc, pageId, selection, history, editingTextId: null });
  },

  begin: () => {
    const s = get();
    if (!s.transaction) set({ transaction: snapshot(s) });
  },

  transient: (fn, selection) => {
    const s = get();
    const doc = updatePage(s.doc, s.pageId, fn);
    if (doc === s.doc && !selection) return;
    set({ doc, selection: selection ?? s.selection });
  },

  commit: () => {
    const s = get();
    if (!s.transaction) return;
    const changed = s.transaction.doc !== s.doc;
    set({ transaction: null, history: changed ? record(s.history, s.transaction) : s.history });
  },

  cancel: () => {
    const s = get();
    if (!s.transaction) return;
    set({ ...restore(s.transaction, s.doc.name), transaction: null });
  },

  undo: () => {
    get().commit();
    const s = get();
    const result = undo(s.history, snapshot(s));
    if (result) set({ ...restore(result.state, s.doc.name), history: result.history });
  },

  redo: () => {
    get().commit();
    const s = get();
    const result = redo(s.history, snapshot(s));
    if (result) set({ ...restore(result.state, s.doc.name), history: result.history });
  },

  select: (ids) => {
    const current = get().selection;
    if (ids.length === current.length && ids.every((id, i) => id === current[i])) return;
    set({ selection: ids });
  },

  setTool: (tool) => set({ tool }),

  setPage: (pageId) => {
    const s = get();
    if (pageId === s.pageId || !getPage(s.doc, pageId)) return;
    s.commit();
    set({ pageId, selection: [], editingTextId: null });
  },

  setViewport: (viewport) => set((s) => ({ viewports: { ...s.viewports, [s.pageId]: viewport } })),

  loadDocument: (doc, filePath) =>
    set({
      doc,
      pageId: doc.pages[0]!.id,
      selection: [],
      history: emptyHistory(),
      transaction: null,
      editingTextId: null,
      viewports: {},
      collapsed: {},
      tool: "select",
      filePath,
      savedDoc: doc,
      saveStatus: "idle",
      saveError: null,
    }),
}));

// Image fills are drawn from the registry, so it must follow the document before React re-renders.
setAssets(useEditor.getState().doc.assets);
useEditor.subscribe((s) => setAssets(s.doc.assets));

export function currentPage(s: EditorState): Page {
  return getPage(s.doc, s.pageId) ?? s.doc.pages[0]!;
}

export function currentViewport(s: EditorState): Viewport {
  return s.viewports[s.pageId] ?? DEFAULT_VIEWPORT;
}

export function isDirty(s: EditorState): boolean {
  // All editable content lives in the pages; they are shared by reference until edited.
  return s.doc.pages !== s.savedDoc.pages;
}
