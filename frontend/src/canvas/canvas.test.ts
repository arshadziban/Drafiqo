import { describe, expect, it } from "vitest";
import { createFrame, createPage, createRectangle } from "../document/factory";
import { groupNodes, insertNode } from "../editor/commands";
import { nodesInMarquee, resolveClickTarget, resolveDrillTarget } from "./hitTest";
import { polygonPoints, vectorPath } from "./shapes";
import { snapRect } from "./snapping";

function scene() {
  let page = createPage("Test");
  const frame = createFrame({ x: 0, y: 0, width: 500, height: 500 });
  const a = createRectangle({ x: 10, y: 10, width: 50, height: 50 });
  const b = createRectangle({ x: 100, y: 10, width: 50, height: 50 });
  const loose = createRectangle({ x: 600, y: 0, width: 50, height: 50 });
  const empty = createFrame({ x: 800, y: 0, width: 100, height: 100 });
  page = insertNode(page, frame);
  page = insertNode(page, a, frame.id);
  page = insertNode(page, b, frame.id);
  page = insertNode(page, loose);
  page = insertNode(page, empty);
  const grouped = groupNodes(page, [a.id, b.id]);
  return { page: grouped.page, frame: frame.id, a: a.id, b: b.id, loose: loose.id, empty: empty.id, group: grouped.groupId! };
}

describe("click targets", () => {
  it("picks a group as a whole, then its children once inside it", () => {
    const s = scene();
    expect(resolveClickTarget(s.page, s.a, [], false)).toBe(s.group);
    expect(resolveClickTarget(s.page, s.a, [s.group], false)).toBe(s.group);
    expect(resolveDrillTarget(s.page, s.a, s.group)).toBe(s.a);
    // With a sibling already selected the click stays inside the group.
    expect(resolveClickTarget(s.page, s.b, [s.a], false)).toBe(s.b);
  });

  it("deep-selects with the modifier", () => {
    const s = scene();
    expect(resolveClickTarget(s.page, s.a, [], true)).toBe(s.a);
  });

  it("treats the background of a filled top-level frame as empty canvas", () => {
    const s = scene();
    expect(resolveClickTarget(s.page, s.frame, [], false)).toBeNull();
    expect(resolveClickTarget(s.page, s.empty, [], false)).toBe(s.empty);
    expect(resolveClickTarget(s.page, s.loose, [], false)).toBe(s.loose);
  });
});

describe("marquee", () => {
  it("selects what it touches inside a frame, and the frame only when enclosing it", () => {
    const s = scene();
    expect(nodesInMarquee(s.page, { x: 5, y: 5, width: 20, height: 20 })).toEqual([s.group]);
    expect(nodesInMarquee(s.page, { x: -10, y: -10, width: 700, height: 600 })).toEqual([s.frame, s.loose]);
    expect(nodesInMarquee(s.page, { x: 300, y: 300, width: 20, height: 20 })).toEqual([]);
  });
});

describe("snapping", () => {
  const target = { x: 100, y: 100, width: 100, height: 100 };

  it("snaps edges and centres within the threshold and reports guides", () => {
    const snap = snapRect({ x: 203, y: 148, width: 50, height: 4 }, [target], 5);
    expect(snap.dx).toBe(-3);
    expect(snap.dy).toBe(0);
    expect(snap.guides.map((g) => [g.axis, g.position])).toEqual([
      ["x", 200],
      ["y", 150],
    ]);
  });

  it("leaves distant rectangles alone", () => {
    expect(snapRect({ x: 400, y: 400, width: 10, height: 10 }, [target], 5)).toEqual({ dx: 0, dy: 0, guides: [] });
  });
});

describe("shape geometry", () => {
  it("inscribes polygons in the node box", () => {
    expect(polygonPoints({ sides: 4, width: 100, height: 100 })).toBe("50,0 100,50 50,100 0,50");
  });

  it("writes straight and curved path segments", () => {
    expect(vectorPath([{ x: 0, y: 0 }, { x: 10, y: 0 }], false)).toBe("M0 0 L10 0");
    expect(vectorPath([{ x: 0, y: 0, outX: 5, outY: 5 }, { x: 10, y: 0 }], true)).toBe("M0 0 C5 5 10 0 10 0 L0 0 Z");
  });
});
