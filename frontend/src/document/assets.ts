import type { DrafiqoDocument, ImageAsset, NodeId, Page } from "./types";

// The pictures of the document that is open. Rendering looks them up by id here so
// every renderer (canvas, export, preview) can draw an image fill without being
// handed the whole document. The editor store keeps this in step with the document.

let current: Record<string, ImageAsset> = {};

export function setAssets(assets: Record<string, ImageAsset>): void {
  current = assets;
}

export function getAsset(id: string): ImageAsset | undefined {
  return current[id];
}

/** Ids of the images that some visible or hidden fill still uses. */
export function referencedAssetIds(pages: readonly Page[]): Set<string> {
  const ids = new Set<string>();
  for (const page of pages) {
    for (const node of Object.values(page.nodes)) {
      for (const fill of node.fills) if (fill.type === "image") ids.add(fill.assetId);
    }
  }
  return ids;
}

/** The document without pictures nothing uses any more, so files do not grow with every image tried and deleted. */
export function pruneAssets(doc: DrafiqoDocument): DrafiqoDocument {
  const used = referencedAssetIds(doc.pages);
  const ids = Object.keys(doc.assets);
  if (ids.every((id) => used.has(id))) return doc;
  return { ...doc, assets: Object.fromEntries(ids.filter((id) => used.has(id)).map((id) => [id, doc.assets[id]!])) };
}

/** Nodes whose fills use the given picture. */
export function nodesUsingAsset(page: Page, assetId: string): NodeId[] {
  return Object.values(page.nodes)
    .filter((node) => node.fills.some((f) => f.type === "image" && f.assetId === assetId))
    .map((node) => node.id);
}
