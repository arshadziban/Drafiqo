import { useRef, useState } from "react";
import { applyToPoint, multiply, worldMatrix, type Matrix } from "../document/geometry";
import type { NodeId } from "../document/types";
import { patchNodes } from "../editor/commands";
import { currentPage, currentViewport, useEditor } from "../editor/store";
import { useCanvasUi } from "./uiStore";

/**
 * In-place editor for a frame's or section's name, laid over its label on the
 * canvas. Started by double-clicking the label (see onDoubleClick).
 */
export function LabelEditor() {
  const id = useCanvasUi((s) => s.labelEditId);
  const page = useEditor(currentPage);
  const viewport = useEditor(currentViewport);
  const node = id ? page.nodes[id] : undefined;
  if (!id || !node || !node.visible) return null;

  const view: Matrix = [viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y];
  const m = multiply(view, worldMatrix(page, id));
  const origin = applyToPoint(m, { x: 0, y: 0 });
  const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  return <LabelInput key={id} id={id} initial={node.name} x={origin.x} y={origin.y} angle={angle} />;
}

function LabelInput({ id, initial, x, y, angle }: { id: NodeId; initial: string; x: number; y: number; angle: number }) {
  const [value, setValue] = useState(initial);
  const finished = useRef(false);

  // Leaves editing exactly once, whether by Enter, Escape or clicking away.
  const finish = (commit: boolean) => {
    if (finished.current) return;
    finished.current = true;
    useCanvasUi.setState({ labelEditId: null });
    const name = value.trim();
    if (commit && name && name !== initial) useEditor.getState().edit((p) => patchNodes(p, [id], { name }));
  };

  return (
    <input
      autoFocus
      aria-label="Frame name"
      value={value}
      maxLength={120}
      onChange={(e) => setValue(e.target.value)}
      onFocus={(e) => e.target.select()}
      onBlur={() => finish(true)}
      onKeyDown={(e) => {
        // Keys typed here belong to the name, not to the editor's shortcuts.
        e.stopPropagation();
        if (e.key === "Enter") finish(true);
        else if (e.key === "Escape") finish(false);
      }}
      className="absolute z-20 h-5 rounded-[4px] bg-ink-950 px-1 text-[11px] text-accent-hover shadow-[0_0_0_1.5px_var(--color-accent)] outline-none"
      style={{
        left: 0,
        top: 0,
        // Wide enough for the text, like the label it replaces.
        width: Math.max(72, value.length * 6.6 + 16),
        transformOrigin: "0 100%",
        transform: `translate(${x - 4}px, ${y - 24}px) rotate(${angle}deg)`,
      }}
    />
  );
}
