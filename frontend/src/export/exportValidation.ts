import { isRaster, type ExportRequest, type Size } from "./exportTypes";

/** Largest side a browser canvas reliably supports. */
export const MAX_SIDE = 16384;
/** Upper bound on total pixels, to keep memory use sane (about 400 MB uncompressed). */
export const MAX_PIXELS = 100_000_000;

const formatCount = (n: number) => n.toLocaleString("en-US");

export function validateDimensions(size: Size): string[] {
  const errors: string[] = [];
  for (const [name, value] of [
    ["Width", size.width],
    ["Height", size.height],
  ] as const) {
    if (!Number.isFinite(value)) errors.push(`${name} must be a number.`);
    else if (!Number.isInteger(value)) errors.push(`${name} must be a whole number of pixels.`);
    else if (value < 1) errors.push(`${name} must be at least 1 px.`);
    else if (value > MAX_SIDE) errors.push(`${name} cannot be larger than ${formatCount(MAX_SIDE)} px.`);
  }
  if (errors.length === 0 && size.width * size.height > MAX_PIXELS) {
    errors.push(
      `${formatCount(size.width)} × ${formatCount(size.height)} px is ${formatCount(size.width * size.height)} pixels; the limit is ${formatCount(MAX_PIXELS)}. Use a smaller scale.`,
    );
  }
  return errors;
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Checks a file name (without extension) against what Windows and macOS both accept. */
export function validateFileName(name: string): string | null {
  const trimmed = name.trim();
  if (trimmed === "") return "Enter a file name.";
  if (/[\\/:*?"<>|]/.test(trimmed)) return 'A file name cannot contain \\ / : * ? " < > |';
  // eslint-disable-next-line no-control-regex
  if (/[\u0000-\u001f]/.test(trimmed)) return "A file name cannot contain control characters.";
  if (trimmed.endsWith(".") || trimmed.startsWith(".")) return "A file name cannot start or end with a dot.";
  if (RESERVED_NAMES.test(trimmed)) return `"${trimmed}" is a reserved name on Windows.`;
  if (trimmed.length > 200) return "The file name is too long.";
  return null;
}

/** Everything that would stop this export, in plain language. Empty means it can run. */
export function validateExport(request: ExportRequest, source: Size): string[] {
  const errors: string[] = [];
  if (request.target.nodeIds.length === 0) errors.push("There is nothing to export.");
  if (source.width <= 0 || source.height <= 0) errors.push("The export target has no size.");
  if (isRaster(request.format)) {
    errors.push(...validateDimensions(request.size));
    if (request.format !== "png" && !(request.quality >= 0 && request.quality <= 1)) errors.push("Quality must be between 0% and 100%.");
  }
  if ((request.format === "jpg" || !request.transparent) && !/^#[0-9a-fA-F]{6}$/.test(request.background)) {
    errors.push("Choose a background colour.");
  }
  const nameError = validateFileName(request.fileName);
  if (nameError) errors.push(nameError);
  return errors;
}

export function sanitizeFileName(name: string): string {
  // eslint-disable-next-line no-control-regex
  const cleaned = name.replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-").replace(/^\.+|\.+$/g, "").trim();
  return cleaned === "" || RESERVED_NAMES.test(cleaned) ? "Export" : cleaned.slice(0, 200);
}
