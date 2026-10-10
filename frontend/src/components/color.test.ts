import { describe, expect, it } from "vitest";
import { hexToHsv, hexToRgb, hsvToHex, hsvToRgb, normalizeHex, pixelHex, rgbToHex, rgbToHsv } from "./color";

describe("normalizeHex", () => {
  it("accepts 3 and 6 digit hex with or without #", () => {
    expect(normalizeHex("#ABC")).toBe("#aabbcc");
    expect(normalizeHex("abc")).toBe("#aabbcc");
    expect(normalizeHex(" 007AFF ")).toBe("#007aff");
  });

  it("rejects anything else", () => {
    expect(normalizeHex("")).toBeNull();
    expect(normalizeHex("12345")).toBeNull();
    expect(normalizeHex("#gggggg")).toBeNull();
    expect(normalizeHex("#0000000")).toBeNull();
  });
});

describe("rgb and hex", () => {
  it("converts both ways", () => {
    expect(hexToRgb("#be9d9d")).toEqual({ r: 190, g: 157, b: 157 });
    expect(rgbToHex({ r: 190, g: 157, b: 157 })).toBe("#be9d9d");
  });

  it("clamps out-of-range channels", () => {
    expect(rgbToHex({ r: -5, g: 300, b: 127.6 })).toBe("#00ff80");
  });
});

describe("hsv", () => {
  it("matches known colours", () => {
    expect(rgbToHsv({ r: 255, g: 0, b: 0 })).toEqual({ h: 0, s: 1, v: 1 });
    expect(rgbToHsv({ r: 0, g: 255, b: 0 }).h).toBe(120);
    expect(rgbToHsv({ r: 0, g: 0, b: 255 }).h).toBe(240);
    expect(rgbToHsv({ r: 255, g: 255, b: 255 })).toEqual({ h: 0, s: 0, v: 1 });
    expect(rgbToHsv({ r: 0, g: 0, b: 0 })).toEqual({ h: 0, s: 0, v: 0 });
    expect(hsvToRgb({ h: 210, s: 1, v: 1 })).toEqual({ r: 0, g: 128, b: 255 });
  });

  it("wraps hue", () => {
    expect(hsvToRgb({ h: 360, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 0, s: 1, v: 1 }));
    expect(hsvToRgb({ h: -120, s: 1, v: 1 })).toEqual(hsvToRgb({ h: 240, s: 1, v: 1 }));
  });

  it("round-trips every colour on a coarse grid", () => {
    for (let r = 0; r < 256; r += 51) {
      for (let g = 0; g < 256; g += 51) {
        for (let b = 0; b < 256; b += 51) {
          const hex = rgbToHex({ r, g, b });
          expect(hsvToHex(hexToHsv(hex))).toBe(hex);
        }
      }
    }
  });
});

describe("pixelHex", () => {
  // 2 × 2 image: red, green / blue, white
  const data = new Uint8ClampedArray([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);

  it("reads the pixel at (x, y)", () => {
    expect(pixelHex(data, 2, 2, 0, 0)).toBe("#ff0000");
    expect(pixelHex(data, 2, 2, 1, 0)).toBe("#00ff00");
    expect(pixelHex(data, 2, 2, 0, 1)).toBe("#0000ff");
    expect(pixelHex(data, 2, 2, 1, 1)).toBe("#ffffff");
  });

  it("returns null outside the image", () => {
    expect(pixelHex(data, 2, 2, -1, 0)).toBeNull();
    expect(pixelHex(data, 2, 2, 2, 0)).toBeNull();
    expect(pixelHex(data, 2, 2, 0, 2)).toBeNull();
    expect(pixelHex(data, 2, 2, 0.5, 0)).toBeNull();
  });
});
