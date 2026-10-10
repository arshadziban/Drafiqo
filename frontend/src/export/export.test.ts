import { describe, expect, it, vi } from "vitest";
import { createEllipse, createFrame, createLine, createPage, createRectangle, createText, dropShadow, innerShadow, layerBlur, solidPaint } from "../document/factory";
import type { Page } from "../document/types";
import { groupNodes, insertNode, patchNodes } from "../editor/commands";
import { editHeight, editWidth, effectiveScale, initialRasterSize, proportionsDiffer, selectScale, setAspectLock, sizeForScale } from "./exportDimensions";
import { listExportTargets, renderSvg, sourceBounds } from "./exportRenderer";
import type { ExportRequest, ExportTarget } from "./exportTypes";
import { MAX_SIDE, sanitizeFileName, validateDimensions, validateExport, validateFileName } from "./exportValidation";
import { readImageSize } from "./imageSize";
import { exportImagePdf, exportVectorPdf } from "./pdfExport";
import { encodeRaster, type RasterSurface } from "./rasterExport";
import { exportSvg } from "./svgExport";

const ARTBOARD = { width: 375, height: 812 };

describe("export dimensions", () => {
  it("multiplies the source size for each scale preset", () => {
    expect(sizeForScale(ARTBOARD, 1)).toEqual({ width: 375, height: 812 });
    expect(sizeForScale(ARTBOARD, 2)).toEqual({ width: 750, height: 1624 });
    expect(sizeForScale(ARTBOARD, 3)).toEqual({ width: 1125, height: 2436 });
    expect(sizeForScale(ARTBOARD, 4)).toEqual({ width: 1500, height: 3248 });
  });

  it("derives sizes from whatever the source is, in whole pixels of at least 1", () => {
    expect(sizeForScale({ width: 33, height: 7 }, 3)).toEqual({ width: 99, height: 21 });
    expect(sizeForScale({ width: 10.4, height: 0.2 }, 1)).toEqual({ width: 10, height: 1 });
  });

  it("starts at 1× with the aspect ratio locked", () => {
    expect(initialRasterSize(ARTBOARD)).toEqual({ scale: 1, lockAspect: true, width: 375, height: 812 });
  });

  it("switches to Custom when a dimension is typed, following the lock", () => {
    const start = initialRasterSize(ARTBOARD);
    expect(editWidth(start, ARTBOARD, 750)).toEqual({ scale: "custom", lockAspect: true, width: 750, height: 1624 });
    expect(editHeight(start, ARTBOARD, 406)).toEqual({ scale: "custom", lockAspect: true, width: 188, height: 406 });
  });

  it("lets both dimensions vary independently when unlocked", () => {
    const unlocked = setAspectLock(initialRasterSize(ARTBOARD), ARTBOARD, false);
    const wide = editWidth(unlocked, ARTBOARD, 1000);
    expect(wide).toMatchObject({ scale: "custom", width: 1000, height: 812 });
    expect(editHeight(wide, ARTBOARD, 500)).toMatchObject({ width: 1000, height: 500 });
    expect(proportionsDiffer(wide, ARTBOARD)).toBe(true);
  });

  it("recalculates from the source when going back to a preset", () => {
    const custom = editWidth(setAspectLock(initialRasterSize(ARTBOARD), ARTBOARD, false), ARTBOARD, 999);
    expect(selectScale(custom, ARTBOARD, 3)).toMatchObject({ scale: 3, width: 1125, height: 2436 });
    // Choosing Custom itself keeps the numbers on screen.
    expect(selectScale(selectScale(custom, ARTBOARD, 2), ARTBOARD, "custom")).toMatchObject({ scale: "custom", width: 750, height: 1624 });
  });

  it("restores the artwork's proportions when the lock is turned back on", () => {
    const distorted = { scale: "custom" as const, lockAspect: false, width: 750, height: 100 };
    expect(setAspectLock(distorted, ARTBOARD, true)).toEqual({ scale: "custom", lockAspect: true, width: 750, height: 1624 });
  });

  it("does not treat pixel rounding as a change of proportions", () => {
    expect(proportionsDiffer({ width: 188, height: 406 }, ARTBOARD)).toBe(false);
    expect(proportionsDiffer({ width: 375, height: 600 }, ARTBOARD)).toBe(true);
    expect(effectiveScale({ width: 750, height: 1624 }, ARTBOARD)).toBe(2);
    expect(effectiveScale({ width: 750, height: 100 }, ARTBOARD)).toBeNull();
  });
});

describe("export validation", () => {
  it("accepts sensible sizes", () => {
    expect(validateDimensions({ width: 1500, height: 3248 })).toEqual([]);
  });

  it("explains each kind of invalid size", () => {
    expect(validateDimensions({ width: 0, height: 100 })[0]).toMatch(/Width must be at least 1 px/);
    expect(validateDimensions({ width: 100, height: -4 })[0]).toMatch(/Height must be at least 1 px/);
    expect(validateDimensions({ width: Number.NaN, height: 100 })[0]).toMatch(/Width must be a number/);
    expect(validateDimensions({ width: 10.5, height: 100 })[0]).toMatch(/whole number/);
    expect(validateDimensions({ width: MAX_SIDE + 1, height: 100 })[0]).toMatch(/cannot be larger than 16,384 px/);
    expect(validateDimensions({ width: 16000, height: 16000 })[0]).toMatch(/256,000,000 pixels; the limit is 100,000,000/);
  });

  it("checks file names against both platforms' rules", () => {
    expect(validateFileName("Frame 1@2x")).toBeNull();
    expect(validateFileName("  ")).toMatch(/Enter a file name/);
    expect(validateFileName("a/b")).toMatch(/cannot contain/);
    expect(validateFileName("CON")).toMatch(/reserved/);
    expect(sanitizeFileName('Hero: "Final" / v2?')).toBe("Hero- -Final- - v2-");
    expect(sanitizeFileName("///")).toBe("---");
    expect(sanitizeFileName("")).toBe("Export");
  });
});

function scene() {
  let page: Page = createPage("Test");
  const frame = { ...createFrame({ x: 100, y: 50, width: 375, height: 812 }), name: "Home" };
  const card = { ...createRectangle({ x: 20, y: 30, width: 200, height: 100 }), cornerRadii: [12, 12, 12, 12] as [number, number, number, number], fills: [solidPaint("#ff0000", 0.5)] };
  const title = createText({ x: 20, y: 150, width: 10, height: 10 }, "Hello & <world>");
  const loose = { ...createEllipse({ x: 600, y: 60, width: 80, height: 40 }), strokes: [solidPaint("#0000ff")], strokeWidth: 4 };
  page = insertNode(page, frame);
  page = insertNode(page, card, frame.id);
  page = insertNode(page, title, frame.id);
  page = insertNode(page, loose);
  return { page, frame: frame.id, card: card.id, title: title.id, loose: loose.id };
}

const targetOf = (page: Page, id: string): ExportTarget => listExportTargets(page, [id]).find((t) => t.key === id)!;

function request(target: ExportTarget, overrides: Partial<ExportRequest> = {}): ExportRequest {
  return {
    target,
    format: "png",
    size: { width: 375, height: 812 },
    fit: "contain",
    transparent: true,
    background: "#ffffff",
    quality: 0.9,
    lossless: false,
    pdfMode: "vector",
    fileName: "Home",
    ...overrides,
  };
}

describe("export targets and bounds", () => {
  it("offers the selection, then frames, then the whole page", () => {
    const s = scene();
    expect(listExportTargets(s.page, []).map((t) => t.label)).toEqual(["Home", "Entire page (Test)"]);
    expect(listExportTargets(s.page, [s.card]).map((t) => t.label)).toEqual(["Rectangle", "Home", "Entire page (Test)"]);
    const multi = listExportTargets(s.page, [s.card, s.loose]);
    expect(multi[0]).toMatchObject({ label: "Selection (2 layers)", kind: "selection", nodeIds: [s.card, s.loose] });
  });

  it("exports a frame at exactly its own size", () => {
    const s = scene();
    expect(sourceBounds(s.page, targetOf(s.page, s.frame))).toEqual({ x: 100, y: 50, width: 375, height: 812 });
  });

  it("measures nested objects in page space and includes strokes and shadows", () => {
    const s = scene();
    expect(sourceBounds(s.page, targetOf(s.page, s.card))).toEqual({ x: 120, y: 80, width: 200, height: 100 });
    expect(sourceBounds(s.page, targetOf(s.page, s.loose))).toEqual({ x: 598, y: 58, width: 84, height: 44 });
    const shadowed = patchNodes(s.page, [s.card], { effects: [{ ...dropShadow(), blur: 10, offsetX: 0, offsetY: 6 }] });
    expect(sourceBounds(shadowed, targetOf(shadowed, s.card))).toEqual({ x: 110, y: 76, width: 220, height: 120 });
  });

  it("makes room for spread and blur, and for nothing an inner shadow paints", () => {
    const s = scene();
    const card = { x: 120, y: 80, width: 200, height: 100 };
    const spread = patchNodes(s.page, [s.card], { effects: [{ ...dropShadow(), blur: 10, spread: 5, offsetX: 0, offsetY: 0 }] });
    expect(sourceBounds(spread, targetOf(spread, s.card))).toEqual({ x: card.x - 15, y: card.y - 15, width: card.width + 30, height: card.height + 30 });
    const blurred = patchNodes(s.page, [s.card], { effects: [{ ...layerBlur(), blur: 12 }] });
    expect(sourceBounds(blurred, targetOf(blurred, s.card))).toEqual({ x: card.x - 12, y: card.y - 12, width: card.width + 24, height: card.height + 24 });
    const inner = patchNodes(s.page, [s.card], { effects: [{ ...innerShadow(), blur: 30, offsetX: 20, offsetY: 20 }] });
    expect(sourceBounds(inner, targetOf(inner, s.card))).toEqual(card);
  });

  it("writes every effect into an exported SVG", () => {
    const s = scene();
    const page = patchNodes(s.page, [s.card], { effects: [dropShadow(), innerShadow(), layerBlur()] });
    const svg = renderSvg(page, targetOf(page, s.card));
    expect(svg).toContain("<filter");
    expect(svg).toContain("feGaussianBlur"); // layer blur and both shadows
    expect(svg).toContain("feComponentTransfer"); // inner shadow's inverted edge
    expect((svg.match(/<feFlood/g) ?? []).length).toBe(2); // one colour per shadow
  });

  it("gives a thin line a real area to export", () => {
    let page = createPage("Test");
    const line = createLine({ x: 10, y: 20 }, { x: 110, y: 20 });
    page = insertNode(page, line);
    expect(sourceBounds(page, targetOf(page, line.id))).toEqual({ x: 10, y: 19, width: 100, height: 2 });
  });

  it("covers every member of a group or multi-selection", () => {
    const s = scene();
    const grouped = groupNodes(s.page, [s.card, s.title]);
    const bounds = sourceBounds(grouped.page, targetOf(grouped.page, grouped.groupId!));
    expect(bounds).toMatchObject({ x: 120, y: 80 });
    expect(bounds.height).toBeGreaterThan(120);
  });

  it("rejects exporting nothing or an invalid request", () => {
    const s = scene();
    const target = targetOf(s.page, s.frame);
    const source = sourceBounds(s.page, target);
    expect(validateExport(request(target), source)).toEqual([]);
    expect(validateExport(request({ ...target, nodeIds: [] }), source)).toContain("There is nothing to export.");
    expect(validateExport(request(target, { size: { width: 0, height: 10 } }), source).join()).toMatch(/Width must be at least 1 px/);
    expect(validateExport(request(target, { format: "jpg", background: "white" }), source)).toContain("Choose a background colour.");
    expect(validateExport(request(target, { fileName: "" }), source)).toContain("Enter a file name.");
    // Vector formats ignore the raster size controls.
    expect(validateExport(request(target, { format: "svg", size: { width: 0, height: 0 } }), source)).toEqual([]);
  });
});

describe("SVG rendering", () => {
  it("renders the document content at the requested output size", () => {
    const s = scene();
    const svg = renderSvg(s.page, targetOf(s.page, s.frame), { size: { width: 1500, height: 3248 } });
    expect(svg).toContain('<svg xmlns="http://www.w3.org/2000/svg" width="1500" height="3248" viewBox="0 0 1500 3248">');
    // The artwork keeps its own coordinate system and is scaled as vectors.
    expect(svg).toContain('viewBox="100 50 375 812"');
    expect(svg).toContain('rx="12"');
    expect(svg).toContain('fill="#ff0000" fill-opacity="0.5"');
    expect(svg).toContain("Hello &amp; &lt;world&gt;");
    expect(svg).toContain("clip-path=");
  });

  it("leaves out editor-only markup and other objects", () => {
    const s = scene();
    const svg = renderSvg(s.page, targetOf(s.page, s.frame));
    expect(svg).not.toContain("data-node-id");
    expect(svg).not.toContain('fill="transparent"');
    expect(svg).not.toContain("<ellipse");
  });

  it("places a nested object using its parents' position", () => {
    const s = scene();
    const svg = renderSvg(s.page, targetOf(s.page, s.card));
    expect(svg).toContain('viewBox="120 80 200 100"');
    expect(svg).toContain('transform="matrix(1 0 0 1 100 50)"');
  });

  it("paints the background across the whole output and applies the fit mode", () => {
    const s = scene();
    const target = targetOf(s.page, s.frame);
    const boxed = renderSvg(s.page, target, { size: { width: 800, height: 800 }, fit: "contain", background: "#00ff00" });
    expect(boxed).toContain('<rect width="800" height="800" fill="#00ff00">');
    expect(boxed).toContain('preserveAspectRatio="xMidYMid meet"');
    expect(renderSvg(s.page, target, { fit: "cover" })).toContain('preserveAspectRatio="xMidYMid slice"');
    expect(renderSvg(s.page, target, { fit: "stretch" })).toContain('preserveAspectRatio="none"');
    expect(renderSvg(s.page, target)).not.toContain("<rect width=\"375\" height=\"812\" fill=\"#");
  });

  it("skips hidden layers", () => {
    const s = scene();
    const hidden = patchNodes(s.page, [s.title], { visible: false });
    expect(renderSvg(hidden, targetOf(hidden, s.frame))).not.toContain("<text");
  });

  it("exports SVG at the source size and warns about fonts when there is text", () => {
    const s = scene();
    const result = exportSvg(s.page, request(targetOf(s.page, s.frame), { format: "svg" }));
    expect(result).toMatchObject({ width: 375, height: 812 });
    expect(result.warnings).toHaveLength(1);
    expect(new TextDecoder().decode(result.bytes)).toMatch(/^<\?xml version="1.0"/);
    expect(exportSvg(s.page, request(targetOf(s.page, s.card), { format: "svg" })).warnings).toEqual([]);
  });
});

describe("raster encoding", () => {
  const surface = (): RasterSurface & { calls: [string, number | undefined][] } => {
    const calls: [string, number | undefined][] = [];
    return {
      width: 4,
      height: 2,
      calls,
      toBlob: async (type, quality) => {
        calls.push([type, quality]);
        return new Blob([new Uint8Array([1, 2, 3])], { type });
      },
      getImageData: () => ({ width: 4, height: 2, data: new Uint8ClampedArray(32), colorSpace: "srgb" }) as ImageData,
    };
  };

  it("passes the JPG quality to the encoder as a 0–1 value", async () => {
    const s = surface();
    await encodeRaster(s, "jpg", { quality: 0.73, lossless: false });
    expect(s.calls).toEqual([["image/jpeg", 0.73]]);
  });

  it("encodes PNG without a quality setting", async () => {
    const s = surface();
    expect(await encodeRaster(s, "png", { quality: 0.5, lossless: false })).toEqual(new Uint8Array([1, 2, 3]));
    expect(s.calls).toEqual([["image/png", undefined]]);
  });

  it("passes WebP quality on the encoder's 0–100 scale, with lossless kept separate", async () => {
    const encode = vi.fn(async () => new Uint8Array([9]).buffer);
    await encodeRaster(surface(), "webp", { quality: 1, lossless: false }, encode);
    await encodeRaster(surface(), "webp", { quality: 0.8, lossless: true }, encode);
    expect(encode.mock.calls.map((c) => (c as unknown[])[1])).toEqual([
      { quality: 100, lossless: false },
      { quality: 80, lossless: true },
    ]);
  });

  it("fails loudly when the device cannot produce the format", async () => {
    const broken: RasterSurface = { ...surface(), toBlob: async () => new Blob([], { type: "image/png" }) };
    await expect(encodeRaster(broken, "jpg", { quality: 0.9, lossless: false })).rejects.toThrow(/could not encode a JPG/);
  });
});

describe("image size reader", () => {
  it("reads PNG, JPEG and WebP headers", () => {
    const png = new Uint8Array(24);
    png.set([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52, 0, 0, 0x05, 0xdc, 0, 0, 0x0c, 0xb0]);
    expect(readImageSize(png)).toEqual({ width: 1500, height: 3248 });

    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 0, 4, 0, 0, 0xff, 0xc0, 0, 11, 8, 0x06, 0x58, 0x02, 0xee, 3, 0, 0, 0]);
    expect(readImageSize(jpeg)).toEqual({ width: 750, height: 1624 });

    const webp = new Uint8Array(30);
    webp.set([..."RIFF"].map((c) => c.charCodeAt(0)), 0);
    webp.set([..."WEBPVP8X"].map((c) => c.charCodeAt(0)), 8);
    webp.set([0x76, 0x01, 0x00, 0x2b, 0x03, 0x00], 24);
    expect(readImageSize(webp)).toEqual({ width: 375, height: 812 });
    expect(readImageSize(new Uint8Array([1, 2, 3]))).toBeNull();
  });
});

describe("PDF export", () => {
  const text = (bytes: Uint8Array) => new TextDecoder("latin1").decode(bytes);

  it("writes a one-page vector PDF the size of the artwork", () => {
    const s = scene();
    const result = exportVectorPdf(s.page, request(targetOf(s.page, s.frame), { format: "pdf" }));
    const pdf = text(result.bytes);
    expect(pdf.startsWith("%PDF-1.4")).toBe(true);
    expect(pdf.trimEnd().endsWith("%%EOF")).toBe(true);
    expect(pdf).toContain("/MediaBox [0 0 375 812]");
    expect(pdf).toContain("/BaseFont /Helvetica");
    expect(pdf).toContain("(Hello & <world>) Tj");
    // Half-transparent red fill, drawn as a path.
    expect(pdf).toContain("/GS500 gs\n1 0 0 rg");
    expect(pdf).toContain("/GS500 << /ca 0.5 /CA 0.5 >>");
    expect(pdf).toContain("W n");
    expect(result).toMatchObject({ width: 375, height: 812 });
  });

  it("has a cross-reference table that points at every object", () => {
    const s = scene();
    const pdf = text(exportVectorPdf(s.page, request(targetOf(s.page, s.frame), { format: "pdf" })).bytes);
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1]);
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe("xref");
    const offsets = [...pdf.slice(xrefAt).matchAll(/(\d{10}) 00000 n/g)].map((m) => Number(m[1]));
    expect(offsets).toHaveLength(4);
    offsets.forEach((offset, i) => expect(pdf.slice(offset, offset + 8)).toBe(`${i + 1} 0 obj\n`));
  });

  it("says what a vector PDF cannot carry instead of dropping it silently", () => {
    const s = scene();
    let page = patchNodes(s.page, [s.card], { effects: [dropShadow()] });
    page = patchNodes(page, [s.title], { text: "Привет", fontFamily: "Georgia" });
    const { warnings, bytes } = exportVectorPdf(page, request(targetOf(page, s.frame), { format: "pdf" }));
    expect(warnings.join("\n")).toMatch(/Shadows and blur effects are not included/);
    expect(warnings.join("\n")).toMatch(/replaced with/);
    expect(warnings.join("\n")).toMatch(/Georgia uses the PDF's built-in Times/);
    expect(text(bytes)).toContain("/BaseFont /Times-Roman");
  });

  it("paints the chosen background when one is requested", () => {
    const s = scene();
    const pdf = text(exportVectorPdf(s.page, request(targetOf(s.page, s.frame), { format: "pdf", transparent: false, background: "#0000ff" })).bytes);
    expect(pdf).toContain("0 0 1 rg\n0 0 375 812 re\nf");
  });

  it("embeds a JPEG untouched in image mode", () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 1, 2, 3, 0xff, 0xd9]);
    const pdf = text(exportImagePdf({ width: 375, height: 812 }, jpeg, { width: 750, height: 1624 }).bytes);
    expect(pdf).toContain("/Width 750 /Height 1624");
    expect(pdf).toContain("/Filter /DCTDecode /Length 7");
    expect(pdf).toContain("q 375 0 0 812 0 0 cm /Im1 Do Q");
  });
});
