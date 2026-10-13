import { useEffect } from "react";
import { Canvas } from "../canvas/Canvas";
import { ExportDialog } from "../components/ExportDialog";
import { FigmaImportDialog } from "../components/FigmaImportDialog";
import { LeftSidebar } from "../components/LeftSidebar";
import { Presentation } from "../components/Presentation";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { ToolDock } from "../components/ToolDock";
import { Toast } from "../components/Toast";
import { Toolbar } from "../components/Toolbar";
import { TooltipLayer } from "../components/TooltipLayer";
import { isDirty, useEditor } from "../editor/store";
import { confirmDiscard } from "../storage/fileActions";
import { platform } from "../storage/platform";
import { installShortcuts } from "./shortcuts";

export function App() {
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor(isDirty);
  const showLeft = useEditor((s) => s.showLeftSidebar);

  useEffect(() => installShortcuts(), []);

  // A file dropped anywhere else would otherwise make the window navigate to it.
  useEffect(() => {
    const keep = (e: DragEvent) => {
      if (e.dataTransfer?.types.includes("Files")) e.preventDefault();
    };
    window.addEventListener("dragover", keep);
    window.addEventListener("drop", keep);
    return () => {
      window.removeEventListener("dragover", keep);
      window.removeEventListener("drop", keep);
    };
  }, []);

  useEffect(() => {
    platform.setTitle(`${dirty ? "● " : ""}${name}`);
  }, [name, dirty]);

  useEffect(() => {
    // Registered once per window, even when effects re-run in development.
    if (window.__drafiqoDirty) return;
    window.__drafiqoDirty = () => isDirty(useEditor.getState());
    platform.onCloseRequested(confirmDiscard);
  }, []);

  return (
    <div className="flex h-full flex-col" onContextMenu={(e) => e.preventDefault()}>
      <Toolbar />
      <div className="flex min-h-0 flex-1">
        {showLeft && <LeftSidebar />}
        <main className="relative min-w-0 flex-1">
          <Canvas />
          <ToolDock />
        </main>
        <PropertiesPanel />
      </div>
      <ExportDialog />
      <FigmaImportDialog />
      <TooltipLayer />
      <Presentation />
      <Toast />
    </div>
  );
}
