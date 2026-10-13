// Reads and converts Figma files off the main thread: a large file takes
// several seconds to decode, and the editor should stay usable meanwhile.

import { convertFigNodes, type FigImport } from "./figConvert";
import { countLayers, figKey, readFigFile, type FigFile } from "./figFile";

export interface FigLayerSummary {
  key: string;
  name: string;
  type: string;
  /** Layers inside, itself included. */
  layers: number;
}

export interface FigPageSummary {
  key: string;
  name: string;
  /** Canvas colour as #rrggbb, when the page sets one. */
  background: string | null;
  layers: FigLayerSummary[];
}

export type FigRequest = { id: number; type: "open"; bytes: Uint8Array } | { id: number; type: "convert"; pages: { key: string; layers: string[] }[] };
export type FigReply = { id: number; error: string } | { id: number; pages: FigPageSummary[] } | { id: number; converted: (FigImport & { key: string })[] };

let file: FigFile | null = null;

const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");

function answer(request: FigRequest): FigReply {
  if (request.type === "open") {
    file = readFigFile(request.bytes);
    const opened = file;
    return {
      id: request.id,
      pages: opened.pages.map((page) => {
        const colour = page.backgroundColor as { r: number; g: number; b: number } | undefined;
        return {
          key: figKey(page.guid),
          name: page.name || "Page",
          background: colour ? `#${channel(colour.r)}${channel(colour.g)}${channel(colour.b)}` : null,
          // Front-most first, the way Figma's own layer list reads.
          layers: [...(opened.children.get(figKey(page.guid)) ?? [])].reverse().map((node) => ({ key: figKey(node.guid), name: node.name || node.type, type: node.type, layers: countLayers(opened, node) })),
        };
      }),
    };
  }
  const opened = file;
  if (!opened) return { id: request.id, error: "The Figma file is no longer open." };
  return {
    id: request.id,
    converted: request.pages.map((page) => {
      const wanted = new Set(page.layers);
      const roots = (opened.children.get(page.key) ?? []).filter((node) => wanted.has(figKey(node.guid)));
      return { key: page.key, ...convertFigNodes(opened, roots) };
    }),
  };
}

self.onmessage = (event: MessageEvent<FigRequest>) => {
  let reply: FigReply;
  try {
    reply = answer(event.data);
  } catch (error) {
    reply = { id: event.data.id, error: error instanceof Error ? error.message : "The Figma file could not be read." };
  }
  self.postMessage(reply);
};
