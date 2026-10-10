import { ChevronLeft, ChevronRight, Maximize, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useCanvasUi } from "../canvas/uiStore";
import { goToSlide, presentChannelName, stopPresenting, type PresentPayload, type SlideView } from "../editor/present";
import { platform } from "../storage/platform";

const HIDE_CONTROLS_MS = 2400;
const NEXT_KEYS = new Set(["ArrowRight", "ArrowDown", "PageDown", " ", "Enter"]);
const PREVIOUS_KEYS = new Set(["ArrowLeft", "ArrowUp", "PageUp", "Backspace"]);

interface SlideshowProps {
  slides: SlideView[];
  index: number;
  onGo: (index: number) => void;
  onExit: () => void;
  /** Offer a full-screen toggle (F). Windows that start full screen do not need it. */
  fullscreenToggle?: boolean;
}

/** The slideshow itself: the slide scaled to fill the screen, a bar that fades away, and the keys. */
function Slideshow({ slides, index, onGo, onExit, fullscreenToggle = false }: SlideshowProps) {
  const slide = slides[index]!;
  const [controls, setControls] = useState(true);
  const overControls = useRef(false);
  const timer = useRef(0);
  // The keys read the latest values without being re-registered on every slide change.
  const latest = useRef({ index, count: slides.length, onGo, onExit });
  latest.current = { index, count: slides.length, onGo, onExit };

  const showControls = () => {
    setControls(true);
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      if (!overControls.current) setControls(false);
    }, HIDE_CONTROLS_MS);
  };

  useEffect(() => {
    showControls();
    return () => window.clearTimeout(timer.current);
  }, []);

  const toggleFullscreen = () => {
    if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    else void document.documentElement.requestFullscreen?.().catch(() => {});
  };

  // The only keys that do anything. They never reach anything behind the slideshow.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      e.stopPropagation();
      if (e.ctrlKey || e.metaKey || e.altKey) return;
      const { index, count, onGo, onExit } = latest.current;
      if (e.key === "Escape") onExit();
      else if (NEXT_KEYS.has(e.key)) onGo(Math.min(count - 1, index + 1));
      else if (PREVIOUS_KEYS.has(e.key)) onGo(Math.max(0, index - 1));
      else if (e.key === "Home") onGo(0);
      else if (e.key === "End") onGo(count - 1);
      else if ((e.key === "f" || e.key === "F") && fullscreenToggle) toggleFullscreen();
      else return;
      e.preventDefault();
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [fullscreenToggle]);

  const button = "flex h-8 w-8 items-center justify-center rounded-lg text-ink-300 transition-colors duration-100 enabled:hover:bg-white/10 enabled:hover:text-white disabled:text-ink-600";
  return (
    <div
      role="dialog"
      aria-modal
      aria-label="Presentation"
      data-testid="presentation"
      className="fixed inset-0 z-[100] bg-ink-950 select-none"
      style={{ cursor: controls ? "default" : "none" }}
      onPointerMove={showControls}
      onClick={(e) => {
        if ((e.target as Element).closest("[data-present-controls]")) return;
        onGo(Math.min(slides.length - 1, Math.max(0, index + (e.shiftKey ? -1 : 1))));
      }}
    >
      <div key={slide.key} className="absolute inset-0 animate-fade p-6">
        <img src={slide.url} alt={slide.name} draggable={false} className="h-full w-full object-contain" />
      </div>

      <div
        data-present-controls
        onPointerEnter={() => (overControls.current = true)}
        onPointerLeave={() => {
          overControls.current = false;
          showControls();
        }}
        className={`absolute bottom-6 left-1/2 flex -translate-x-1/2 items-center gap-1 rounded-xl bg-ink-850/90 p-1 shadow-popover ring-1 ring-white/10 backdrop-blur-xl transition-opacity duration-200 ${
          controls ? "opacity-100" : "pointer-events-none opacity-0"
        }`}
      >
        <button type="button" aria-label="Previous slide" disabled={index === 0} onClick={() => onGo(index - 1)} className={button}>
          <ChevronLeft size={16} />
        </button>
        <div className="flex min-w-36 items-center justify-center gap-2.5 px-2 text-[12px]">
          <span data-testid="present-name" className="max-w-56 truncate font-medium text-ink-100">
            {slide.name}
          </span>
          <span data-testid="present-counter" className="text-ink-400 tabular-nums">
            {index + 1} / {slides.length}
          </span>
        </div>
        <button type="button" aria-label="Next slide" disabled={index === slides.length - 1} onClick={() => onGo(index + 1)} className={button}>
          <ChevronRight size={16} />
        </button>
        <span className="mx-1 h-4 w-px bg-ink-700" />
        {fullscreenToggle && (
          <button type="button" aria-label="Full screen" onClick={toggleFullscreen} className={button}>
            <Maximize size={14} />
          </button>
        )}
        <button type="button" aria-label="Exit presentation" onClick={onExit} className="flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[12px] font-medium text-ink-300 transition-colors duration-100 hover:bg-white/10 hover:text-white">
          <X size={14} />
          Esc
        </button>
      </div>
    </div>
  );
}

/**
 * The slideshow covering the editor. It is only used when no window of its own could be
 * opened (for example when the browser blocked the pop-up).
 */
export function Presentation() {
  const presenting = useCanvasUi((s) => s.presenting);
  // Take the whole screen. Leaving full screen by any route (Esc, F11) ends the show too.
  useEffect(() => {
    if (!presenting) return;
    let entered = false;
    const onChange = () => {
      if (document.fullscreenElement) entered = true;
      else if (entered) stopPresenting();
    };
    document.addEventListener("fullscreenchange", onChange);
    void document.documentElement.requestFullscreen?.().catch(() => {
      // Refused (for example when not started by a click): the slideshow still fills the window.
    });
    return () => {
      document.removeEventListener("fullscreenchange", onChange);
      if (document.fullscreenElement) void document.exitFullscreen().catch(() => {});
    };
  }, [presenting === null]);
  return presenting ? <Slideshow slides={presenting.slides} index={presenting.index} onGo={goToSlide} onExit={stopPresenting} /> : null;
}

/** What a slideshow window is: it asks the editor that opened it for the slides, then shows them. */
export function PresentationWindow({ token }: { token: string }) {
  const [payload, setPayload] = useState<PresentPayload | null>(null);
  const [index, setIndex] = useState(0);
  const shownKey = useRef<string | null>(null);
  const [gaveUp, setGaveUp] = useState(false);

  useEffect(() => {
    document.title = "Presentation";
    const channel = new BroadcastChannel(presentChannelName(token));
    let received = false;
    channel.onmessage = (event: MessageEvent<{ type?: string; payload?: PresentPayload }>) => {
      if (event.data?.type !== "slides" || !event.data.payload) return;
      const next = event.data.payload;
      if (!received) setIndex(next.index);
      else {
        // A live update: stay on the same slide if it still exists, else on the nearest index.
        const kept = next.slides.findIndex((slide) => slide.key === shownKey.current);
        setIndex((i) => (kept >= 0 ? kept : Math.min(i, next.slides.length - 1)));
      }
      received = true;
      setPayload(next);
    };
    const ask = () => {
      if (!received) channel.postMessage({ type: "ready" });
    };
    ask();
    // Ask until answered; after that, ping so the editor knows this window is still open.
    const retry = window.setInterval(() => (received ? channel.postMessage({ type: "ping" }) : ask()), 400);
    const giveUp = window.setTimeout(() => !received && setGaveUp(true), 6000);
    return () => {
      window.clearInterval(retry);
      window.clearTimeout(giveUp);
      channel.close();
    };
  }, [token]);

  shownKey.current = payload?.slides[index]?.key ?? null;
  if (payload && payload.slides.length === 0) {
    return <div className="flex h-full items-center justify-center bg-ink-950 text-ink-300">Nothing to present. Add a frame in the editor.</div>;
  }
  if (payload) {
    return <Slideshow slides={payload.slides} index={index} onGo={setIndex} onExit={() => platform.closeWindow()} fullscreenToggle />;
  }
  return (
    <div className="flex h-full items-center justify-center bg-ink-950 text-ink-300" data-testid="presentation-waiting">
      {gaveUp ? "This presentation is no longer available. Close this window and present again from the editor." : "Opening presentation…"}
    </div>
  );
}
