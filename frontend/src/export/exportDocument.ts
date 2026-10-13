import { embeddedFontCss } from "../fonts/fontLibrary";
import type { Page } from "../document/types";
import { sizeForScale } from "./exportDimensions";
import { renderSvg, sourceBounds } from "./exportRenderer";
import { isRaster, type ExportRequest, type ExportResult } from "./exportTypes";
import { validateExport } from "./exportValidation";
import { readImageSize } from "./imageSize";
import { exportImagePdf, exportVectorPdf } from "./pdfExport";
import { encodeRaster, rasterizeSvg } from "./rasterExport";
import { exportSvg } from "./svgExport";

export class ExportError extends Error {}

/** Pixel density of the picture embedded by PDF image mode. */
const PDF_IMAGE_SCALE = 2;

/**
 * Renders an export to bytes. Nothing is written here: the caller saves the
 * bytes and reports success only once that has worked.
 */
export async function renderExport(page: Page, request: ExportRequest): Promise<ExportResult> {
  const bounds = sourceBounds(page, request.target);
  const errors = validateExport(request, bounds);
  if (errors.length > 0) throw new ExportError(errors.join("\n"));

  if (request.format === "svg") return exportSvg(page, request);

  if (request.format === "pdf") {
    if (request.pdfMode === "vector") return exportVectorPdf(page, request);
    const pixels = sizeForScale(bounds, PDF_IMAGE_SCALE);
    const background = request.transparent ? "#ffffff" : request.background;
    const surface = await rasterizeSvg(renderSvg(page, request.target, { size: pixels, background, fontCss: await embeddedFontCss(page) }), pixels, background);
    return exportImagePdf(bounds, await encodeRaster(surface, "jpg", { quality: 0.92, lossless: false }), pixels);
  }

  if (!isRaster(request.format)) throw new ExportError("Unsupported format.");
  // JPG has no transparency, so transparent areas are composited over the background first.
  const background = request.format === "jpg" || !request.transparent ? request.background : null;
  const svg = renderSvg(page, request.target, { size: request.size, fit: request.fit, background, fontCss: await embeddedFontCss(page) });
  const surface = await rasterizeSvg(svg, request.size, background);
  const bytes = await encodeRaster(surface, request.format, { quality: request.quality, lossless: request.lossless });

  const actual = readImageSize(bytes);
  if (!actual || actual.width !== request.size.width || actual.height !== request.size.height) {
    const got = actual ? `${actual.width} × ${actual.height}` : "an unreadable image";
    throw new ExportError(`The encoder produced ${got} instead of ${request.size.width} × ${request.size.height} px. Nothing was saved.`);
  }
  return { bytes, width: actual.width, height: actual.height, warnings: [] };
}
