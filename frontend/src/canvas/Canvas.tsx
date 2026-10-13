import { importFigmaFile, isFigmaFile } from "../figma/importFigma";
import { memo, useEffect, useRef, useState } from "react";
import type { NodeId } from "../document/types";
import { zoomAt } from "../editor/actions";
import { placeImageFiles } from "../editor/images";
import { currentPage, currentViewport, useEditor, type Viewport } from "../editor/store";
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

/** The artwork is painted this far beyond the window on every side, so a pan has something to bring in. */
const MARGIN = 256;
/** How long after the last pan or zoom step the artwork is painted afresh. */
const SETTLE_MS = 120;

/**
 * The view the artwork was last painted for. Repainting thousands of layers on
 * every step of a pan or zoom is what makes a large page stutter, so while the
 * view is moving the painted picture is slid and scaled instead (which costs
 * nothing), and painted properly once the view comes to rest.
 */
function usePaintedViewport(live: Viewport, size: { width: number; height: number }): { painted: Viewport; transform: string | undefined } {
  const [settled, setSettled] = useState(live);
  const k = live.zoom / settled.zoom;
  const dx = live.x - settled.x * k;
  const dy = live.y - settled.y * k;
  // Usable while the picture still covers the window and is not stretched into a blur.
  const covers = (offset: number, length: number) => offset - MARGIN * k <= 0 && offset + (length + MARGIN) * k >= length;
  const usable = k >= 0.5 && k <= 2 && covers(dx, size.width) && covers(dy, size.height);
  useEffect(() => {
    if (settled === live) return;
    if (!usable) return setSettled(live);
    const timer = window.setTimeout(() => setSettled(live), SETTLE_MS);
    return () => window.clearTimeout(timer);
  }, [live, settled, usable]);
  if (!usable || settled === live) return { painted: usable ? settled : live, transform: undefined };
  return { painted: settled, transform: `translate(${dx}px, ${dy}px) scale(${k})` };
}

/** The artwork itself. Redrawn only when the layers or the painted view change, not on every pan step. */
const Scene = memo(function Scene({ ids, viewport, transform }: { ids: readonly NodeId[]; viewport: Viewport; transform: string | undefined }) {
  return (
    <svg
      className="absolute"
      style={{ left: -MARGIN, top: -MARGIN, width: `calc(100% + ${MARGIN * 2}px)`, height: `calc(100% + ${MARGIN * 2}px)`, transformOrigin: `${MARGIN}px ${MARGIN}px`, transform, willChange: "transform" }}
    >
      <g data-scene transform={`translate(${viewport.x + MARGIN} ${viewport.y + MARGIN}) scale(${viewport.zoom})`}>
        {ids.map((id) => (
          <NodeView key={id} id={id} />
        ))}
      </g>
    </svg>
  );
});

export function Canvas() {
  const containerRef = useRef<HTMLDivElement>(null);
  const background = useEditor((s) => currentPage(s).background);
  const children = useEditor((s) => currentPage(s).children);
  const pageId = useEditor((s) => s.pageId);
  const viewport = useEditor(currentViewport);
  const hasViewport = useEditor((s) => s.pageId in s.viewports);
  const tool = useEditor((s) => s.tool);
  const showGrid = useEditor((s) => s.showGrid);
  const canvasSize = useEditor((s) => s.canvasSize);
  const { painted, transform } = usePaintedViewport(viewport, canvasSize);
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
        const files = [...e.dataTransfer.files];
        // A Figma file is imported; anything else is placed as a picture.
        const figma = files.find(isFigmaFile);
        if (figma) return void importFigmaFile(figma);
        const box = e.currentTarget.getBoundingClientRect();
        void placeImageFiles(files, { x: e.clientX - box.left, y: e.clientY - box.top });
      }}
    >
      {/* Three layers: the grid, the artwork, and the selection chrome. Each repaints without the others. */}
      <div
        className="absolute inset-0 touch-none"
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
      >
        {showGrid && (
          <svg className="pointer-events-none absolute inset-0 h-full w-full">
            <Grid x={viewport.x} y={viewport.y} zoom={viewport.zoom} />
          </svg>
        )}
        <Scene ids={children} viewport={painted} transform={transform} />
        <svg className="pointer-events-none absolute inset-0 h-full w-full">
          <Overlay />
        </svg>
      </div>
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
