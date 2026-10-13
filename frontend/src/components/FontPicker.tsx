import { Check, ChevronDown, Search } from "lucide-react";
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";
import { fontStack } from "../canvas/renderNode";
import { COMMON_FAMILIES, GOOGLE_FAMILIES, installedFamilies } from "../fonts/fontLibrary";
import type { Mixed } from "./ui";

// The typeface picker: every font installed on this computer and the whole
// Google Fonts catalogue, a couple of thousand names in all. So it searches as
// you type, and only draws the rows that are in view.

type Row = { heading: string } | { family: string; installed: boolean };

const ROW = 28;
const LIST_HEIGHT = ROW * 10;
const WIDTH = 248;
const GAP = 4;
const EDGE = 8;

export function FontPicker({ value, onChange }: { value: string | Mixed; onChange: (family: string) => void }) {
  const trigger = useRef<HTMLButtonElement>(null);
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(-1);
  const [scrollTop, setScrollTop] = useState(0);
  const [installed, setInstalled] = useState<readonly string[]>(COMMON_FAMILIES);
  const [place, setPlace] = useState<{ left: number; top?: number; bottom?: number } | null>(null);

  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
    setQuery("");
  }, []);

  useEffect(() => {
    if (!open) return;
    let current = true;
    void installedFamilies().then((families) => current && setInstalled(families));
    return () => {
      current = false;
    };
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const wanted = query.trim().toLowerCase();
    const matches = (family: string) => !wanted || family.toLowerCase().includes(wanted);
    const local = installed.filter(matches);
    const have = new Set(installed.map((family) => family.toLowerCase()));
    const google = GOOGLE_FAMILIES.filter((family) => matches(family) && !have.has(family.toLowerCase()));
    return [
      ...(local.length > 0 ? [{ heading: "Installed" }, ...local.map((family) => ({ family, installed: true }))] : []),
      ...(google.length > 0 ? [{ heading: "Google Fonts" }, ...google.map((family) => ({ family, installed: false }))] : []),
    ];
  }, [installed, query]);

  /** The nearest font row from `index` going `step` rows at a time (headings are skipped). */
  const fontRow = (index: number, step: 1 | -1) => {
    for (let i = index; i >= 0 && i < rows.length; i += step) if ("family" in rows[i]!) return i;
    return -1;
  };

  // Opening, and every new search, starts at the current font if it is listed, else at the first match.
  useLayoutEffect(() => {
    if (!open) return;
    const current = rows.findIndex((row) => "family" in row && row.family === value);
    const start = current >= 0 ? current : fontRow(0, 1);
    setActive(start);
    const top = Math.max(0, start * ROW - LIST_HEIGHT / 2 + ROW / 2);
    if (list.current) list.current.scrollTop = top;
    setScrollTop(top);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, rows]);

  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const left = Math.max(EDGE, Math.min(r.left, window.innerWidth - WIDTH - EDGE));
    const height = LIST_HEIGHT + 48;
    if (window.innerHeight - r.bottom - GAP - EDGE >= height || r.top < height) setPlace({ left, top: r.bottom + GAP });
    else setPlace({ left, bottom: window.innerHeight - r.top + GAP });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!panel.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("resize", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("resize", close);
    };
  }, [open, close]);

  const choose = (index: number) => {
    const row = rows[index];
    if (!row || !("family" in row)) return;
    close();
    if (row.family !== value) onChange(row.family);
  };

  const move = (to: number) => {
    if (to < 0) return;
    setActive(to);
    const el = list.current;
    if (!el) return;
    if (to * ROW < el.scrollTop) el.scrollTop = to * ROW;
    else if ((to + 1) * ROW > el.scrollTop + el.clientHeight) el.scrollTop = (to + 1) * ROW - el.clientHeight;
  };

  const onKeyDown = (e: KeyboardEvent) => {
    // While the picker is open the keys belong to it, not to the editor's shortcuts.
    e.stopPropagation();
    if (e.key === "Escape") {
      close();
      trigger.current?.focus();
    } else if (e.key === "ArrowDown") move(fontRow(active + 1, 1));
    else if (e.key === "ArrowUp") move(fontRow(active - 1, -1));
    else if (e.key === "Enter") choose(active);
    else return;
    e.preventDefault();
  };

  const first = Math.max(0, Math.floor(scrollTop / ROW) - 4);
  const last = Math.min(rows.length, first + Math.ceil(LIST_HEIGHT / ROW) + 8);

  return (
    <>
      <button
        ref={trigger}
        type="button"
        aria-label="Font family"
        aria-haspopup="listbox"
        aria-expanded={open}
        data-tip={open ? undefined : "Font family"}
        onClick={() => (open ? close() : setOpen(true))}
        className={`flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border bg-ink-800 pr-1.5 pl-2 text-left text-ink-100 transition-colors duration-100 outline-none hover:border-ink-600 focus-visible:border-accent ${
          open ? "border-accent bg-ink-950" : "border-transparent"
        }`}
      >
        <span className="min-w-0 flex-1 truncate" style={value === "mixed" ? undefined : { fontFamily: fontStack(value) }}>
          {value === "mixed" ? "Mixed" : value}
        </span>
        <ChevronDown size={12} strokeWidth={2} className={`shrink-0 text-ink-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={panel}
            data-font-picker
            className="fixed z-[65] flex animate-pop flex-col rounded-lg bg-ink-850 shadow-popover"
            style={{ width: WIDTH, left: place?.left ?? 0, top: place?.top, bottom: place?.bottom, visibility: place ? "visible" : "hidden" }}
          >
            <label className="m-1.5 flex h-7 items-center gap-1.5 rounded-md border border-transparent bg-ink-800 px-2 focus-within:border-accent focus-within:bg-ink-950">
              <Search size={12} className="shrink-0 text-ink-400" />
              <input
                autoFocus
                aria-label="Search fonts"
                placeholder="Search fonts"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                onKeyDown={onKeyDown}
                className="w-full min-w-0 bg-transparent text-ink-100 outline-none placeholder:text-ink-400"
              />
            </label>
            <div ref={list} role="listbox" aria-label="Fonts" className="relative overflow-y-auto px-1 pb-1" style={{ height: Math.min(LIST_HEIGHT, Math.max(ROW, rows.length * ROW)) }} onScroll={(e) => setScrollTop(e.currentTarget.scrollTop)}>
              {rows.length === 0 && <p className="px-2 py-1.5 text-ink-400">No fonts match “{query.trim()}”.</p>}
              <div style={{ height: rows.length * ROW }}>
                {rows.slice(first, last).map((row, offset) => {
                  const index = first + offset;
                  const style = { top: index * ROW, height: ROW };
                  if ("heading" in row) {
                    return (
                      <div key={`h-${row.heading}`} style={style} className="absolute inset-x-1 flex items-end px-2 pb-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
                        {row.heading}
                      </div>
                    );
                  }
                  return (
                    <div
                      key={`${row.installed ? "i" : "g"}-${row.family}`}
                      role="option"
                      aria-selected={row.family === value}
                      style={style}
                      onPointerMove={() => active !== index && setActive(index)}
                      onClick={() => choose(index)}
                      className={`absolute inset-x-1 flex cursor-default items-center gap-2 rounded-md px-2 ${index === active ? "bg-accent text-white" : "text-ink-100"}`}
                    >
                      <span className="flex w-3 shrink-0 justify-center">{row.family === value && <Check size={12} strokeWidth={2.5} />}</span>
                      {/* Installed fonts show in their own face; a Google font is only fetched once it is chosen. */}
                      <span className="min-w-0 flex-1 truncate" style={row.installed ? { fontFamily: fontStack(row.family) } : undefined}>
                        {row.family}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
