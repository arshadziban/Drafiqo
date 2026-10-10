import { useCanvasUi } from "../canvas/uiStore";
import { useEditor } from "../editor/store";

/** Opens the export dialog, first finishing any edit that is still in progress. */
export function openExportDialog(): void {
  useEditor.getState().commit();
  useCanvasUi.setState({ exportOpen: true, contextMenu: null });
}
