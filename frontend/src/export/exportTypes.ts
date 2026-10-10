import type { NodeId } from "../document/types";

export type RasterFormat = "png" | "jpg" | "webp";
export type ExportFormat = RasterFormat | "svg" | "pdf";

export const RASTER_FORMATS: readonly RasterFormat[] = ["png", "jpg", "webp"];
export const SCALE_PRESETS = [1, 2, 3, 4] as const;
export type ScalePreset = (typeof SCALE_PRESETS)[number];
export type ScaleMode = ScalePreset | "custom";

export interface Size {
  width: number;
  height: number;
}

/** The size controls of the export dialog for raster formats. */
export interface RasterSize extends Size {
  scale: ScaleMode;
  lockAspect: boolean;
}

/**
 * What to do when the requested proportions differ from the artwork's.
 * contain: whole artwork, padded. cover: fills the output, cropped. stretch: distorted on purpose.
 */
export type FitMode = "contain" | "cover" | "stretch";

/** "vector" keeps shapes and text as vectors; "image" embeds an exact picture of the artwork. */
export type PdfMode = "vector" | "image";

export interface ExportTarget {
  key: string;
  label: string;
  kind: "node" | "selection" | "page";
  nodeIds: NodeId[];
}

export interface ExportRequest {
  target: ExportTarget;
  format: ExportFormat;
  /** Output size in pixels (raster formats). Ignored for SVG and PDF, which use the source size. */
  size: Size;
  fit: FitMode;
  /** Keep the background transparent (PNG, WebP, SVG). */
  transparent: boolean;
  /** #rrggbb used when not transparent, and always for JPG. */
  background: string;
  /** 0–1. Used by JPG and lossy WebP. */
  quality: number;
  /** WebP only: exact pixels instead of quality-based compression. */
  lossless: boolean;
  pdfMode: PdfMode;
  fileName: string;
}

export interface ExportResult {
  bytes: Uint8Array;
  /** Pixel size of the encoded image, or the page size for SVG/PDF. */
  width: number;
  height: number;
  /** Things that could not be carried into this format exactly. */
  warnings: string[];
}

export const FORMAT_INFO: Record<ExportFormat, { label: string; extension: string; mime: string }> = {
  png: { label: "PNG", extension: "png", mime: "image/png" },
  jpg: { label: "JPG", extension: "jpg", mime: "image/jpeg" },
  webp: { label: "WebP", extension: "webp", mime: "image/webp" },
  svg: { label: "SVG", extension: "svg", mime: "image/svg+xml" },
  pdf: { label: "PDF", extension: "pdf", mime: "application/pdf" },
};

export function isRaster(format: ExportFormat): format is RasterFormat {
  return format === "png" || format === "jpg" || format === "webp";
}
