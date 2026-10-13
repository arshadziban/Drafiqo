import { onFontsEmbedded, readyFontCss } from "../fonts/fontLibrary";
import { useCanvasUi } from "../canvas/uiStore";
import { createId } from "../document/factory";
import { worldBounds, type Rect } from "../document/geometry";
import { ancestorsOf } from "../document/tree";
import type { NodeId, Page } from "../document/types";
import { renderSvg } from "../export/exportRenderer";
import { platform } from "../storage/platform";
import { currentPage, useEditor } from "./store";

// Present: a full-screen slideshow of the page. Each top-level frame is a slide, shown
// scaled to fit the screen, in reading order. A page with no frames is one slide.
// It runs in a separate, movable window that stays live: edits in the editor show up in it.

export interface Slide {
  /** Doubles as the export target key, so a slide can be drawn with the exporter's renderer. */
  key: string;
  name: string;
  kind: "node" | "page";
  nodeIds: NodeId[];
}

/** A slide ready to show: its name and a picture of it (an SVG data: URL). */
export interface SlideView {
  key: string;
  name: string;
  url: string;
}

/** What the editor hands to the window that shows the slideshow. */
export interface PresentPayload {
  slides: SlideView[];
  index: number;
}

/** Rows from top to bottom, and left to right within a row. Frames count as one row when their middles line up with it. */
export function readingOrder<T extends Rect>(items: readonly T[]): T[] {
  const byTop = [...items].sort((a, b) => a.y - b.y || a.x - b.x);
  const rows: { top: number; bottom: number; items: T[] }[] = [];
  for (const item of byTop) {
    const middle = item.y + item.height / 2;
    const row = rows.find((r) => middle >= r.top && middle <= r.bottom);
    if (row) {
      row.items.push(item);
      row.top = Math.min(row.top, item.y);
      row.bottom = Math.max(row.bottom, item.y + item.height);
    } else {
      rows.push({ top: item.y, bottom: item.y + item.height, items: [item] });
    }
  }
  return rows.sort((a, b) => a.top - b.top).flatMap((r) => r.items.sort((a, b) => a.x - b.x));
}

export function presentationSlides(page: Page): Slide[] {
  const frames = page.children
    .map((id) => page.nodes[id])
    .filter((node) => node !== undefined && node.type === "frame" && node.visible)
    .map((node) => ({ id: node!.id, name: node!.name, ...worldBounds(page, node!.id) }));
  if (frames.length > 0) {
    return readingOrder(frames).map((f) => ({ key: f.id, name: f.name, kind: "node", nodeIds: [f.id] }));
  }
  const visible = page.children.filter((id) => page.nodes[id]?.visible);
  return visible.length > 0 ? [{ key: "page", name: page.name, kind: "page", nodeIds: visible }] : [];
}

/** The slide that holds the selection, or null when the selection is not on any slide. */
export function slideOfSelection(page: Page, slides: readonly Slide[], selection: readonly NodeId[]): number | null {
  for (const id of selection) {
    if (!page.nodes[id]) continue;
    const top = [id, ...ancestorsOf(page, id)].at(-1)!;
    const index = slides.findIndex((slide) => slide.nodeIds.includes(top));
    if (index >= 0) return index;
  }
  return null;
}

/** Draws a slide with the exporter's renderer, so what is presented is exactly what is exported. */
export function slideView(page: Page, slide: Slide): SlideView {
  const svg = renderSvg(page, { key: slide.key, label: slide.name, kind: slide.kind, nodeIds: slide.nodeIds }, { fontCss: readyFontCss(page) });
  return { key: slide.key, name: slide.name, url: `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}` };
}

// ---- Handing the slides to the slideshow window --------------------------------------------
// The window is a second copy of the app that asks for its slides over a BroadcastChannel named
// after a one-off token, so nothing has to be stored and any size of picture can be sent.

export const presentChannelName = (token: string) => `drafiqo-present-${token}`;

const SERVE_FOR_MS = 8 * 60 * 60 * 1000;
const LIVE_DELAY_MS = 150;
/** The window pings every couple of seconds; this long without a word means it was closed. */
const WINDOW_GONE_MS = 10_000;

const buildPayload = (page: Page, index: number): PresentPayload => {
  const slides = presentationSlides(page);
  return { slides: slides.map((slide) => slideView(page, slide)), index };
};

/**
 * Answers the window's request for slides, and keeps it live: whenever the page is edited the
 * slides are drawn again and pushed to the window. Stops when the window goes quiet (closed)
 * or after a long while.
 */
function serveSlides(token: string, first: PresentPayload): () => void {
  const channel = new BroadcastChannel(presentChannelName(token));
  let latest = first;
  let seen = Date.now();
  let timer = 0;
  const stop = () => {
    window.clearTimeout(expiry);
    window.clearTimeout(timer);
    window.clearInterval(watchdog);
    unsubscribe();
    unsubscribeFonts();
    channel.close();
  };
  const expiry = window.setTimeout(stop, SERVE_FOR_MS);
  const watchdog = window.setInterval(() => {
    if (Date.now() - seen > WINDOW_GONE_MS) stop();
  }, 3000);
  channel.onmessage = (event: MessageEvent<{ type?: string }>) => {
    seen = Date.now();
    if (event.data?.type === "ready") channel.postMessage({ type: "slides", payload: latest });
  };
  const refresh = () => {
    window.clearTimeout(timer);
    timer = window.setTimeout(() => {
      latest = buildPayload(currentPage(useEditor.getState()), latest.index);
      channel.postMessage({ type: "slides", payload: latest, live: true });
    }, LIVE_DELAY_MS);
  };
  const unsubscribe = useEditor.subscribe((state, previous) => {
    const page = currentPage(state);
    if (page === currentPage(previous) && state.doc.assets === previous.doc.assets) return;
    refresh();
  });
  // A web font that has just arrived changes how the slides look.
  const unsubscribeFonts = onFontsEmbedded(refresh);
  return stop;
}

/**
 * Starts presenting from the selected frame, or from the first slide, in a window of its own.
 * If no window can be opened the slideshow covers the editor instead. Says so when there is nothing to show.
 */
export function startPresenting(from: "selection" | "start" = "selection"): boolean {
  const s = useEditor.getState();
  if (s.editingTextId) return false;
  const page = currentPage(s);
  const slides = presentationSlides(page);
  if (slides.length === 0) {
    useCanvasUi.setState({ toast: { id: Date.now(), title: "Nothing to present", warnings: ["Add a frame to this page, then present it."] } });
    return false;
  }
  const index = from === "selection" ? (slideOfSelection(page, slides, s.selection) ?? 0) : 0;
  const token = createId("show");
  const first = { slides: slides.map((slide) => slideView(page, slide)), index };
  const stopServing = serveSlides(token, first);
  // The window must be opened straight away, while the click or key press that asked for it still counts.
  void platform.openPresentation(`/?present=${token}`).then((opened) => {
    if (opened) return;
    stopServing();
    useCanvasUi.setState({ presenting: first });
  });
  return true;
}

/** Closes the slideshow that covers the editor (the fallback when no window could be opened). */
export function stopPresenting(): void {
  useCanvasUi.setState({ presenting: null });
}

/** Moves the in-app slideshow to another slide (clamped to the ends). */
export function goToSlide(index: number): void {
  const presenting = useCanvasUi.getState().presenting;
  if (!presenting) return;
  const next = Math.min(presenting.slides.length - 1, Math.max(0, index));
  if (next !== presenting.index) useCanvasUi.setState({ presenting: { ...presenting, index: next } });
}
