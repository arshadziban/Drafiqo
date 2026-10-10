import { useCanvasUi } from "../canvas/uiStore";
import { createId, createRectangle, imagePaint } from "../document/factory";
import { applyToPoint, invert, worldMatrix } from "../document/geometry";
import { isEffectivelyLocked, isEffectivelyVisible, paintOrder } from "../document/tree";
import type { ImageAsset, NodeId, Page } from "../document/types";
import { IMAGE_MIME_TYPES } from "../document/validate";
import { insertNodeAtWorld, patchNodes, updatePage } from "./commands";
import { currentViewport, useEditor } from "./store";

// Bringing pictures into a document: choosing, validating, embedding and placing them.
// A picture is placed as a rectangle with an image fill, as in Figma, so it can be
// moved, resized, rotated, rounded, given effects and exported like any shape.

/** Larger files are refused: the picture is stored inside the project file. */
export const MAX_IMAGE_BYTES = 25 * 1024 * 1024;
/** Larger pictures are scaled down to this on their longest side, as Figma does. */
export const MAX_IMAGE_SIDE = 4096;
/** A freshly placed picture is shown at most this much of the visible canvas. */
const PLACED_FRACTION = 0.8;
/** Several pictures placed together are staggered by this much so none hides another. */
const STAGGER = 24;

const EXTENSION_TYPES: Record<string, string> = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  webp: "image/webp",
  gif: "image/gif",
  svg: "image/svg+xml",
  avif: "image/avif",
  bmp: "image/bmp",
};

export class ImageImportError extends Error {}

interface Size {
  width: number;
  height: number;
}

export interface Point {
  x: number;
  y: number;
}

/** The image type of a file, from its reported type or, failing that, its extension. */
export function imageMime(file: { name: string; type: string }): string | null {
  const type = file.type.toLowerCase();
  if ((IMAGE_MIME_TYPES as readonly string[]).includes(type)) return type;
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "";
  return EXTENSION_TYPES[extension] ?? null;
}

/** A layer name from a file name: "holiday photo.JPG" becomes "holiday photo". */
export function baseName(fileName: string): string {
  const dot = fileName.lastIndexOf(".");
  const base = (dot > 0 ? fileName.slice(0, dot) : fileName).trim();
  return base || "Image";
}

/** The size scaled down (never up) to fit inside `max`, in whole pixels. */
export function fitWithin(size: Size, max: Size): Size {
  const factor = Math.min(1, max.width / size.width, max.height / size.height);
  return { width: Math.max(1, Math.round(size.width * factor)), height: Math.max(1, Math.round(size.height * factor)) };
}

/** Where and how large a picture is placed: centred on `centre`, shrunk to fit the visible canvas. */
export function placementBox(natural: Size, visible: Size, centre: Point, index = 0): Size & Point {
  const size = fitWithin(natural, { width: visible.width * PLACED_FRACTION, height: visible.height * PLACED_FRACTION });
  return {
    ...size,
    x: Math.round(centre.x - size.width / 2 + index * STAGGER),
    y: Math.round(centre.y - size.height / 2 + index * STAGGER),
  };
}

/**
 * The frame or section a picture placed at `point` (page space) should go into: the
 * topmost one that is visible, unlocked and contains the point. Null means the page itself.
 */
export function containerAt(page: Page, point: Point): NodeId | null {
  for (const id of [...paintOrder(page)].reverse()) {
    const node = page.nodes[id];
    if (!node || (node.type !== "frame" && node.type !== "section")) continue;
    if (!isEffectivelyVisible(page, id) || isEffectivelyLocked(page, id)) continue;
    const local = applyToPoint(invert(worldMatrix(page, id)), point);
    if (local.x >= 0 && local.y >= 0 && local.x <= node.width && local.y <= node.height) return id;
  }
  return null;
}

/** The same bytes always get the same id, so a picture used twice is stored once. */
export async function assetIdFor(url: string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) return createId("img");
  const digest = await subtle.digest("SHA-256", new TextEncoder().encode(url));
  return `img_${[...new Uint8Array(digest).slice(0, 12)].map((b) => b.toString(16).padStart(2, "0")).join("")}`;
}

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

async function decode(url: string): Promise<Size> {
  const image = new Image();
  image.src = url;
  await image.decode();
  // An SVG without its own dimensions reports 0 × 0.
  return { width: image.naturalWidth || 512, height: image.naturalHeight || 512 };
}

/** Redraws the picture smaller. JPEGs stay JPEG; everything else becomes PNG so nothing is lost twice. */
async function downscale(url: string, mime: string, from: Size): Promise<{ url: string; mime: string; size: Size }> {
  const size = fitWithin(from, { width: MAX_IMAGE_SIDE, height: MAX_IMAGE_SIDE });
  const image = new Image();
  image.src = url;
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")!.drawImage(image, 0, 0, size.width, size.height);
  const out = mime === "image/jpeg" ? "image/jpeg" : "image/png";
  return { url: canvas.toDataURL(out, 0.92), mime: out, size };
}

/** Reads a file into an embeddable picture, or explains why it cannot be used. */
export async function importImageFile(file: File): Promise<ImageAsset> {
  const mime = imageMime(file);
  if (!mime) throw new ImageImportError(`"${file.name}" is not a supported image. Use PNG, JPG, WebP, GIF, SVG, AVIF or BMP.`);
  if (file.size > MAX_IMAGE_BYTES) throw new ImageImportError(`"${file.name}" is larger than ${MAX_IMAGE_BYTES / 1024 / 1024} MB.`);
  // The browser may report a generic type for the bytes; the type decided above is the one to keep.
  const raw = await readAsDataUrl(file);
  let url = `data:${mime};base64,${raw.slice(raw.indexOf(",") + 1)}`;
  let size: Size;
  try {
    size = await decode(url);
  } catch {
    throw new ImageImportError(`"${file.name}" could not be read as an image.`);
  }
  let finalMime = mime;
  if (mime !== "image/svg+xml" && Math.max(size.width, size.height) > MAX_IMAGE_SIDE) {
    const smaller = await downscale(url, mime, size);
    url = smaller.url;
    finalMime = smaller.mime;
    size = smaller.size;
  }
  return { id: await assetIdFor(url), name: baseName(file.name), mime: finalMime, width: size.width, height: size.height, url };
}

/** Opens the system's file chooser. Resolves with nothing when it is cancelled. */
export function pickImageFiles(multiple: boolean): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = IMAGE_MIME_TYPES.join(",");
    input.multiple = multiple;
    input.addEventListener("change", () => resolve([...(input.files ?? [])]));
    input.addEventListener("cancel", () => resolve([]));
    input.click();
  });
}

function showProblems(title: string, problems: string[]): void {
  useCanvasUi.setState({ toast: { id: Date.now(), title, warnings: problems } });
}

const withAssets = <T extends { assets: Record<string, ImageAsset> }>(doc: T, assets: readonly ImageAsset[]): T => ({
  ...doc,
  assets: { ...doc.assets, ...Object.fromEntries(assets.map((a) => [a.id, a])) },
});

/** Adds the pictures to the current page as selected image layers: one undo step. */
function placeAssets(assets: readonly ImageAsset[], at?: Point): void {
  const s = useEditor.getState();
  const viewport = currentViewport(s);
  const canvas = s.canvasSize;
  const screen = at ?? { x: canvas.width / 2, y: canvas.height / 2 };
  const centre = { x: (screen.x - viewport.x) / viewport.zoom, y: (screen.y - viewport.y) / viewport.zoom };
  const visible = { width: canvas.width / viewport.zoom, height: canvas.height / viewport.zoom };
  const nodes = assets.map((asset, index) => ({
    ...createRectangle(placementBox({ width: asset.width, height: asset.height }, visible, centre, index)),
    name: asset.name,
    fills: [imagePaint(asset.id)],
  }));
  s.editDoc(
    (doc) =>
      updatePage(withAssets(doc, assets), s.pageId, (page) =>
        // Over a frame, the picture goes inside it, as in Figma.
        nodes.reduce((p, node) => insertNodeAtWorld(p, node, containerAt(p, { x: node.x + node.width / 2, y: node.y + node.height / 2 })), page),
      ),
    { selection: nodes.map((n) => n.id) },
  );
  s.setTool("select");
}

/** Places picture files on the canvas, centred on `at` (canvas pixels) or on the middle of the view. */
export async function placeImageFiles(files: readonly File[], at?: Point): Promise<void> {
  const assets: ImageAsset[] = [];
  const problems: string[] = [];
  for (const file of files) {
    try {
      assets.push(await importImageFile(file));
    } catch (error) {
      problems.push(error instanceof ImageImportError ? error.message : `"${file.name}" could not be placed.`);
    }
  }
  if (assets.length > 0) placeAssets(assets, at);
  if (problems.length > 0) showProblems(assets.length > 0 ? `Placed ${assets.length} of ${files.length} images` : "No image placed", problems);
}

/** The "Place image…" command. */
export async function placeImageFromPicker(): Promise<void> {
  const files = await pickImageFiles(true);
  if (files.length > 0) await placeImageFiles(files);
}

/** Asks for a picture and puts it in the given fill of the given layers (replacing a colour or another picture). */
export async function chooseImageForFill(ids: readonly NodeId[], paintId: string): Promise<void> {
  const [file] = await pickImageFiles(false);
  if (!file) return;
  let asset: ImageAsset;
  try {
    asset = await importImageFile(file);
  } catch (error) {
    return showProblems("Image not changed", [error instanceof ImageImportError ? error.message : `"${file.name}" could not be used.`]);
  }
  const s = useEditor.getState();
  s.editDoc((doc) =>
    updatePage(withAssets(doc, [asset]), s.pageId, (page) =>
      patchNodes(page, ids, (node) => ({
        fills: node.fills.map((fill) => (fill.id !== paintId ? fill : fill.type === "image" ? { ...fill, assetId: asset.id } : imagePaint(asset.id))),
      })),
    ),
  );
}
