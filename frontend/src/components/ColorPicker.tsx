import { Pipette, X } from "lucide-react";
import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent, type PointerEvent as ReactPointerEvent } from "react";
import { createPortal } from "react-dom";
import { useEditor } from "../editor/store";
import { hexToHsv, hsvToHex, hsvToRgb, normalizeHex, rgbToHsv, type Hsv } from "./color";
import { captureCanvas, Eyedropper, type CanvasCapture } from "./Eyedropper";
import { Select } from "./Select";

// Figma-style colour popover: saturation/brightness area, hue slider,
// eyedropper, Hex / RGB / HSB fields and recently used colours. It edits the
// colour through `onChange`, wrapped in one history transaction per gesture.

const WIDTH = 240;
const GAP = 8;
const RECENT_KEY = "drafiqo.recentColors";
const RECENT_MAX = 10;
const HUE_GRADIENT = "linear-gradient(to right,#f00,#ff0,#0f0,#0ff,#00f,#f0f,#f00)";

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n));

let recentColors: string[] | null = null;

function readRecent(): string[] {
  if (recentColors) return recentColors;
  try {
    const parsed: unknown = JSON.parse(localStorage.getItem(RECENT_KEY) ?? "[]");
    recentColors = Array.isArray(parsed) ? parsed.filter((c): c is string => typeof c === "string" && normalizeHex(c) !== null).slice(0, RECENT_MAX) : [];
  } catch {
    recentColors = [];
  }
  return recentColors;
}

function pushRecent(hex: string) {
  recentColors = [hex, ...readRecent().filter((c) => c !== hex)].slice(0, RECENT_MAX);
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(recentColors));
  } catch {
    // Storage can be unavailable; the list then lasts for the session only.
  }
}

/** Pointer-capture drag that reports a 0–1 position inside `e.currentTarget`. */
function startDrag(e: ReactPointerEvent<HTMLElement>, move: (x: number, y: number) => void) {
  const el = e.currentTarget;
  el.setPointerCapture(e.pointerId);
  const report = (ev: { clientX: number; clientY: number }) => {
    const r = el.getBoundingClientRect();
    move(clamp((ev.clientX - r.left) / r.width, 0, 1), clamp((ev.clientY - r.top) / r.height, 0, 1));
  };
  const end = () => {
    el.removeEventListener("pointermove", report);
    el.removeEventListener("pointerup", end);
    el.removeEventListener("pointercancel", end);
    useEditor.getState().commit();
  };
  report(e);
  el.addEventListener("pointermove", report);
  el.addEventListener("pointerup", end);
  el.addEventListener("pointercancel", end);
}

function ChannelInput({ label, title, value, min, max, onCommit }: { label: string; title: string; value: number; min: number; max: number; onCommit: (n: number) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const commit = (text: string) => {
    setDraft(null);
    const n = Number.parseFloat(text);
    if (Number.isFinite(n) && Math.round(clamp(n, min, max)) !== value) onCommit(Math.round(clamp(n, min, max)));
  };
  return (
    <label className="flex min-w-0 flex-1 flex-col items-center gap-1">
      <input
        aria-label={title}
        className="h-7 w-full min-w-0 rounded-md border border-transparent bg-ink-800 px-1 text-center text-ink-100 transition-colors duration-100 outline-none hover:border-ink-600 focus:border-accent focus:bg-ink-950"
        value={draft ?? String(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
            e.stopPropagation();
          } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
            e.preventDefault();
            onCommit(clamp(value + (e.key === "ArrowUp" ? 1 : -1) * (e.shiftKey ? 10 : 1), min, max));
          }
        }}
      />
      <span className="text-[10px] text-ink-400">{label}</span>
    </label>
  );
}

type Mode = "hex" | "rgb" | "hsb";

export function ColorPicker({ anchor, value, label, onChange, onClose, onPickImage }: { anchor: HTMLElement; value: string; label: string; onChange: (hex: string) => void; onClose: () => void; onPickImage?: () => void }) {
  const popRef = useRef<HTMLDivElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const [mode, setMode] = useState<Mode>("hex");
  const [hsv, setHsvState] = useState<Hsv>(() => hexToHsv(value));
  const [hexDraft, setHexDraft] = useState<string | null>(null);
  const [sampling, setSampling] = useState<CanvasCapture | null>(null);
  const samplingRef = useRef(false);
  const dragFrom = useRef<{ px: number; py: number; left: number; top: number } | null>(null);
  const hsvRef = useRef(hsv);
  const valueRef = useRef(value);
  const startValue = useRef(value);
  valueRef.current = value;

  const setHsv = (next: Hsv) => {
    hsvRef.current = next;
    setHsvState(next);
  };

  // Follow outside changes (undo, another field) without losing the hue the user picked.
  useEffect(() => {
    if (hsvToHex(hsvRef.current) !== value) setHsv(hexToHsv(value));
  }, [value]);

  const apply = (next: Hsv) => {
    setHsv(next);
    const hex = hsvToHex(next);
    if (hex === valueRef.current) return;
    useEditor.getState().begin();
    onChange(hex);
  };

  const applyHex = (hex: string) => {
    setHsv(hexToHsv(hex));
    if (hex === valueRef.current) return;
    useEditor.getState().begin();
    onChange(hex);
    useEditor.getState().commit();
  };

  // Beside the properties panel when opened from it; otherwise under the swatch
  // (above it when there is no room). Always kept inside the window.
  useLayoutEffect(() => {
    const pop = popRef.current;
    if (!pop) return;
    const a = anchor.getBoundingClientRect();
    const panel = anchor.closest("aside")?.getBoundingClientRect();
    const height = pop.offsetHeight;
    if (panel) {
      let left = panel.left - WIDTH - GAP;
      if (left < GAP) left = Math.min(a.right + GAP, window.innerWidth - WIDTH - GAP);
      setPos({ left, top: clamp(a.top - 8, GAP, Math.max(GAP, window.innerHeight - height - GAP)) });
      return;
    }
    const below = a.bottom + 6;
    const top = below + height <= window.innerHeight - GAP ? below : Math.max(GAP, a.top - height - 6);
    setPos({ left: clamp(a.left, GAP, window.innerWidth - WIDTH - GAP), top });
  }, [anchor]);

  // Close on outside press, Escape or resize; finish the history step and remember the colour.
  useEffect(() => {
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (samplingRef.current || (t instanceof Element && t.closest("[data-eyedropper], [data-select-menu]"))) return;
      if (!popRef.current?.contains(t) && !anchor.contains(t)) onClose();
    };
    // Captured so Escape closes only the picker and doesn't also clear the canvas selection.
    const onKey = (e: globalThis.KeyboardEvent) => {
      // Escape belongs to an open dropdown or eyedropper first.
      if (e.key !== "Escape" || samplingRef.current || document.querySelector("[data-select-menu]")) return;
      e.stopPropagation();
      onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey, true);
    window.addEventListener("resize", onClose);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey, true);
      window.removeEventListener("resize", onClose);
      useEditor.getState().commit();
      if (valueRef.current !== startValue.current) pushRecent(valueRef.current);
    };
  }, [anchor, onClose]);

  const hex = hsvToHex(hsv);
  const rgb = hsvToRgb(hsv);
  const pure = hsvToHex({ h: hsv.h, s: 1, v: 1 });
  const endSampling = () => {
    samplingRef.current = false;
    setSampling(null);
  };

  const startSampling = async () => {
    if (samplingRef.current) return;
    samplingRef.current = true;
    const capture = await captureCanvas();
    if (!capture) {
      samplingRef.current = false;
      return;
    }
    setSampling(capture);
  };

  const areaKeys = (e: KeyboardEvent) => {
    const step = e.shiftKey ? 0.1 : 0.01;
    const dx = e.key === "ArrowRight" ? step : e.key === "ArrowLeft" ? -step : 0;
    const dy = e.key === "ArrowUp" ? step : e.key === "ArrowDown" ? -step : 0;
    if (!dx && !dy) return;
    e.preventDefault();
    apply({ ...hsv, s: clamp(hsv.s + dx, 0, 1), v: clamp(hsv.v + dy, 0, 1) });
    useEditor.getState().commit();
  };

  const hueKeys = (e: KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowUp" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowDown" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    apply({ ...hsv, h: clamp(hsv.h + d * (e.shiftKey ? 10 : 1), 0, 359.99) });
    useEditor.getState().commit();
  };

  const setRgb = (patch: Partial<typeof rgb>) => {
    const next = { ...rgb, ...patch };
    const converted = rgbToHsv(next);
    // Keep the hue when the colour has none (greys), so the slider doesn't jump to red.
    apply({ ...converted, h: converted.s === 0 ? hsv.h : converted.h });
    useEditor.getState().commit();
  };

  const recent = readRecent().filter((c) => c !== hex).slice(0, RECENT_MAX);

  const popover = createPortal(
    <div
      ref={popRef}
      role="dialog"
      aria-label={`${label} colour picker`}
      className="fixed z-[60] animate-pop rounded-xl bg-ink-850 shadow-popover"
      style={{ width: WIDTH, left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
      onKeyDown={(e) => {
        // Keys typed here must not reach the editor shortcuts; Escape closes the popover.
        e.stopPropagation();
        if (e.key === "Escape") onClose();
      }}
    >
      <header
        className="flex h-9 cursor-grab touch-none items-center justify-between border-b border-ink-700 pr-1.5 pl-3 select-none active:cursor-grabbing"
        onPointerDown={(e) => {
          // The title bar moves the picker; its buttons keep their own behaviour.
          if (!pos || (e.target as Element).closest("button")) return;
          e.currentTarget.setPointerCapture(e.pointerId);
          dragFrom.current = { px: e.clientX, py: e.clientY, left: pos.left, top: pos.top };
        }}
        onPointerMove={(e) => {
          const from = dragFrom.current;
          const pop = popRef.current;
          if (!from || !pop) return;
          setPos({
            left: clamp(from.left + e.clientX - from.px, GAP, Math.max(GAP, window.innerWidth - WIDTH - GAP)),
            top: clamp(from.top + e.clientY - from.py, GAP, Math.max(GAP, window.innerHeight - pop.offsetHeight - GAP)),
          });
        }}
        onPointerUp={() => (dragFrom.current = null)}
        onPointerCancel={() => (dragFrom.current = null)}
      >
        <h3 className="font-semibold text-ink-100">{label}</h3>
        <button type="button" aria-label="Close colour picker" onClick={onClose} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
          <X size={14} strokeWidth={1.75} />
        </button>
      </header>

      <div className="flex flex-col gap-3 p-3">
        {onPickImage && (
          // A fill is either a colour or a picture: choosing Image closes the picker and asks for the file.
          <div role="group" aria-label="Fill type" className="flex rounded-lg bg-ink-800 p-0.5">
            <button type="button" aria-pressed className="h-6 flex-1 rounded-md bg-ink-600 font-medium text-white shadow-sm shadow-black/30">
              Color
            </button>
            <button
              type="button"
              aria-pressed={false}
              onClick={() => {
                onClose();
                onPickImage();
              }}
              className="h-6 flex-1 rounded-md font-medium text-ink-300 transition-colors duration-100 hover:text-ink-100"
            >
              Image
            </button>
          </div>
        )}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Saturation and brightness"
          aria-valuetext={`Saturation ${Math.round(hsv.s * 100)}%, brightness ${Math.round(hsv.v * 100)}%`}
          aria-valuenow={Math.round(hsv.s * 100)}
          className="relative h-36 w-full cursor-crosshair touch-none rounded-md outline-none focus-visible:ring-2 focus-visible:ring-accent"
          style={{ background: `linear-gradient(to top,#000,transparent),linear-gradient(to right,#fff,${pure})` }}
          onPointerDown={(e) => startDrag(e, (x, y) => apply({ ...hsvRef.current, s: x, v: 1 - y }))}
          onKeyDown={areaKeys}
        >
          <span
            className="pointer-events-none absolute h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.5)]"
            style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: hex }}
          />
        </div>

        <div className="flex items-center gap-2.5">
          <button type="button" aria-label="Pick colour from canvas" data-tip="Pick colour from canvas" onClick={() => void startSampling()} className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
            <Pipette size={14} strokeWidth={1.75} />
          </button>
          <span aria-hidden className="h-7 w-7 shrink-0 rounded-full ring-1 ring-white/20" style={{ background: hex }} />
          <div
            role="slider"
            tabIndex={0}
            aria-label="Hue"
            aria-valuemin={0}
            aria-valuemax={360}
            aria-valuenow={Math.round(hsv.h)}
            className="relative h-3 min-w-0 flex-1 cursor-pointer touch-none rounded-full outline-none focus-visible:ring-2 focus-visible:ring-accent"
            style={{ background: HUE_GRADIENT }}
            onPointerDown={(e) => startDrag(e, (x) => apply({ ...hsvRef.current, h: Math.min(x * 360, 359.99) }))}
            onKeyDown={hueKeys}
          >
            <span className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-white shadow-[0_0_0_1px_rgb(0_0_0/0.35),0_1px_3px_rgb(0_0_0/0.5)]" style={{ left: `${(hsv.h / 360) * 100}%`, background: pure }} />
          </div>
        </div>

        <div className="flex items-start gap-1.5">
          <div className="w-[4.5rem] shrink-0">
            <Select
              label="Colour format"
              value={mode}
              menuMinWidth={96}
              options={[
                { value: "hex", label: "Hex" },
                { value: "rgb", label: "RGB" },
                { value: "hsb", label: "HSB" },
              ]}
              onChange={setMode}
            />
          </div>
          {mode === "hex" && (
            <label className="flex min-w-0 flex-1 flex-col items-center gap-1">
              <input
                aria-label="Hex value"
                className="h-7 w-full min-w-0 rounded-md border border-transparent bg-ink-800 px-2 text-ink-100 uppercase transition-colors duration-100 outline-none hover:border-ink-600 focus:border-accent focus:bg-ink-950"
                value={hexDraft ?? hex.slice(1)}
                maxLength={7}
                onFocus={(e) => e.target.select()}
                onChange={(e) => setHexDraft(e.target.value)}
                onBlur={(e) => {
                  if (hexDraft === null) return;
                  const parsed = normalizeHex(e.target.value);
                  setHexDraft(null);
                  if (parsed) applyHex(parsed);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") e.currentTarget.blur();
                  else if (e.key === "Escape") {
                    setHexDraft(null);
                    e.currentTarget.blur();
                    e.stopPropagation();
                  }
                }}
              />
              <span className="text-[10px] text-ink-400">Hex</span>
            </label>
          )}
          {mode === "rgb" && (
            <>
              <ChannelInput label="R" title="Red" value={rgb.r} min={0} max={255} onCommit={(r) => setRgb({ r })} />
              <ChannelInput label="G" title="Green" value={rgb.g} min={0} max={255} onCommit={(g) => setRgb({ g })} />
              <ChannelInput label="B" title="Blue" value={rgb.b} min={0} max={255} onCommit={(b) => setRgb({ b })} />
            </>
          )}
          {mode === "hsb" && (
            <>
              <ChannelInput label="H" title="Hue" value={Math.round(hsv.h)} min={0} max={359} onCommit={(h) => { apply({ ...hsv, h }); useEditor.getState().commit(); }} />
              <ChannelInput label="S" title="Saturation" value={Math.round(hsv.s * 100)} min={0} max={100} onCommit={(s) => { apply({ ...hsv, s: s / 100 }); useEditor.getState().commit(); }} />
              <ChannelInput label="B" title="Brightness" value={Math.round(hsv.v * 100)} min={0} max={100} onCommit={(v) => { apply({ ...hsv, v: v / 100 }); useEditor.getState().commit(); }} />
            </>
          )}
        </div>
      </div>

      {recent.length > 0 && (
        <div className="border-t border-ink-700 px-3 pt-2.5 pb-3">
          <div className="mb-2 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">Recent</div>
          <div className="flex flex-wrap gap-1.5">
            {recent.map((c) => (
              <button key={c} type="button" aria-label={`Use ${c}`} data-tip={c.toUpperCase()} onClick={() => applyHex(c)} className="h-5 w-5 rounded-[5px] ring-1 ring-white/20 transition-transform duration-100 hover:scale-110" style={{ background: c }} />
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  );

  return (
    <>
      {popover}
      {sampling && (
        <Eyedropper
          capture={sampling}
          onCancel={endSampling}
          onPick={(picked) => {
            endSampling();
            applyHex(picked);
          }}
        />
      )}
    </>
  );
}
