import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { rasterizeSvg } from "../export/rasterExport";
import { renderViewSvg } from "../export/exportRenderer";
import { currentPage, currentViewport, useEditor } from "../editor/store";
import { pixelHex } from "./color";

// Figma-style eyedropper. The webview's own EyeDropper API cannot be used: the
// desktop webview cancels it immediately. Instead the visible canvas is drawn
// to pixels once, and a full-window overlay shows a magnifier loupe over it.
// Click picks the pixel under the pointer, Escape or right-click cancels.

export interface CanvasCapture {
  data: ImageData;
  /** Capture pixels per CSS pixel. */
  scale: number;
  /** Where the canvas sits in the window. */
  rect: DOMRect;
}

/** Draws what the canvas currently shows (page background, shapes, text) to pixels. */
export async function captureCanvas(): Promise<CanvasCapture | null> {
  const el = document.querySelector<HTMLElement>('[data-testid="canvas"]');
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  if (rect.width < 1 || rect.height < 1) return null;
  const s = useEditor.getState();
  const page = currentPage(s);
  const viewport = currentViewport(s);
  const scale = Math.min(window.devicePixelRatio || 1, 2);
  const size = { width: Math.max(1, Math.round(rect.width * scale)), height: Math.max(1, Math.round(rect.height * scale)) };
  const view = { x: -viewport.x / viewport.zoom, y: -viewport.y / viewport.zoom, width: rect.width / viewport.zoom, height: rect.height / viewport.zoom };
  try {
    const surface = await rasterizeSvg(renderViewSvg(page, view, size, page.background), size, null);
    return { data: surface.getImageData(), scale, rect };
  } catch {
    return null;
  }
}

const GRID = 11; // source pixels across the loupe
const CELL = 10; // loupe pixels per source pixel
const LOUPE = GRID * CELL;
const OFF_CANVAS = [24, 25, 28];

export function Eyedropper({ capture, onPick, onCancel }: { capture: CanvasCapture; onPick: (hex: string) => void; onCancel: () => void }) {
  const [point, setPoint] = useState<{ x: number; y: number } | null>(null);
  const loupe = useRef<HTMLCanvasElement>(null);
  const frame = useRef(0);
  const tile = useMemo(() => {
    const c = document.createElement("canvas");
    c.width = GRID;
    c.height = GRID;
    return c;
  }, []);

  const { data, scale, rect } = capture;
  const pixel = (p: { x: number; y: number }) => ({ x: Math.floor((p.x - rect.left) * scale), y: Math.floor((p.y - rect.top) * scale) });
  const hex = point ? pixelHex(data.data, data.width, data.height, pixel(point).x, pixel(point).y) : null;

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      e.stopPropagation();
      onCancel();
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      cancelAnimationFrame(frame.current);
    };
  }, [onCancel]);

  // Magnified pixels around the pointer, with a grid and the centre pixel outlined.
  useEffect(() => {
    const canvas = loupe.current;
    const ctx = canvas?.getContext("2d");
    const tileCtx = tile.getContext("2d");
    if (!canvas || !ctx || !tileCtx || !point || !hex) return;
    const { x: cx, y: cy } = pixel(point);
    const half = Math.floor(GRID / 2);
    const image = tileCtx.createImageData(GRID, GRID);
    for (let j = 0; j < GRID; j++) {
      for (let i = 0; i < GRID; i++) {
        const sx = cx - half + i;
        const sy = cy - half + j;
        const inside = sx >= 0 && sy >= 0 && sx < data.width && sy < data.height;
        const from = (sy * data.width + sx) * 4;
        const to = (j * GRID + i) * 4;
        for (let k = 0; k < 3; k++) image.data[to + k] = inside ? data.data[from + k]! : OFF_CANVAS[k]!;
        image.data[to + 3] = 255;
      }
    }
    tileCtx.putImageData(image, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.drawImage(tile, 0, 0, LOUPE, LOUPE);
    ctx.strokeStyle = "rgba(0,0,0,0.16)";
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let n = 1; n < GRID; n++) {
      ctx.moveTo(n * CELL + 0.5, 0);
      ctx.lineTo(n * CELL + 0.5, LOUPE);
      ctx.moveTo(0, n * CELL + 0.5);
      ctx.lineTo(LOUPE, n * CELL + 0.5);
    }
    ctx.stroke();
    const mid = half * CELL;
    ctx.strokeStyle = "#000";
    ctx.lineWidth = 2;
    ctx.strokeRect(mid + 1, mid + 1, CELL - 2, CELL - 2);
    ctx.strokeStyle = "#fff";
    ctx.lineWidth = 1;
    ctx.strokeRect(mid + 0.5, mid + 0.5, CELL - 1, CELL - 1);
  }, [point, hex, data, tile]);

  return createPortal(
    <div
      data-eyedropper
      className="fixed inset-0 z-[70]"
      style={{ cursor: hex ? "none" : "default" }}
      onPointerMove={(e) => {
        const { clientX: x, clientY: y } = e;
        cancelAnimationFrame(frame.current);
        frame.current = requestAnimationFrame(() => setPoint({ x, y }));
      }}
      onPointerLeave={() => setPoint(null)}
      onClick={() => hex && onPick(hex)}
      onContextMenu={(e) => {
        e.preventDefault();
        onCancel();
      }}
    >
      {point && hex && (
        <div className="pointer-events-none absolute" style={{ left: point.x - LOUPE / 2 - 3, top: point.y - LOUPE / 2 - 3 }}>
          <div className="overflow-hidden rounded-full border-[3px] border-white bg-ink-950 shadow-[0_0_0_1px_rgb(0_0_0/0.45),0_6px_18px_rgb(0_0_0/0.5)]" style={{ width: LOUPE + 6, height: LOUPE + 6 }}>
            <canvas ref={loupe} width={LOUPE} height={LOUPE} />
          </div>
          <div className="absolute top-full left-1/2 mt-2 flex -translate-x-1/2 items-center gap-1.5 rounded-md bg-ink-950/95 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-ink-100 shadow-lg ring-1 ring-white/10">
            <span className="h-3 w-3 rounded-[3px] ring-1 ring-white/30" style={{ background: hex }} />
            {hex.toUpperCase()}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );
}
