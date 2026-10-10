import { Check, ChevronDown } from "lucide-react";
import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type KeyboardEvent } from "react";
import { createPortal } from "react-dom";

// A dropdown that matches the rest of the UI. The browser's native <select>
// list cannot be styled, so this draws its own: a trigger button and a list in
// a fixed layer (never clipped by a scrolling panel) that flips above the
// trigger when there is no room below. Keyboard: arrows, Home/End, Enter,
// Escape and type-to-find.

export interface SelectOption<T> {
  value: T;
  label: string;
  /** CSS font-family: shows the option in its own typeface (for font pickers). */
  fontFamily?: string;
}

const GAP = 4;
const EDGE = 8;
const MAX_HEIGHT = 288;

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
  menuMinWidth = 176,
}: {
  label: string;
  value: T | "mixed";
  options: readonly SelectOption<T>[];
  onChange: (value: T) => void;
  /** Narrow triggers still open a menu at least this wide. */
  menuMinWidth?: number;
}) {
  const id = useId();
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const typed = useRef({ text: "", at: 0 });
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [place, setPlace] = useState<{ left: number; width: number; top?: number; bottom?: number; maxHeight: number } | null>(null);

  const selected = options.findIndex((o) => o.value === value);
  const current = selected >= 0 ? options[selected] : undefined;
  const close = useCallback(() => {
    setOpen(false);
    setPlace(null);
  }, []);

  const openMenu = () => {
    setActive(Math.max(0, selected));
    setOpen(true);
  };

  const choose = (index: number) => {
    const option = options[index];
    close();
    trigger.current?.focus();
    if (option && option.value !== value) onChange(option.value);
  };

  // Place under the trigger (or above it when the space below is too small).
  useLayoutEffect(() => {
    if (!open || !trigger.current) return;
    const r = trigger.current.getBoundingClientRect();
    const width = Math.min(Math.max(r.width, menuMinWidth), window.innerWidth - EDGE * 2);
    let left = r.left;
    if (left + width > window.innerWidth - EDGE) left = r.right - width;
    left = Math.max(EDGE, left);
    const below = window.innerHeight - r.bottom - GAP - EDGE;
    const above = r.top - GAP - EDGE;
    const wanted = Math.min(MAX_HEIGHT, (menu.current?.scrollHeight ?? MAX_HEIGHT) + 2);
    if (below >= wanted || below >= above) setPlace({ left, width, top: r.bottom + GAP, maxHeight: Math.min(MAX_HEIGHT, below) });
    else setPlace({ left, width, bottom: window.innerHeight - r.top + GAP, maxHeight: Math.min(MAX_HEIGHT, above) });
  }, [open, menuMinWidth]);

  // Start with the current choice in view, in the middle of the list.
  useLayoutEffect(() => {
    if (open && place) menu.current?.querySelector<HTMLElement>(`[data-index="${Math.max(0, selected)}"]`)?.scrollIntoView({ block: "center" });
    // Only when the menu first appears.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [place === null]);

  useEffect(() => {
    if (open) menu.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  // Close on a press outside, on resize, or when something behind it scrolls.
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      const t = e.target as Node;
      if (!menu.current?.contains(t) && !trigger.current?.contains(t)) close();
    };
    const onScroll = (e: Event) => {
      if (!menu.current?.contains(e.target as Node)) close();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", close);
    window.addEventListener("blur", close);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("blur", close);
    };
  }, [open, close]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>) => {
    const key = e.key;
    if (!open) {
      if (key === "ArrowDown" || key === "ArrowUp" || key === "Enter" || key === " ") {
        e.preventDefault();
        e.stopPropagation();
        openMenu();
      }
      return;
    }
    // While the list is open the keys belong to it, not to the editor's shortcuts.
    if (key === "Tab") return close();
    e.stopPropagation();
    if (key === "Escape") return close();
    if (key === "ArrowDown") setActive((a) => Math.min(options.length - 1, a + 1));
    else if (key === "ArrowUp") setActive((a) => Math.max(0, a - 1));
    else if (key === "Home") setActive(0);
    else if (key === "End") setActive(options.length - 1);
    else if (key === "Enter" || key === " ") choose(active);
    else if (key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const now = Date.now();
      typed.current = { text: (now - typed.current.at < 700 ? typed.current.text : "") + key.toLowerCase(), at: now };
      const from = typed.current.text.length > 1 ? active : active + 1;
      const order = [...options.keys()].map((i) => (i + from) % options.length);
      const hit = order.find((i) => options[i]!.label.toLowerCase().startsWith(typed.current.text));
      if (hit !== undefined) setActive(hit);
    } else return;
    e.preventDefault();
  };

  const listId = `${id}-list`;
  return (
    <>
      <button
        ref={trigger}
        type="button"
        role="combobox"
        aria-label={label}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        data-tip={open ? undefined : label}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onKeyDown}
        className={`flex h-7 w-full min-w-0 items-center justify-between gap-1 rounded-md border bg-ink-800 pr-1.5 pl-2 text-left text-ink-100 transition-colors duration-100 outline-none hover:border-ink-600 focus-visible:border-accent ${
          open ? "border-accent bg-ink-950" : "border-transparent"
        }`}
      >
        <span className="min-w-0 flex-1 truncate" style={current?.fontFamily ? { fontFamily: current.fontFamily } : undefined}>
          {current ? current.label : value === "mixed" ? "Mixed" : ""}
        </span>
        <ChevronDown size={12} strokeWidth={2} className={`shrink-0 text-ink-400 transition-transform duration-150 ${open ? "rotate-180" : ""}`} />
      </button>

      {open &&
        createPortal(
          <div
            ref={menu}
            id={listId}
            role="listbox"
            aria-label={label}
            data-select-menu
            className="fixed z-[65] animate-pop overflow-y-auto rounded-lg bg-ink-850 p-1 shadow-popover"
            style={{ left: place?.left ?? 0, width: place?.width, top: place?.top, bottom: place?.bottom, maxHeight: place?.maxHeight, visibility: place ? "visible" : "hidden" }}
            // Keep focus on the trigger so the keyboard keeps working.
            onMouseDown={(e) => e.preventDefault()}
          >
            {options.map((o, i) => (
              <div
                key={String(o.value)}
                id={`${id}-${i}`}
                role="option"
                aria-selected={i === selected}
                data-index={i}
                onPointerMove={() => active !== i && setActive(i)}
                onClick={() => choose(i)}
                className={`flex h-7 cursor-default items-center gap-2 rounded-md px-2 ${i === active ? "bg-accent text-white" : "text-ink-100"}`}
              >
                <span className="flex w-3 shrink-0 justify-center">{i === selected && <Check size={12} strokeWidth={2.5} />}</span>
                <span className="min-w-0 flex-1 truncate" style={o.fontFamily ? { fontFamily: o.fontFamily } : undefined}>
                  {o.label}
                </span>
              </div>
            ))}
          </div>,
          document.body,
        )}
    </>
  );
}
