import { useEffect, useRef, useState } from "react";
import { zoomAt } from "../editor/actions";
import { placeImageFiles } from "../editor/images";
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
  const [dropping, setDropping] = useState(false);

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

    // WebKit (the desktop build on macOS) reports a trackpad pinch as gesture events, not as Ctrl+wheel.
    type PinchEvent = Event & { scale: number; clientX: number; clientY: number };
    let pinchFrom = 1;
    const onPinchStart = (e: Event) => {
      e.preventDefault();
      pinchFrom = currentViewport(useEditor.getState()).zoom;
    };
    const onPinch = (e: Event) => {
      e.preventDefault();
      const pinch = e as PinchEvent;
      const rect = el.getBoundingClientRect();
      zoomAt({ x: pinch.clientX - rect.left, y: pinch.clientY - rect.top }, pinchFrom * pinch.scale);
    };
    el.addEventListener("gesturestart", onPinchStart);
    el.addEventListener("gesturechange", onPinch);
    el.addEventListener("gestureend", onPinch);
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("gesturestart", onPinchStart);
      el.removeEventListener("gesturechange", onPinch);
      el.removeEventListener("gestureend", onPinch);
    };
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

  const cursor = panning || tool === "hand" ? "grab" : tool === "select" || tool === "scale" ? "var(--cursor-app)" : tool === "text" ? "text" : "crosshair";

  return (
    <div
      ref={containerRef}
      className="relative h-full w-full overflow-hidden"
      style={{ background, cursor }}
      data-testid="canvas"
      // Picture files dropped here are placed where they land.
      onDragOver={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "copy";
        setDropping(true);
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node | null)) setDropping(false);
      }}
      onDrop={(e) => {
        if (!e.dataTransfer.types.includes("Files")) return;
        e.preventDefault();
        setDropping(false);
        const box = e.currentTarget.getBoundingClientRect();
        void placeImageFiles([...e.dataTransfer.files], { x: e.clientX - box.left, y: e.clientY - box.top });
      }}
    >
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
      <TextEditor />
      <LabelEditor />
      <ContextMenu />
      {dropping && (
        <div data-testid="drop-hint" className="pointer-events-none absolute inset-2 flex items-center justify-center rounded-xl border-2 border-dashed border-accent bg-accent/10">
          <span className="rounded-md bg-ink-950/90 px-3 py-1.5 font-medium text-ink-100 shadow-lg">Drop to place image</span>
        </div>
      )}
    </div>
  );
}
