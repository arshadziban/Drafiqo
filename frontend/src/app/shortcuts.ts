import { cancelGesture, finishPen, startTextEdit } from "../canvas/interactions";
import { useCanvasUi } from "../canvas/uiStore";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  nudgeSelection,
  paste,
  reorderSelection,
  selectAll,
  toggleLockSelection,
  toggleVisibleSelection,
  ungroupSelection,
  zoomIn,
  zoomOut,
  zoomTo,
  zoomToFit,
} from "../editor/actions";
import { openExportDialog } from "../components/openExportDialog";
import { currentPage, useEditor, type Tool } from "../editor/store";
import { newProject, openProject, saveProject, saveProjectAs } from "../storage/fileActions";

const TOOL_KEYS: Record<string, Tool> = {
  v: "select",
  h: "hand",
  f: "frame",
  r: "rectangle",
  o: "ellipse",
  l: "line",
  y: "polygon",
  s: "star",
  t: "text",
  p: "pen",
};

function isTyping(target: EventTarget | null): boolean {
  return target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName));
}

/** Runs the shortcut for a key event. Returns true when it was handled. */
function handle(e: KeyboardEvent): boolean {
  const s = useEditor.getState();
  const mod = e.metaKey || e.ctrlKey;
  const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;

  if (mod) {
    switch (key) {
      case "z":
        if (e.shiftKey) s.redo();
        else s.undo();
        return true;
      case "y":
        s.redo();
        return true;
      case "s":
        void (e.shiftKey ? saveProjectAs() : saveProject());
        return true;
      case "o":
        void openProject();
        return true;
      case "n":
        void newProject();
        return true;
      case "e":
        if (!e.shiftKey) return false;
        openExportDialog();
        return true;
      case "d":
        duplicateSelection();
        return true;
      case "g":
        if (e.shiftKey) ungroupSelection();
        else groupSelection();
        return true;
      case "a":
        selectAll();
        return true;
      case "c":
        copySelection();
        return true;
      case "x":
        cutSelection();
        return true;
      case "v":
        paste();
        return true;
      case "]":
        reorderSelection("forward");
        return true;
      case "[":
        reorderSelection("backward");
        return true;
      case "l":
        if (!e.shiftKey) return false;
        toggleLockSelection();
        return true;
      case "h":
        if (!e.shiftKey) return false;
        toggleVisibleSelection();
        return true;
      case "=":
      case "+":
        zoomIn();
        return true;
      case "-":
        zoomOut();
        return true;
      case "0":
        zoomTo(1);
        return true;
      case "'":
        useEditor.setState({ showGrid: !s.showGrid });
        return true;
      default:
        return false;
    }
  }
  if (e.altKey) return false;

  switch (key) {
    case "Delete":
    case "Backspace":
      deleteSelection();
      return true;
    case "Escape":
      if (s.tool === "pen") finishPen(false);
      else if (s.tool !== "select") s.setTool("select");
      else {
        cancelGesture();
        s.select([]);
      }
      useCanvasUi.setState({ contextMenu: null });
      return true;
    case "Enter": {
      if (s.tool === "pen") {
        finishPen(false);
        return true;
      }
      const id = s.selection.length === 1 ? s.selection[0]! : null;
      if (id && currentPage(s).nodes[id]?.type === "text") {
        startTextEdit(id);
        return true;
      }
      return false;
    }
    case "ArrowLeft":
      nudgeSelection(e.shiftKey ? -10 : -1, 0);
      return true;
    case "ArrowRight":
      nudgeSelection(e.shiftKey ? 10 : 1, 0);
      return true;
    case "ArrowUp":
      nudgeSelection(0, e.shiftKey ? -10 : -1);
      return true;
    case "ArrowDown":
      nudgeSelection(0, e.shiftKey ? 10 : 1);
      return true;
    case "]":
      reorderSelection("front");
      return true;
    case "[":
      reorderSelection("back");
      return true;
    case "!":
    case "1":
      if (!e.shiftKey) return false;
      zoomToFit();
      return true;
    default:
      break;
  }

  if (e.shiftKey && key === "s") {
    s.setTool("section");
    return true;
  }
  const tool = e.shiftKey ? undefined : TOOL_KEYS[key];
  if (tool) {
    if (s.tool === "pen" && tool !== "pen") finishPen(false);
    s.setTool(tool);
    return true;
  }
  return false;
}

export function installShortcuts(): () => void {
  const onKeyDown = (e: KeyboardEvent) => {
    // The export dialog is modal: editor shortcuts wait until it closes.
    if (useCanvasUi.getState().exportOpen) return;
    // Typing in a field keeps every key, including the system's own editing shortcuts.
    if (isTyping(e.target)) {
      const fileShortcut = (e.metaKey || e.ctrlKey) && ["s", "o", "n"].includes(e.key.toLowerCase());
      if (!fileShortcut) return;
      // Commit whatever is being typed before the file operation reads the document.
      (e.target as HTMLElement).blur();
    }
    if (handle(e)) e.preventDefault();
  };
  window.addEventListener("keydown", onKeyDown);
  return () => window.removeEventListener("keydown", onKeyDown);
}
