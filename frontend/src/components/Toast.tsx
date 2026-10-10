import { CircleCheck, TriangleAlert, X } from "lucide-react";
import { useEffect } from "react";
import { useCanvasUi } from "../canvas/uiStore";

const VISIBLE_MS = 4500;
const MAX_WARNINGS = 3;

/**
 * A brief confirmation at the top of the window. A plain success leaves by
 * itself; one that carries warnings stays until it is dismissed, so they can be read.
 */
export function Toast() {
  const toast = useCanvasUi((s) => s.toast);
  const warnings = toast?.warnings ?? [];
  const sticky = warnings.length > 0;

  useEffect(() => {
    if (!toast || sticky) return;
    const id = toast.id;
    const timer = window.setTimeout(() => {
      // A newer toast may have replaced this one in the meantime.
      if (useCanvasUi.getState().toast?.id === id) useCanvasUi.setState({ toast: null });
    }, VISIBLE_MS);
    return () => window.clearTimeout(timer);
  }, [toast, sticky]);

  if (!toast) return null;
  const Icon = sticky ? TriangleAlert : CircleCheck;
  return (
    <div className="pointer-events-none fixed top-14 left-1/2 z-85 -translate-x-1/2">
      <div
        key={toast.id}
        role="status"
        data-testid="toast"
        className="pointer-events-auto flex w-max max-w-120 animate-pop items-start gap-2.5 rounded-lg bg-ink-850 py-2.5 pr-2 pl-3 shadow-popover ring-1 ring-white/[0.07]"
      >
        <Icon size={16} className={`mt-px shrink-0 ${sticky ? "text-amber-300" : "text-emerald-400"}`} />
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium text-ink-100">{toast.title}</p>
          {toast.detail && (
            <p className="truncate text-ink-400" data-tip={toast.detail}>
              {toast.detail}
            </p>
          )}
          {warnings.slice(0, MAX_WARNINGS).map((w) => (
            <p key={w} className="mt-1 leading-snug text-ink-300">
              {w}
            </p>
          ))}
          {warnings.length > MAX_WARNINGS && <p className="mt-1 text-ink-400">and {warnings.length - MAX_WARNINGS} more</p>}
        </div>
        <button
          type="button"
          aria-label="Dismiss"
          data-tip="Dismiss"
          onClick={() => useCanvasUi.setState({ toast: null })}
          className="flex h-5 w-5 shrink-0 items-center justify-center rounded text-ink-400 hover:bg-ink-700 hover:text-ink-100"
        >
          <X size={12} />
        </button>
      </div>
    </div>
  );
}
