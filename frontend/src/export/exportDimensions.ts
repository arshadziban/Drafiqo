import type { RasterSize, ScaleMode, Size } from "./exportTypes";

const whole = (value: number) => Math.max(1, Math.round(value));

/** Output size for a scale factor: the source dimensions multiplied and rounded to whole pixels. */
export function sizeForScale(source: Size, scale: number): Size {
  return { width: whole(source.width * scale), height: whole(source.height * scale) };
}

export function initialRasterSize(source: Size): RasterSize {
  return { scale: 1, lockAspect: true, ...sizeForScale(source, 1) };
}

/**
 * Picks a preset (recomputing the size from the source) or switches to
 * Custom, which keeps whatever size is currently shown.
 */
export function selectScale(size: RasterSize, source: Size, scale: ScaleMode): RasterSize {
  if (scale === "custom") return { ...size, scale };
  return { ...size, scale, ...sizeForScale(source, scale) };
}

/** Typing a width switches to Custom; with the lock on, the height follows the source proportions. */
export function editWidth(size: RasterSize, source: Size, width: number): RasterSize {
  const height = size.lockAspect && source.width > 0 ? whole((width * source.height) / source.width) : size.height;
  return { ...size, scale: "custom", width, height };
}

export function editHeight(size: RasterSize, source: Size, height: number): RasterSize {
  const width = size.lockAspect && source.height > 0 ? whole((height * source.width) / source.height) : size.width;
  return { ...size, scale: "custom", width, height };
}

/** Turning the lock back on restores the source proportions, keeping the current width. */
export function setAspectLock(size: RasterSize, source: Size, lockAspect: boolean): RasterSize {
  if (!lockAspect || !proportionsDiffer(size, source)) return { ...size, lockAspect };
  return { ...size, lockAspect, scale: "custom", height: whole((size.width * source.height) / source.width) };
}

/**
 * True when the output would not have the artwork's proportions. Sizes that
 * differ only by pixel rounding count as the same.
 */
export function proportionsDiffer(size: Size, source: Size): boolean {
  if (source.width <= 0 || source.height <= 0) return false;
  const expectedHeight = (size.width * source.height) / source.width;
  const expectedWidth = (size.height * source.width) / source.height;
  return Math.abs(expectedHeight - size.height) > 1 && Math.abs(expectedWidth - size.width) > 1;
}

/** The scale a size corresponds to, for display ("2×"), or null when it is not a uniform scale. */
export function effectiveScale(size: Size, source: Size): number | null {
  if (proportionsDiffer(size, source) || source.width <= 0) return null;
  return Math.round((size.width / source.width) * 100) / 100;
}
