import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { formatShortcut } from "./ui";

// One tooltip for the whole app. Any element opts in with attributes:
//
//   data-tip="Align left"            text (required)
//   data-tip-shortcut="Mod+Shift+L"  optional shortcut, shown muted beside the text
//   data-tip-side="above"            optional; defaults to below
//
// It replaces the browser's native `title` tooltip (unstyled, slow, clipped by
// panels). It is drawn in a fixed layer, so no scrolling panel can cut it off,
// and it flips or slides to stay inside the window.

const SHOW_DELAY = 450;
/** Moving between neighbouring buttons shows the next tooltip at once, as in Figma. */
const WARM_WINDOW = 400;
const WARM_DELAY = 60;
const GAP = 8;
const EDGE = 8;

interface Tip {
  el: Element;
  text: string;
  shortcut?: string;
  side: "above" | "below";
}

const tipOf = (el: Element): Tip | null => {
  const text = el.getAttribute("data-tip");
  if (!text) return null;
  return { el, text, shortcut: el.getAttribute("data-tip-shortcut") ?? undefined, side: el.getAttribute("data-tip-side") === "above" ? "above" : "below" };
};

export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const timer = useRef(0);
  const hiddenAt = useRef(0);
  const current = useRef<Element | null>(null);

  useEffect(() => {
    const cancel = () => window.clearTimeout(timer.current);
    const hide = () => {
      cancel();
      if (current.current) hiddenAt.current = Date.now();
      current.current = null;
      setTip(null);
      setPos(null);
    };
    const schedule = (el: Element, immediate: boolean) => {
      cancel();
      current.current = el;
      const warm = Date.now() - hiddenAt.current < WARM_WINDOW;
      timer.current = window.setTimeout(() => {
        const next = tipOf(el);
        if (next && el.isConnected) setTip(next);
      }, immediate ? 0 : warm ? WARM_DELAY : SHOW_DELAY);
    };

    const onOver = (e: PointerEvent) => {
      if (e.pointerType === "touch") return;
      const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      if (el === current.current) return;
      hide();
      if (el) schedule(el, false);
    };
    const onFocus = (e: FocusEvent) => {
      const el = e.target instanceof Element ? e.target.closest("[data-tip]") : null;
      // Only for keyboard focus; a mouse click focuses the button without wanting a tooltip.
      if (el && e.target instanceof Element && e.target.matches(":focus-visible")) {
        hide();
        schedule(el, true);
      }
    };
    const onLeaveWindow = (e: MouseEvent) => {
      if (e.relatedTarget === null) hide();
    };

    document.addEventListener("pointerover", onOver);
    document.addEventListener("pointerdown", hide, true);
    document.addEventListener("focusin", onFocus);
    document.addEventListener("focusout", hide);
    document.addEventListener("keydown", hide, true);
    document.addEventListener("scroll", hide, true);
    document.addEventListener("wheel", hide, { capture: true, passive: true });
    document.documentElement.addEventListener("mouseout", onLeaveWindow);
    window.addEventListener("blur", hide);
    return () => {
      cancel();
      document.removeEventListener("pointerover", onOver);
      document.removeEventListener("pointerdown", hide, true);
      document.removeEventListener("focusin", onFocus);
      document.removeEventListener("focusout", hide);
      document.removeEventListener("keydown", hide, true);
      document.removeEventListener("scroll", hide, true);
      document.removeEventListener("wheel", hide, true);
      document.documentElement.removeEventListener("mouseout", onLeaveWindow);
      window.removeEventListener("blur", hide);
    };
  }, []);

  // Place it once its size is known; flip to the other side or slide in if it would leave the window.
  useLayoutEffect(() => {
    const el = box.current;
    if (!tip || !el) return;
    const a = tip.el.getBoundingClientRect();
    const { offsetWidth: w, offsetHeight: h } = el;
    const below = a.bottom + GAP;
    const above = a.top - h - GAP;
    const fitsBelow = below + h <= window.innerHeight - EDGE;
    const fitsAbove = above >= EDGE;
    const top = tip.side === "above" ? (fitsAbove || !fitsBelow ? above : below) : fitsBelow || !fitsAbove ? below : above;
    const left = Math.min(Math.max(a.left + a.width / 2 - w / 2, EDGE), Math.max(EDGE, window.innerWidth - w - EDGE));
    setPos({ left, top: Math.max(EDGE, top) });
  }, [tip]);

  // The element can vanish under a visible tooltip (a panel closes, a layer is deleted).
  useEffect(() => {
    if (!tip) return;
    const id = window.setInterval(() => {
      if (!tip.el.isConnected) {
        setTip(null);
        setPos(null);
        current.current = null;
      }
    }, 250);
    return () => window.clearInterval(id);
  }, [tip]);

  if (!tip) return null;
  return createPortal(
    <div
      ref={box}
      role="tooltip"
      className="pointer-events-none fixed z-[80] flex animate-pop items-center gap-2 rounded-md bg-[#0b0c0e] px-2 py-1 text-[11px] leading-4 font-medium whitespace-nowrap text-ink-100 shadow-[0_6px_16px_rgb(0_0_0/0.45),0_0_0_1px_rgb(255_255_255/0.09)]"
      style={{ left: pos?.left ?? 0, top: pos?.top ?? 0, visibility: pos ? "visible" : "hidden" }}
    >
      <span>{tip.text}</span>
      {tip.shortcut && <span className="text-ink-400">{formatShortcut(tip.shortcut)}</span>}
    </div>,
    document.body,
  );
}
