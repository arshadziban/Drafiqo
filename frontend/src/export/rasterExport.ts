import type { RasterFormat, Size } from "./exportTypes";

/** A drawing surface holding the rendered artwork at its final pixel size. */
export interface RasterSurface extends Size {
  toBlob(type: string, quality?: number): Promise<Blob | null>;
  getImageData(): ImageData;
}

export interface WebpOptions {
  /** 0–100, as the WebP encoder expects. */
  quality: number;
  lossless: boolean;
}

export type WebpEncoder = (data: ImageData, options: WebpOptions) => Promise<ArrayBuffer>;

export interface RasterOptions {
  /** 0–1. */
  quality: number;
  lossless: boolean;
}

/**
 * WebP is encoded with a bundled encoder rather than the webview's, because
 * WebKit (the macOS desktop webview) cannot encode WebP at all.
 */
const defaultWebpEncoder: WebpEncoder = async (data, options) => {
  const { default: encode } = await import("@jsquash/webp/encode");
  return encode(data, { quality: options.quality, lossless: options.lossless ? 1 : 0, exact: 1 });
};

/** Draws an SVG document onto a canvas of exactly the requested size. */
export async function rasterizeSvg(svg: string, size: Size, background: string | null): Promise<RasterSurface> {
  const image = new Image();
  image.decoding = "async";
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error("The artwork could not be rendered."));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement("canvas");
  canvas.width = size.width;
  canvas.height = size.height;
  const context = canvas.getContext("2d");
  if (!context || canvas.width !== size.width || canvas.height !== size.height) {
    throw new Error(`This device could not allocate a ${size.width} × ${size.height} px image. Try a smaller size.`);
  }
  if (background) {
    context.fillStyle = background;
    context.fillRect(0, 0, size.width, size.height);
  }
  context.drawImage(image, 0, 0, size.width, size.height);
  return {
    width: size.width,
    height: size.height,
    toBlob: (type, quality) => new Promise((resolve) => canvas.toBlob(resolve, type, quality)),
    getImageData: () => context.getImageData(0, 0, size.width, size.height),
  };
}

/** Encodes a rendered surface. Quality is passed through as each encoder expects it. */
export async function encodeRaster(
  surface: RasterSurface,
  format: RasterFormat,
  options: RasterOptions,
  encodeWebp: WebpEncoder = defaultWebpEncoder,
): Promise<Uint8Array> {
  if (format === "webp") {
    return new Uint8Array(await encodeWebp(surface.getImageData(), { quality: Math.round(options.quality * 100), lossless: options.lossless }));
  }
  const type = format === "png" ? "image/png" : "image/jpeg";
  const blob = await surface.toBlob(type, format === "jpg" ? options.quality : undefined);
  if (!blob || blob.type !== type) throw new Error(`This device could not encode a ${format.toUpperCase()} image of this size.`);
  return new Uint8Array(await blob.arrayBuffer());
}
