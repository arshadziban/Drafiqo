import { useEffect, useRef, useState } from "react";
import { zoomAt } from "../editor/actions";
import { currentPage, currentViewport, useEditor } from "../editor/store";
import { ContextMenu } from "./ContextMenu";
import { finishPen, isSpaceHeld, onContextMenu, onDoubleClick, onPointerDown, onPointerMove, onPointerUp, setSpaceHeld } from "./interactions";
import { LabelEditor } from "./LabelEditor";
import { NodeView } from "./NodeView";
import { Overlay } from "./Overlay";
import { TextEditor } from "./TextEditor";

function Grid({ x, y, zoom }: { x: number; y: number; zoom: number }) {
  // Pick the smallest power-of-ten step that stays readable at this zoom.
  let step = 1;
  while (step * zoom < 12) step *= 10;
  const size = step * zoom;
  return (
    <>
      <defs>
        <pattern id="drafiqo-grid" patternUnits="userSpaceOnUse" x={x % size} y={y % size} width={size} height={size}>
          <path d={`M${size} 0H0V${size}`} fill="none" stroke="#ffffff" strokeOpacity={0.09} strokeWidth={1} />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill="url(#drafiqo-grid)" pointerEvents="none" />
    </>
  );
}

const Key = ({ children }: { children: string }) => (
  <kbd className="rounded border border-white/15 bg-white/10 px-1.5 py-0.5 font-sans text-[11px] font-medium text-white/85">{children}</kbd>
);

/** Shown on an empty page so the first step is obvious. */
function EmptyHint() {
  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center">
      <div className="flex flex-col items-center gap-3 rounded-xl bg-black/35 px-6 py-5 text-white/70 backdrop-blur-sm">
        <span className="text-[13px] font-semibold text-white/90">This page is empty</span>
        <span className="flex items-center gap-2">
          <Key>F</Key> frame <Key>R</Key> rectangle <Key>T</Key> text <Key>P</Key> pen
        </span>
        <span className="text-white/50">Hold Space and drag to pan · pinch or Ctrl-scroll to zoom</span>
      </div>
    </div>
  );
}

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const background = useEditor((s) => currentPage(s).background);
  const children = useEditor((s) => currentPage(s).children);
  const pageId = useEditor((s) => s.pageId);
  const viewport = useEditor(currentViewport);
  const hasViewport = useEditor((s) => s.pageId in s.viewports);
  const tool = useEditor((s) => s.tool);
  const showGrid = useEditor((s) => s.showGrid);
  const [panning, setPanning] = useState(false);

  // Track the canvas size and give each page a centred starting view.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const observer = new ResizeObserver(() => {
      useEditor.setState({ canvasSize: { width: el.clientWidth, height: el.clientHeight } });
    });
    observer.observe(el);
    useEditor.setState({ canvasSize: { width: el.clientWidth, height: el.clientHeight } });
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el || hasViewport) return;
    useEditor.getState().setViewport({ x: Math.round(el.clientWidth / 2), y: Math.round(el.clientHeight / 2), zoom: 1 });
  }, [pageId, hasViewport]);

  // Wheel must be a non-passive listener so pinch-zoom does not zoom the whole window.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      const s = useEditor.getState();
      const v = currentViewport(s);
      if (e.ctrlKey || e.metaKey) {
        const rect = el.getBoundingClientRect();
        zoomAt({ x: e.clientX - rect.left, y: e.clientY - rect.top }, v.zoom * Math.exp(-e.deltaY * 0.01));
      } else {
        const dx = e.shiftKey && e.deltaX === 0 ? e.deltaY : e.deltaX;
        const dy = e.shiftKey && e.deltaX === 0 ? 0 : e.deltaY;
        s.setViewport({ ...v, x: v.x - dx, y: v.y - dy });
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, []);

  useEffect(() => {
    const down = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      if (e.code !== "Space" || target?.closest("input, textarea, select, [contenteditable]")) return;
      e.preventDefault();
      if (!isSpaceHeld()) {
        setSpaceHeld(true);
        setPanning(true);
      }
    };
    const up = (e: KeyboardEvent) => {
      if (e.code !== "Space") return;
      setSpaceHeld(false);
      setPanning(false);
    };
    const blur = () => {
      setSpaceHeld(false);
      setPanning(false);
    };
    window.addEventListener("keydown", down);
    window.addEventListener("keyup", up);
    window.addEventListener("blur", blur);
    return () => {
      window.removeEventListener("keydown", down);
      window.removeEventListener("keyup", up);
      window.removeEventListener("blur", blur);
    };
  }, []);

  // Leaving the pen tool by any route keeps the path drawn so far.
  useEffect(() => {
    if (tool !== "pen") finishPen(false, false);
  }, [tool]);

  const cursor = panning || tool === "hand" ? "grab" : tool === "select" ? "var(--cursor-app)" : tool === "text" ? "text" : "crosshair";

  return (
    <div ref={containerRef} className="relative h-full w-full overflow-hidden" style={{ background, cursor }} data-testid="canvas">
      <svg
        className="absolute inset-0 h-full w-full touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {showGrid && <Grid x={viewport.x} y={viewport.y} zoom={viewport.zoom} />}
        <g data-scene transform={`translate(${viewport.x} ${viewport.y}) scale(${viewport.zoom})`}>
          {children.map((id) => (
            <NodeView key={id} id={id} />
          ))}
        </g>
        <Overlay />
      </svg>
      {children.length === 0 && tool === "select" && <EmptyHint />}
      <TextEditor />
      <LabelEditor />
      <ContextMenu />
    </div>
  );
}
