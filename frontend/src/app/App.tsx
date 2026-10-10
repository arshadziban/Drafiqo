import { useEffect } from "react";
import { Canvas } from "../canvas/Canvas";
import { ExportDialog } from "../components/ExportDialog";
import { LeftSidebar } from "../components/LeftSidebar";
import { PropertiesPanel } from "../components/PropertiesPanel";
import { ToolDock } from "../components/ToolDock";
import { Toolbar } from "../components/Toolbar";
import { isDirty, useEditor } from "../editor/store";
import { confirmDiscard } from "../storage/fileActions";
import { platform } from "../storage/platform";
import { installShortcuts } from "./shortcuts";

export function App() {
  const name = useEditor((s) => s.doc.name);
  const dirty = useEditor(isDirty);
  const showLeft = useEditor((s) => s.showLeftSidebar);

  useEffect(() => installShortcuts(), []);

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
    </div>
  );
}
