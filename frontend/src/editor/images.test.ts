import { describe, expect, it } from "vitest";
import { createFrame, createPage, createRectangle } from "../document/factory";
import { insertNode, patchNodes } from "./commands";
import { assetIdFor, baseName, containerAt, fitWithin, imageMime, MAX_IMAGE_BYTES, MAX_IMAGE_SIDE, placementBox } from "./images";

describe("imageMime", () => {
  it("trusts a reported image type", () => {
    expect(imageMime({ name: "a", type: "image/png" })).toBe("image/png");
    expect(imageMime({ name: "a", type: "IMAGE/JPEG" })).toBe("image/jpeg");
    expect(imageMime({ name: "a.bin", type: "image/svg+xml" })).toBe("image/svg+xml");
  });

  it("falls back to the extension when the system reports nothing", () => {
    expect(imageMime({ name: "photo.JPG", type: "" })).toBe("image/jpeg");
    expect(imageMime({ name: "logo.webp", type: "application/octet-stream" })).toBe("image/webp");
    expect(imageMime({ name: "icon.svg", type: "" })).toBe("image/svg+xml");
  });

  it("refuses everything else", () => {
    expect(imageMime({ name: "notes.txt", type: "text/plain" })).toBeNull();
    expect(imageMime({ name: "scan.tiff", type: "image/tiff" })).toBeNull();
    expect(imageMime({ name: "noextension", type: "" })).toBeNull();
    expect(imageMime({ name: "paper.pdf", type: "application/pdf" })).toBeNull();
  });
});

describe("baseName", () => {
  it("drops the extension", () => {
    expect(baseName("holiday photo.JPG")).toBe("holiday photo");
    expect(baseName("archive.tar.png")).toBe("archive.tar");
  });

  it("keeps names without one and falls back for empty ones", () => {
    expect(baseName("readme")).toBe("readme");
    expect(baseName(".png")).toBe(".png");
    expect(baseName("   .jpg")).toBe("Image");
    expect(baseName("")).toBe("Image");
  });
});

describe("fitWithin", () => {
  it("shrinks to fit and keeps the proportions", () => {
    expect(fitWithin({ width: 2000, height: 1000 }, { width: 500, height: 500 })).toEqual({ width: 500, height: 250 });
    expect(fitWithin({ width: 1000, height: 3000 }, { width: 600, height: 600 })).toEqual({ width: 200, height: 600 });
  });

  it("never enlarges", () => {
    expect(fitWithin({ width: 40, height: 20 }, { width: 1000, height: 1000 })).toEqual({ width: 40, height: 20 });
  });

  it("stays at least one pixel", () => {
    expect(fitWithin({ width: 10000, height: 1 }, { width: 100, height: 100 })).toEqual({ width: 100, height: 1 });
  });
});

describe("placementBox", () => {
  const visible = { width: 1000, height: 600 };

  it("centres a small picture at its own size", () => {
    expect(placementBox({ width: 200, height: 100 }, visible, { x: 500, y: 300 })).toEqual({ width: 200, height: 100, x: 400, y: 250 });
  });

  it("shrinks a big picture to 80% of what is visible", () => {
    const box = placementBox({ width: 4000, height: 2000 }, visible, { x: 500, y: 300 });
    expect(box.width).toBe(800);
    expect(box.height).toBe(400);
    expect(box.x).toBe(100);
    expect(box.y).toBe(100);
  });

  it("staggers several pictures so none hides another", () => {
    const first = placementBox({ width: 100, height: 100 }, visible, { x: 0, y: 0 }, 0);
    const third = placementBox({ width: 100, height: 100 }, visible, { x: 0, y: 0 }, 2);
    expect(third.x - first.x).toBe(48);
    expect(third.y - first.y).toBe(48);
  });
});

describe("assetIdFor", () => {
  it("gives the same id to the same picture and different ids to different ones", async () => {
    const a = await assetIdFor("data:image/png;base64,AAAA");
    expect(await assetIdFor("data:image/png;base64,AAAA")).toBe(a);
    expect(await assetIdFor("data:image/png;base64,BBBB")).not.toBe(a);
    expect(a).toMatch(/^img_[0-9a-f]{24}$/);
  });
});

describe("limits", () => {
  it("match what Figma allows", () => {
    expect(MAX_IMAGE_SIDE).toBe(4096);
    expect(MAX_IMAGE_BYTES).toBe(25 * 1024 * 1024);
  });
});

describe("containerAt", () => {
  const outer = { ...createFrame({ x: 100, y: 100, width: 400, height: 300 }), id: "outer" };
  const inner = { ...createFrame({ x: 50, y: 50, width: 100, height: 100 }), id: "inner" };
  const build = () => {
    let page = createPage("Test");
    page = insertNode(page, outer);
    page = insertNode(page, inner, "outer");
    return page;
  };

  it("finds the frame under a point, and the page when there is none", () => {
    const page = build();
    expect(containerAt(page, { x: 450, y: 350 })).toBe("outer");
    expect(containerAt(page, { x: 10, y: 10 })).toBeNull();
    expect(containerAt(page, { x: 501, y: 200 })).toBeNull();
  });

  it("prefers the innermost frame", () => {
    // `inner` sits at (150, 150) on the page.
    expect(containerAt(build(), { x: 200, y: 200 })).toBe("inner");
    expect(containerAt(build(), { x: 300, y: 200 })).toBe("outer");
  });

  it("skips frames that are hidden or locked, and ignores shapes that are not containers", () => {
    let page = build();
    page = patchNodes(page, ["inner"], { locked: true });
    expect(containerAt(page, { x: 200, y: 200 })).toBe("outer");
    page = patchNodes(page, ["outer"], { visible: false });
    expect(containerAt(page, { x: 200, y: 200 })).toBeNull();
    const withRect = insertNode(createPage("Rect"), createRectangle({ x: 0, y: 0, width: 100, height: 100 }));
    expect(containerAt(withRect, { x: 50, y: 50 })).toBeNull();
  });

  it("works for a rotated frame", () => {
    const rotated = { ...createFrame({ x: 100, y: 100, width: 200, height: 20 }), id: "tilted", rotation: 90 };
    const page = insertNode(createPage("Tilt"), rotated);
    // Turned 90° about its centre (200, 110), it now covers x 190–210 and y 10–210.
    expect(containerAt(page, { x: 200, y: 30 })).toBe("tilted");
    expect(containerAt(page, { x: 290, y: 110 })).toBeNull();
  });
});
