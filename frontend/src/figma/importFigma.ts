// The "Import Figma file…" command: reads a .fig file in a worker, lets the
// user choose which of its pages and frames to bring in (FigmaImportDialog),
// and adds them to the open document as new pages, in one undo step.

import { useCanvasUi } from "../canvas/uiStore";
import { createId } from "../document/factory";
import type { ImageAsset, Page } from "../document/types";
import { zoomToFit } from "../editor/actions";
import { refitGroups } from "../editor/commands";
import { useEditor } from "../editor/store";
import { GOOGLE_FAMILIES, ensureFont, installedFamilies } from "../fonts/fontLibrary";
import type { FigPageSummary, FigReply, FigRequest } from "./figWorker";

/** More layers than this make the canvas sluggish; the dialog says so. */
export const MANY_LAYERS = 5_000;
/** More than this is refused: the editor could not draw them. */
export const TOO_MANY_LAYERS = 40_000;

export type FigmaImportState =
  | { status: "reading"; fileName: string }
  | { status: "choosing" | "importing"; fileName: string; pages: FigPageSummary[] }
  | { status: "failed"; fileName: string; message: string };

let worker: Worker | null = null;
let nextId = 1;

function ask<T extends FigReply>(request: Omit<Extract<FigRequest, { type: "open" }>, "id"> | Omit<Extract<FigRequest, { type: "convert" }>, "id">, transfer: Transferable[] = []): Promise<T> {
  worker ??= new Worker(new URL("./figWorker.ts", import.meta.url), { type: "module" });
  const id = nextId++;
  const active = worker;
  return new Promise((resolve, reject) => {
    const onMessage = (event: MessageEvent<FigReply>) => {
      if (event.data.id !== id) return;
      active.removeEventListener("message", onMessage);
      if ("error" in event.data) reject(new Error(event.data.error));
      else resolve(event.data as T);
    };
    active.addEventListener("message", onMessage);
    active.addEventListener("error", () => reject(new Error("The Figma file could not be read.")), { once: true });
    active.postMessage({ ...request, id }, transfer);
  });
}

/** Lets go of the file: a decoded Figma file can take hundreds of megabytes. */
export function closeFigmaImport(): void {
  worker?.terminate();
  worker = null;
  useCanvasUi.setState({ figmaImport: null });
}

export const isFigmaFile = (file: { name: string }) => /\.fig$/i.test(file.name);

/** Opens a .fig file and shows what is in it. */
export async function importFigmaFile(file: File): Promise<void> {
  closeFigmaImport();
  const fileName = file.name.replace(/\.fig$/i, "");
  useCanvasUi.setState({ figmaImport: { status: "reading", fileName }, contextMenu: null });
  try {
    const bytes = new Uint8Array(await file.arrayBuffer());
    const { pages } = await ask<Extract<FigReply, { pages: FigPageSummary[] }>>({ type: "open", bytes }, [bytes.buffer]);
    // Closed while it was being read.
    if (useCanvasUi.getState().figmaImport?.status !== "reading") return;
    useCanvasUi.setState({ figmaImport: { status: "choosing", fileName, pages } });
  } catch (error) {
    useCanvasUi.setState({ figmaImport: { status: "failed", fileName, message: error instanceof Error ? error.message : "The file could not be read." } });
  }
}

export function importFigmaFromPicker(): void {
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".fig";
  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void importFigmaFile(file);
  });
  input.click();
}

/** Brings the chosen layers (by page key → layer keys) into the document. */
export async function runFigmaImport(chosen: ReadonlyMap<string, readonly string[]>): Promise<void> {
  const state = useCanvasUi.getState().figmaImport;
  if (state?.status !== "choosing") return;
  useCanvasUi.setState({ figmaImport: { ...state, status: "importing" } });
  try {
    const request = [...chosen].filter(([, layers]) => layers.length > 0).map(([key, layers]) => ({ key, layers: [...layers] }));
    const { converted } = await ask<Extract<FigReply, { converted: unknown }>>({ type: "convert", pages: request });

    const notes = new Set<string>();
    const assets: ImageAsset[] = [];
    const fonts = new Set<string>();
    const pages: Page[] = [];
    for (const result of converted) {
      const summary = state.pages.find((page) => page.key === result.key);
      result.notes.forEach((note) => notes.add(note));
      result.fonts.forEach((font) => fonts.add(font));
      assets.push(...result.assets);
      // Settled once now, so the first edit afterwards does not move anything.
      pages.push(refitGroups({ id: createId("pg"), name: summary?.name ?? "Figma page", background: summary?.background ?? "#e5e5e5", children: result.children, nodes: result.nodes }));
    }

    // Text keeps Figma's box either way; the font decides how the letters in it look.
    const installed = new Set((await installedFamilies()).map((family) => family.toLowerCase()));
    const missing = [...fonts].filter((family) => !installed.has(family.toLowerCase()) && !GOOGLE_FAMILIES.includes(family));
    if (missing.length > 0) notes.add(`Not installed, so shown in a substitute font: ${missing.sort().join(", ")}.`);
    await Promise.all([...fonts].map((family) => ensureFont(family, [400, 700])));

    const layers = pages.reduce((total, page) => total + Object.keys(page.nodes).length, 0);
    const first = pages[0];
    if (!first) throw new Error("Nothing was chosen to import.");
    useEditor.getState().editDoc((doc) => ({ ...doc, pages: [...doc.pages, ...pages], assets: { ...doc.assets, ...Object.fromEntries(assets.map((asset) => [asset.id, asset])) } }), { pageId: first.id, selection: [] });
    closeFigmaImport();
    zoomToFit();
    useCanvasUi.setState({
      toast: { id: Date.now(), title: `Imported ${layers.toLocaleString()} layers from ${state.fileName}`, detail: pages.length > 1 ? `Added as ${pages.length} new pages.` : `Added as the page “${first.name}”.`, warnings: [...notes] },
    });
  } catch (error) {
    useCanvasUi.setState({ figmaImport: { status: "failed", fileName: state.fileName, message: error instanceof Error ? error.message : "The import failed." } });
  }
}
