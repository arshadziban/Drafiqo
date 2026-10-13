import { ChevronDown, ChevronRight, Download, LoaderCircle, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useCanvasUi } from "../canvas/uiStore";
import { MANY_LAYERS, TOO_MANY_LAYERS, closeFigmaImport, runFigmaImport, type FigmaImportState } from "../figma/importFigma";
import type { FigPageSummary } from "../figma/figWorker";

// Figma files can be enormous (a design system runs to hundreds of thousands of
// layers), so an import starts by choosing: pages, and the frames on them.

const TYPE_NAMES: Record<string, string> = { FRAME: "Frame", SYMBOL: "Component", INSTANCE: "Instance", SECTION: "Section", TEXT: "Text", VECTOR: "Vector", COMPONENT_SET: "Component set" };
const typeName = (type: string) => TYPE_NAMES[type] ?? type.charAt(0) + type.slice(1).toLowerCase().replace(/_/g, " ");

/** A page is small enough to offer whole when it stays under the comfortable limit. */
const initialChoice = (pages: FigPageSummary[]): Set<string> => {
  const chosen = new Set<string>();
  let total = 0;
  for (const page of pages) {
    const size = page.layers.reduce((sum, layer) => sum + layer.layers, 0);
    if (total + size > MANY_LAYERS) continue;
    total += size;
    page.layers.forEach((layer) => chosen.add(layer.key));
  }
  return chosen;
};

function Chooser({ state }: { state: Extract<FigmaImportState, { pages: FigPageSummary[] }> }) {
  const { pages } = state;
  const [chosen, setChosen] = useState(() => initialChoice(pages));
  const [open, setOpen] = useState<Record<string, boolean>>(() => Object.fromEntries(pages.map((page, i) => [page.key, i === 0 || pages.length <= 2])));
  const total = useMemo(() => pages.reduce((sum, page) => sum + page.layers.reduce((s, layer) => s + (chosen.has(layer.key) ? layer.layers : 0), 0), 0), [pages, chosen]);
  const importing = state.status === "importing";

  const toggle = (keys: string[], on: boolean) =>
    setChosen((current) => {
      const next = new Set(current);
      for (const key of keys) (on ? next.add(key) : next.delete(key));
      return next;
    });

  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-2 py-2" data-testid="figma-layers">
        {pages.map((page) => {
          const keys = page.layers.map((layer) => layer.key);
          const picked = keys.filter((key) => chosen.has(key)).length;
          const size = page.layers.reduce((sum, layer) => sum + layer.layers, 0);
          return (
            <section key={page.key} aria-label={page.name}>
              <div className="flex h-8 items-center gap-1.5 rounded-md px-1.5 hover:bg-ink-800">
                <button type="button" aria-label={open[page.key] ? `Collapse ${page.name}` : `Expand ${page.name}`} onClick={() => setOpen({ ...open, [page.key]: !open[page.key] })} className="flex h-5 w-5 items-center justify-center rounded text-ink-400 hover:text-ink-100">
                  {open[page.key] ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                </button>
                <label className="flex min-w-0 flex-1 items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-3.5 w-3.5 accent-accent"
                    aria-label={`Page ${page.name}`}
                    disabled={keys.length === 0}
                    checked={keys.length > 0 && picked === keys.length}
                    ref={(el) => {
                      if (el) el.indeterminate = picked > 0 && picked < keys.length;
                    }}
                    onChange={(e) => toggle(keys, e.target.checked)}
                  />
                  <span className="truncate font-semibold text-ink-100">{page.name}</span>
                </label>
                <span className="shrink-0 text-ink-400 tabular-nums">{size.toLocaleString()} layers</span>
              </div>
              {open[page.key] &&
                page.layers.map((layer) => (
                  <label key={layer.key} className="ml-7 flex h-7 items-center gap-2 rounded-md px-1.5 hover:bg-ink-800">
                    <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={chosen.has(layer.key)} onChange={(e) => toggle([layer.key], e.target.checked)} />
                    <span className="min-w-0 flex-1 truncate text-ink-100">{layer.name}</span>
                    <span className="shrink-0 text-ink-400">{typeName(layer.type)}</span>
                    <span className="w-16 shrink-0 text-right text-ink-400 tabular-nums">{layer.layers.toLocaleString()}</span>
                  </label>
                ))}
              {open[page.key] && page.layers.length === 0 && <p className="ml-7 px-1.5 py-1 text-ink-400">This page is empty.</p>}
            </section>
          );
        })}
      </div>
      <footer className="flex min-h-14 shrink-0 items-center gap-3 border-t border-ink-700 px-5 py-3">
        <div className="min-w-0 flex-1" role="status">
          {total > TOO_MANY_LAYERS ? (
            <p className="flex items-start gap-2 text-red-300">
              <TriangleAlert size={15} className="mt-px shrink-0" />
              {total.toLocaleString()} layers is more than can be imported at once ({TOO_MANY_LAYERS.toLocaleString()}). Choose fewer frames.
            </p>
          ) : total > MANY_LAYERS ? (
            <p className="flex items-start gap-2 text-amber-300">
              <TriangleAlert size={15} className="mt-px shrink-0" />
              {total.toLocaleString()} layers chosen. This many will make the canvas slow.
            </p>
          ) : (
            <p className="text-ink-400">{total === 0 ? "Choose what to import." : `${total.toLocaleString()} layers chosen. They are added as new pages.`}</p>
          )}
        </div>
        <button type="button" onClick={closeFigmaImport} className="h-8 shrink-0 rounded-md px-3.5 font-medium text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
          Cancel
        </button>
        <button
          type="button"
          disabled={total === 0 || total > TOO_MANY_LAYERS || importing}
          onClick={() => void runFigmaImport(new Map(pages.map((page) => [page.key, page.layers.filter((layer) => chosen.has(layer.key)).map((layer) => layer.key)])))}
          className="flex h-8 shrink-0 items-center gap-2 rounded-md bg-accent px-4 font-semibold text-white transition-colors duration-100 hover:bg-accent-hover disabled:bg-ink-700 disabled:text-ink-400"
        >
          {importing ? <LoaderCircle size={14} className="animate-spin" /> : <Download size={14} />}
          {importing ? "Importing…" : "Import"}
        </button>
      </footer>
    </>
  );
}

export function FigmaImportDialog() {
  const state = useCanvasUi((s) => s.figmaImport);
  const open = state !== null;
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") closeFigmaImport();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!state) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]" onPointerDown={(e) => e.target === e.currentTarget && closeFigmaImport()}>
      <div role="dialog" aria-modal aria-label="Import Figma file" className="flex max-h-[86vh] w-[560px] max-w-[96vw] animate-pop flex-col overflow-hidden rounded-xl bg-ink-900 shadow-popover ring-1 ring-white/[0.07]">
        <header className="flex h-12 shrink-0 items-center justify-between border-b border-ink-700 pr-2.5 pl-5">
          <h2 className="flex min-w-0 items-baseline gap-2 text-[13px] font-semibold text-ink-100">
            Import from Figma
            <span className="truncate text-[12px] font-normal text-ink-400">{state.fileName}</span>
          </h2>
          <button type="button" aria-label="Close" onClick={closeFigmaImport} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 hover:bg-ink-700 hover:text-ink-100">
            <X size={15} />
          </button>
        </header>
        {state.status === "reading" ? (
          <p className="flex items-center gap-2.5 px-5 py-8 text-ink-300" role="status">
            <LoaderCircle size={15} className="animate-spin" />
            Reading the file… a large one takes a few seconds.
          </p>
        ) : state.status === "failed" ? (
          <p className="flex items-start gap-2 px-5 py-8 text-red-300" role="alert">
            <TriangleAlert size={15} className="mt-px shrink-0" />
            {state.message}
          </p>
        ) : (
          <Chooser state={state} />
        )}
      </div>
    </div>
  );
}
