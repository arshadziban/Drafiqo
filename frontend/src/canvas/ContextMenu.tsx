import { useCallback } from "react";
import { MenuList, useDismiss, type MenuEntry } from "../components/ui";
import {
  copySelection,
  cutSelection,
  deleteSelection,
  duplicateSelection,
  groupSelection,
  hasClipboard,
  paste,
  reorderSelection,
  selectAll,
  toggleLockSelection,
  toggleVisibleSelection,
  ungroupSelection,
} from "../editor/actions";
import { useEditor } from "../editor/store";
import { useCanvasUi } from "./uiStore";

export function ContextMenu() {
  const position = useCanvasUi((s) => s.contextMenu);
  const count = useEditor((s) => s.selection.length);
  const close = useCallback(() => useCanvasUi.setState({ contextMenu: null }), []);
  const ref = useDismiss(position !== null, close);
  if (!position) return null;
  const none = count === 0;
  const items: MenuEntry[] = [
    { label: "Cut", shortcut: "Mod+X", action: cutSelection, disabled: none },
    { label: "Copy", shortcut: "Mod+C", action: () => void copySelection(), disabled: none },
    { label: "Paste", shortcut: "Mod+V", action: paste, disabled: !hasClipboard() },
    { label: "Duplicate", shortcut: "Mod+D", action: duplicateSelection, disabled: none },
    { label: "Delete", shortcut: "⌫", action: deleteSelection, disabled: none },
    "separator",
    { label: "Group", shortcut: "Mod+G", action: groupSelection, disabled: none },
    { label: "Ungroup", shortcut: "Mod+Shift+G", action: ungroupSelection, disabled: none },
    "separator",
    { label: "Bring to front", shortcut: "]", action: () => reorderSelection("front"), disabled: none },
    { label: "Bring forward", shortcut: "Mod+]", action: () => reorderSelection("forward"), disabled: none },
    { label: "Send backward", shortcut: "Mod+[", action: () => reorderSelection("backward"), disabled: none },
    { label: "Send to back", shortcut: "[", action: () => reorderSelection("back"), disabled: none },
    "separator",
    { label: "Lock / unlock", shortcut: "Mod+Shift+L", action: toggleLockSelection, disabled: none },
    { label: "Hide / show", shortcut: "Mod+Shift+H", action: toggleVisibleSelection, disabled: none },
    "separator",
    { label: "Select all", shortcut: "Mod+A", action: selectAll },
  ];
  // Keep the menu on screen near the bottom and right edges.
  const left = Math.min(position.x, window.innerWidth - 240);
  const top = Math.min(position.y, window.innerHeight - 500);
  return (
    <div ref={ref} className="fixed z-50" style={{ left, top }} onContextMenu={(e) => e.preventDefault()}>
      <MenuList items={items} onClose={close} />
    </div>
  );
}
