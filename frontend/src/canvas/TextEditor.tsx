import { useEffect, useRef } from "react";
import { multiply, worldMatrix, type Matrix } from "../document/geometry";
import { patchNodes } from "../editor/commands";
import { currentPage, currentViewport, useEditor } from "../editor/store";
import { finishTextEdit } from "./interactions";
import { fontStack } from "./renderNode";

/** In-place editor laid over the text node being edited. */
export function TextEditor() {
  const id = useEditor((s) => s.editingTextId);
  const node = useEditor((s) => (s.editingTextId ? currentPage(s).nodes[s.editingTextId] : undefined));
  const page = useEditor(currentPage);
  const viewport = useEditor(currentViewport);
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.focus();
    el.select();
  }, [id]);

  if (!id || !node || node.type !== "text") return null;
  const view: Matrix = [viewport.zoom, 0, 0, viewport.zoom, viewport.x, viewport.y];
  const m = multiply(view, worldMatrix(page, id));
  const auto = node.autoResize === "auto";
  // Auto-sized text needs room for the caret past the last glyph.
  const slack = auto ? node.fontSize : 0;
  const slackShift = node.textAlign === "center" ? slack / 2 : node.textAlign === "right" ? slack : 0;

  return (
    <textarea
      key={id}
      ref={ref}
      data-text-editor
      value={node.text}
      spellCheck={false}
      onChange={(e) => {
        const text = e.target.value;
        useEditor.getState().transient((p) => patchNodes(p, [id], { text }));
      }}
      onBlur={finishTextEdit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === "Escape" || (e.key === "Enter" && (e.metaKey || e.ctrlKey))) {
          e.preventDefault();
          finishTextEdit();
        }
      }}
      onPointerDown={(e) => e.stopPropagation()}
      style={{
        position: "absolute",
        left: 0,
        top: 0,
        transformOrigin: "0 0",
        transform: `matrix(${m.join(",")})`,
        width: Math.max(node.width, 1) + slack,
        height: Math.max(node.height, node.fontSize * node.lineHeight),
        marginLeft: -slackShift,
        padding: 0,
        border: "none",
        outline: `${1 / viewport.zoom}px solid #007aff`,
        background: "transparent",
        resize: "none",
        overflow: "hidden",
        whiteSpace: auto ? "pre" : "pre-wrap",
        overflowWrap: "break-word",
        fontFamily: fontStack(node.fontFamily),
        fontSize: node.fontSize,
        fontWeight: node.fontWeight,
        lineHeight: node.lineHeight,
        letterSpacing: node.letterSpacing,
        textAlign: node.textAlign,
        color: node.fills.find((f) => f.visible)?.color ?? "#000000",
        caretColor: "#007aff",
      }}
    />
  );
}
