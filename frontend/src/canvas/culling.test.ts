import { describe, expect, it } from "vitest";
import { createFrame, createPage, createRectangle } from "../document/factory";
import { insertNode } from "../editor/commands";
import { culledNodes } from "./culling";

const size = { width: 1000, height: 800 };

function board() {
  let page = createPage("Test");
  const frame = createFrame({ x: 0, y: 0, width: 4000, height: 4000 });
  const near = createRectangle({ x: 100, y: 100, width: 24, height: 24 });
  const far = createRectangle({ x: 3500, y: 3500, width: 24, height: 24 });
  const loose = { ...createFrame({ x: 5000, y: 0, width: 100, height: 100 }), clipContent: false };
  const spill = createRectangle({ x: -4900, y: 50, width: 50, height: 50 });
  const away = createRectangle({ x: 9000, y: 9000, width: 50, height: 50 });
  page = insertNode(page, frame);
  page = insertNode(insertNode(page, near, frame.id), far, frame.id);
  page = insertNode(insertNode(page, loose), spill, loose.id);
  page = insertNode(page, away);
  return { page, frame: frame.id, near: near.id, far: far.id, loose: loose.id, spill: spill.id, away: away.id };
}

describe("culling", () => {
  it("leaves out what is outside the window, with a margin", () => {
    const { page, frame, near, far, loose, spill, away } = board();
    const hidden = culledNodes(page, { x: 0, y: 0, zoom: 1 }, size);
    expect(hidden.has(frame)).toBe(false);
    expect(hidden.has(near)).toBe(false);
    expect(hidden.has(far)).toBe(true);
    expect(hidden.has(away)).toBe(true);
    // An unclipped frame may show children far outside its own box, so it is always drawn; its children are judged one by one.
    expect(hidden.has(loose)).toBe(false);
    expect(hidden.has(spill)).toBe(false);
    // Just past the edge is still drawn, so a small pan needs nothing new.
    const nudged = culledNodes(page, { x: -500, y: 0, zoom: 1 }, size);
    expect(nudged.has(near)).toBe(false);
    expect(culledNodes(page, { x: -3000, y: -3000, zoom: 1 }, size).has(near)).toBe(true);
  });

  it("leaves out layers too small to see when zoomed far out", () => {
    const { page, near, far, frame } = board();
    const hidden = culledNodes(page, { x: 0, y: 0, zoom: 0.02 }, size);
    expect(hidden.has(near)).toBe(true);
    expect(hidden.has(far)).toBe(true);
    expect(hidden.has(frame)).toBe(false);
    expect(culledNodes(page, { x: 0, y: 0, zoom: 0.1 }, size).has(near)).toBe(false);
  });
});
