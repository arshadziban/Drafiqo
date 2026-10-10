import { useEffect, useRef, useState, type ReactNode } from "react";
import { useEditor } from "../editor/store";

export const isMac = typeof navigator !== "undefined" && /Mac|iPhone|iPad/.test(navigator.platform);

/** Renders a shortcut such as "Mod+Shift+Z" with the platform's modifier names. */
export function formatShortcut(shortcut: string): string {
  return shortcut
    .split("+")
    .map((part) => {
      if (part === "Mod") return isMac ? "⌘" : "Ctrl";
      if (part === "Shift") return isMac ? "⇧" : "Shift";
      if (part === "Alt") return isMac ? "⌥" : "Alt";
      return part;
    })
    .join(isMac ? "" : "+");
}

export type MenuEntry =
  | "separator"
  | { heading: string }
  | { label: string; shortcut?: string; action: () => void; disabled?: boolean; checked?: boolean };

export function MenuList({ items, onClose }: { items: MenuEntry[]; onClose: () => void }) {
  return (
    <div role="menu" className="min-w-56 animate-pop rounded-lg bg-ink-850 p-1 shadow-popover">
      {items.map((item, i) => {
        if (item === "separator") return <div key={i} className="-mx-1 my-1 h-px bg-ink-700" />;
        if ("heading" in item) {
          return (
            <div key={i} className="px-2 pt-1.5 pb-1 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">
              {item.heading}
            </div>
          );
        }
        return (
          <button
            key={i}
            role="menuitem"
            disabled={item.disabled}
            onClick={() => {
              onClose();
              item.action();
            }}
            className="group/item flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-ink-100 enabled:hover:bg-accent enabled:hover:text-white disabled:text-ink-600"
          >
            <span className="w-3 shrink-0 text-center text-[10px]">{item.checked ? "✓" : ""}</span>
            <span className="flex-1 truncate">{item.label}</span>
            {item.shortcut && (
              <span className="pl-6 text-ink-400 group-enabled/item:group-hover/item:text-white/80 group-disabled/item:text-ink-600">
                {formatShortcut(item.shortcut)}
              </span>
            )}
          </button>
        );
      })}
    </div>
  );
}

/** Closes a popup on outside click or Escape. */
export function useDismiss(open: boolean, onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onPointer = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("pointerdown", onPointer, true);
    window.addEventListener("keydown", onKey);
    return () => {
      window.removeEventListener("pointerdown", onPointer, true);
      window.removeEventListener("keydown", onKey);
    };
  }, [open, onClose]);
  return ref;
}

/** Tooltip shown beside a toolbar control after a short hover. */
export function Tooltip({
  text,
  shortcut,
  align = "center",
  side = "below",
}: {
  text: string;
  shortcut?: string;
  align?: "center" | "right";
  side?: "above" | "below";
}) {
  return (
    <span
      aria-hidden
      className={`pointer-events-none absolute z-50 ${side === "above" ? "bottom-full mb-2.5" : "top-full mt-2"} flex items-center gap-2 rounded-md bg-ink-100 px-2 py-1 text-[11px] font-medium whitespace-nowrap text-ink-950 opacity-0 shadow-lg transition-opacity delay-0 duration-100 group-hover/tip:opacity-100 group-hover/tip:delay-500 ${
        align === "right" ? "right-0" : "left-1/2 -translate-x-1/2"
      }`}
    >
      {text}
      {shortcut && <span className="text-ink-400">{formatShortcut(shortcut)}</span>}
    </span>
  );
}

export function IconButton({
  label,
  shortcut,
  tooltip,
  active,
  disabled,
  onClick,
  children,
}: {
  label: string;
  shortcut?: string;
  /** Show a styled tooltip instead of the system one (only where nothing clips it). */
  tooltip?: boolean;
  active?: boolean;
  disabled?: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  const name = shortcut ? `${label} (${formatShortcut(shortcut)})` : label;
  return (
    <button
      type="button"
      title={tooltip ? undefined : name}
      aria-label={name}
      aria-pressed={active}
      disabled={disabled}
      onClick={onClick}
      className={`group/tip relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100 disabled:text-ink-600 ${
        active ? "bg-accent text-white shadow-sm shadow-black/40" : "text-ink-300 enabled:hover:bg-ink-700 enabled:hover:text-ink-100 enabled:active:bg-ink-600"
      }`}
    >
      {children}
      {tooltip && <Tooltip text={label} shortcut={shortcut} />}
    </button>
  );
}

export type Mixed = "mixed";

/** The value shared by every item, or "mixed" when they differ. */
export function shared<T, V>(items: readonly T[], get: (item: T) => V): V | Mixed {
  const first = items[0];
  if (first === undefined) return "mixed";
  const value = get(first);
  return items.every((item) => get(item) === value) ? value : "mixed";
}

export function NumberField({
  label,
  title,
  value,
  onChange,
  min,
  max,
  step = 1,
  suffix = "",
}: {
  label: ReactNode;
  title: string;
  value: number | Mixed;
  onChange: (value: number) => void;
  min?: number;
  max?: number;
  step?: number;
  suffix?: string;
}) {
  const format = (v: number | Mixed) => (v === "mixed" ? "Mixed" : `${Math.round(v * 100) / 100}${suffix}`);
  const [draft, setDraft] = useState<string | null>(null);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min ?? -Infinity, n));

  const commit = (text: string) => {
    setDraft(null);
    const parsed = Number.parseFloat(text.replace(",", "."));
    if (Number.isFinite(parsed) && clamp(parsed) !== value) onChange(clamp(parsed));
  };

  return (
    <label title={title} className="flex h-7 min-w-0 items-center gap-1.5 rounded-md px-2 border border-transparent bg-ink-800 transition-colors duration-100 hover:border-ink-600 focus-within:border-accent focus-within:bg-ink-950">
      {label !== "" && <span className="flex min-w-3 shrink-0 items-center justify-center text-ink-400">{label}</span>}
      <input
        aria-label={title}
        className="w-full min-w-0 bg-transparent text-ink-100 outline-none"
        value={draft ?? format(value)}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commit(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit(e.currentTarget.value);
            e.currentTarget.blur();
          } else if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          } else if ((e.key === "ArrowUp" || e.key === "ArrowDown") && value !== "mixed") {
            e.preventDefault();
            const base = draft !== null ? Number.parseFloat(draft) : value;
            const delta = (e.key === "ArrowUp" ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
            setDraft(null);
            onChange(clamp(Math.round(((Number.isFinite(base) ? base : value) + delta) * 1000) / 1000));
          }
        }}
      />
    </label>
  );
}

/**
 * Colour swatch + hex field. Dragging inside the native picker is wrapped in a
 * transaction so it produces a single undo step.
 */
export function ColorField({ value, onChange, label }: { value: string | Mixed; onChange: (color: string) => void; label: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState<string | null>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const done = () => useEditor.getState().commit();
    el.addEventListener("change", done);
    el.addEventListener("blur", done);
    return () => {
      el.removeEventListener("change", done);
      el.removeEventListener("blur", done);
    };
  }, []);

  const commitHex = (text: string) => {
    setDraft(null);
    let hex = text.trim().replace(/^#/, "");
    if (/^[0-9a-fA-F]{3}$/.test(hex)) hex = [...hex].map((c) => c + c).join("");
    if (/^[0-9a-fA-F]{6}$/.test(hex) && `#${hex.toLowerCase()}` !== value) onChange(`#${hex.toLowerCase()}`);
  };

  return (
    <div className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md px-1.5 border border-transparent bg-ink-800 transition-colors duration-100 hover:border-ink-600 focus-within:border-accent focus-within:bg-ink-950">
      <input
        ref={ref}
        type="color"
        aria-label={`${label} colour`}
        className="h-4 w-4 shrink-0 appearance-none rounded-[3px] bg-transparent p-0 ring-1 ring-white/20 [&::-webkit-color-swatch]:rounded-sm [&::-webkit-color-swatch]:border-none [&::-webkit-color-swatch-wrapper]:p-0"
        value={value === "mixed" ? "#000000" : value}
        onChange={(e) => {
          useEditor.getState().begin();
          onChange(e.target.value);
        }}
      />
      <input
        aria-label={`${label} hex`}
        className="w-full min-w-0 bg-transparent text-ink-100 uppercase outline-none"
        value={draft ?? (value === "mixed" ? "Mixed" : value.replace("#", ""))}
        onFocus={(e) => e.target.select()}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={(e) => draft !== null && commitHex(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") e.currentTarget.blur();
          if (e.key === "Escape") {
            setDraft(null);
            e.currentTarget.blur();
          }
        }}
      />
    </div>
  );
}

export function Section({ title, action, children }: { title: string; action?: ReactNode; children?: ReactNode }) {
  return (
    <section className="border-b border-ink-700 px-3 pt-2.5 pb-3">
      <header className="mb-1.5 flex h-6 items-center justify-between">
        <h3 className="font-semibold text-ink-100">{title}</h3>
        {action}
      </header>
      {children && <div className="flex flex-col gap-2">{children}</div>}
    </section>
  );
}

export function Select<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T | Mixed;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <select
      aria-label={label}
      title={label}
      className="h-7 w-full min-w-0 rounded-md border border-transparent bg-ink-800 pl-2 text-ink-100 transition-colors duration-100 outline-none hover:border-ink-600 focus:border-accent"
      value={value === "mixed" ? "" : String(value)}
      onChange={(e) => {
        const option = options.find((o) => String(o.value) === e.target.value);
        if (option) onChange(option.value);
      }}
    >
      {value === "mixed" && <option value="">Mixed</option>}
      {options.map((o) => (
        <option key={String(o.value)} value={String(o.value)}>
          {o.label}
        </option>
      ))}
    </select>
  );
}
