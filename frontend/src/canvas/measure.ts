import type { FontSpec, TextMeasurer } from "../document/textLayout";
import { fontStack } from "./renderNode";

/** Measures text with a 2D canvas so wrapping matches what the browser draws. */
export function createCanvasMeasurer(): TextMeasurer | null {
  const context = document.createElement("canvas").getContext("2d");
  if (!context) return null;
  const use = (font: FontSpec) => {
    context.font = `${font.fontWeight} ${font.fontSize}px ${fontStack(font.fontFamily)}`;
  };
  return {
    width(text, font) {
      use(font);
      return context.measureText(text).width + text.length * font.letterSpacing;
    },
    metrics(font) {
      use(font);
      const m = context.measureText("Hg");
      const ascent = m.fontBoundingBoxAscent ?? m.actualBoundingBoxAscent;
      const descent = m.fontBoundingBoxDescent ?? m.actualBoundingBoxDescent;
      return { ascent, descent };
    },
  };
}
