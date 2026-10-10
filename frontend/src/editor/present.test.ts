import { describe, expect, it } from "vitest";
import { createFrame, createPage, createRectangle } from "../document/factory";
import { groupNodes, insertNode, patchNodes } from "./commands";
import { presentationSlides, readingOrder, slideOfSelection } from "./present";

const frame = (id: string, x: number, y: number, width = 100, height = 100) => ({ ...createFrame({ x, y, width, height }), id, name: id });

function pageWith(...frames: ReturnType<typeof frame>[]) {
  return frames.reduce((page, f) => insertNode(page, f), createPage("Slides"));
}

describe("readingOrder", () => {
  const box = (id: string, x: number, y: number, width = 100, height = 100) => ({ id, x, y, width, height });

  it("goes left to right along a row", () => {
    expect(readingOrder([box("c", 500, 0), box("a", 0, 0), box("b", 250, 0)]).map((b) => b.id)).toEqual(["a", "b", "c"]);
  });

  it("goes row by row, top to bottom", () => {
    const order = readingOrder([box("d", 300, 400), box("b", 300, 0), box("c", 0, 400), box("a", 0, 0)]);
    expect(order.map((b) => b.id)).toEqual(["a", "b", "c", "d"]);
  });

  it("keeps slightly misaligned frames in one row, whichever is higher", () => {
    const order = readingOrder([box("right", 300, 0), box("left", 0, 30), box("middle", 150, 12)]);
    expect(order.map((b) => b.id)).toEqual(["left", "middle", "right"]);
  });

  it("puts a tall frame beside short ones in the same row when its middle lines up", () => {
    const order = readingOrder([box("tall", 0, 0, 100, 600), box("short", 200, 250, 100, 100)]);
    expect(order.map((b) => b.id)).toEqual(["tall", "short"]);
  });

  it("returns an empty list for nothing", () => {
    expect(readingOrder([])).toEqual([]);
  });
});

describe("presentationSlides", () => {
  it("makes a slide of each top-level frame, in reading order, whatever the layer order", () => {
    const page = pageWith(frame("right", 400, 0), frame("left", 0, 0), frame("below", 0, 400));
    const slides = presentationSlides(page);
    expect(slides.map((s) => s.name)).toEqual(["left", "right", "below"]);
    expect(slides.every((s) => s.kind === "node")).toBe(true);
    expect(slides[0]).toMatchObject({ key: "left", nodeIds: ["left"] });
  });

  it("skips hidden frames and frames inside other frames", () => {
    let page = pageWith(frame("a", 0, 0), frame("hidden", 300, 0), frame("b", 600, 0));
    page = insertNode(page, frame("nested", 10, 10, 20, 20), "a");
    page = patchNodes(page, ["hidden"], { visible: false });
    expect(presentationSlides(page).map((s) => s.name)).toEqual(["a", "b"]);
  });

  it("shows the whole page as one slide when it has no frames", () => {
    let page = insertNode(createPage("Loose"), createRectangle({ x: 0, y: 0, width: 50, height: 50 }));
    page = insertNode(page, createRectangle({ x: 100, y: 0, width: 50, height: 50 }));
    const slides = presentationSlides(page);
    expect(slides).toHaveLength(1);
    expect(slides[0]).toMatchObject({ key: "page", name: "Loose", kind: "page" });
    expect(slides[0]!.nodeIds).toHaveLength(2);
  });

  it("has nothing to show on an empty page, or one whose layers are all hidden", () => {
    expect(presentationSlides(createPage("Empty"))).toEqual([]);
    const hidden = patchNodes(insertNode(createPage("Hidden"), { ...createRectangle({ x: 0, y: 0, width: 5, height: 5 }), id: "r" }), ["r"], { visible: false });
    expect(presentationSlides(hidden)).toEqual([]);
  });
});

describe("slideOfSelection", () => {
  it("finds the slide holding a selected frame or anything inside it", () => {
    let page = pageWith(frame("a", 0, 0), frame("b", 400, 0));
    page = insertNode(page, { ...createRectangle({ x: 5, y: 5, width: 10, height: 10 }), id: "inside-b" }, "b");
    const slides = presentationSlides(page);
    expect(slideOfSelection(page, slides, ["b"])).toBe(1);
    expect(slideOfSelection(page, slides, ["inside-b"])).toBe(1);
    expect(slideOfSelection(page, slides, ["a"])).toBe(0);
  });

  it("is null for no selection, unknown layers, or layers outside every frame", () => {
    let page = pageWith(frame("a", 0, 0));
    page = insertNode(page, { ...createRectangle({ x: 500, y: 0, width: 10, height: 10 }), id: "loose" });
    const slides = presentationSlides(page);
    expect(slideOfSelection(page, slides, [])).toBeNull();
    expect(slideOfSelection(page, slides, ["nope"])).toBeNull();
    expect(slideOfSelection(page, slides, ["loose"])).toBeNull();
  });

  it("uses the first selected layer that is on a slide", () => {
    const page = pageWith(frame("a", 0, 0), frame("b", 400, 0));
    expect(slideOfSelection(page, presentationSlides(page), ["b", "a"])).toBe(1);
  });

  it("works for a layer inside a group inside a frame", () => {
    let page = pageWith(frame("a", 0, 0), frame("b", 400, 0));
    page = insertNode(page, { ...createRectangle({ x: 1, y: 1, width: 5, height: 5 }), id: "r1" }, "b");
    page = insertNode(page, { ...createRectangle({ x: 9, y: 9, width: 5, height: 5 }), id: "r2" }, "b");
    page = groupNodes(page, ["r1", "r2"]).page;
    expect(slideOfSelection(page, presentationSlides(page), ["r1"])).toBe(1);
  });
});
