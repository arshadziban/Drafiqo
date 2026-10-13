import { describe, expect, it } from "vitest";
import { createFrame, createLine, createPage, createRectangle, createText } from "../document/factory";
import { cornersOf, translation, worldBounds, worldMatrix, type Point } from "../document/geometry";
import { childrenOf } from "../document/tree";
import type { NodeId, Page } from "../document/types";
import { validateDocument } from "../document/validate";
import { createDocument } from "../document/factory";
import {
  addAutoLayout,
  alignNodes,
  distributeNodes,
  duplicateNodes,
  findContainerAt,
  groupNodes,
  insertNode,
  layoutSlotAt,
  moveNodesInTree,
  patchNodes,
  placeNode,
  refitGroups,
  removeNodes,
  reorderNodes,
  resizeNode,
  scaleNode,
  setAutoLayout,
  setLayoutItem,
  translateNodes,
  ungroupNodes,
} from "./commands";

const rect = (x: number, y: number, width = 100, height = 50) => createRectangle({ x, y, width, height });

function worldCorners(page: Page, id: NodeId): Point[] {
  const node = page.nodes[id]!;
  return cornersOf(worldMatrix(page, id), node.width, node.height);
}

function expectSamePlace(a: Point[], b: Point[]) {
  a.forEach((p, i) => {
    expect(p.x).toBeCloseTo(b[i]!.x, 6);
    expect(p.y).toBeCloseTo(b[i]!.y, 6);
  });
}

/** Every command must leave the page structurally valid. */
function expectValid(page: Page) {
  const result = validateDocument({ ...createDocument(), pages: [page] });
  expect(result.ok ? [] : result.errors).toEqual([]);
}

function setup() {
  let page = createPage("Test");
  const a = rect(0, 0);
  const b = rect(200, 100);
  const c = rect(400, 300);
  for (const node of [a, b, c]) page = insertNode(page, node);
  return { page, a: a.id, b: b.id, c: c.id };
}

describe("transformations", () => {
  it("translates nodes in page space", () => {
    const { page, a } = setup();
    const moved = translateNodes(page, [a], 15, -5);
    expect(moved.nodes[a]).toMatchObject({ x: 15, y: -5 });
    expect(page.nodes[a]).toMatchObject({ x: 0, y: 0 });
  });

  it("keeps the opposite corner fixed when resizing a rotated node", () => {
    let page = createPage("Test");
    const node = { ...rect(50, 50, 100, 60), rotation: 30 };
    page = insertNode(page, node);
    const before = worldCorners(page, node.id);
    // Drag the bottom-right handle: the top-left corner is the anchor.
    const resized = resizeNode(page, node.id, 180, 20, 0, 0);
    const after = worldCorners(resized, node.id);
    expect(after[0]!.x).toBeCloseTo(before[0]!.x, 6);
    expect(after[0]!.y).toBeCloseTo(before[0]!.y, 6);
    expect(resized.nodes[node.id]).toMatchObject({ width: 180, height: 20, rotation: 30 });
  });

  it("anchors on the far edge when resizing from the top-left handle", () => {
    const { page, b } = setup();
    const resized = resizeNode(page, b, 40, 20, 1, 1);
    expect(resized.nodes[b]).toMatchObject({ x: 260, y: 130, width: 40, height: 20 });
  });

  it("never lets a size collapse below one pixel, and keeps lines flat", () => {
    let page = createPage("Test");
    const line = createLine({ x: 0, y: 0 }, { x: 100, y: 0 });
    const box = rect(0, 0);
    page = insertNode(insertNode(page, line), box);
    page = resizeNode(page, box.id, -20, 0);
    page = resizeNode(page, line.id, 50, 40);
    expect(page.nodes[box.id]).toMatchObject({ width: 1, height: 1 });
    expect(page.nodes[line.id]).toMatchObject({ width: 50, height: 0 });
  });

  it("scales a layer with its stroke, corners and effects, keeping the anchor fixed", () => {
    let page = createPage("Test");
    const node = {
      ...rect(100, 100, 100, 50),
      rotation: 30,
      strokeWidth: 2,
      cornerRadii: [4, 4, 8, 8] as [number, number, number, number],
      effects: [{ id: "e", type: "drop-shadow" as const, color: "#000000", opacity: 0.5, offsetX: 1, offsetY: 2, blur: 4, spread: 1, visible: true }],
    };
    page = insertNode(page, node);
    const before = worldCorners(page, node.id);
    // Drag the top-left handle: the bottom-right corner is the anchor.
    const scaled = scaleNode(page, node.id, 2, 1, 1);
    expect(scaled.nodes[node.id]).toMatchObject({ width: 200, height: 100, rotation: 30, strokeWidth: 4, cornerRadii: [8, 8, 16, 16] });
    expect(scaled.nodes[node.id]!.effects[0]).toMatchObject({ offsetX: 2, offsetY: 4, blur: 8, spread: 2 });
    const after = worldCorners(scaled, node.id);
    expect(after[2]!.x).toBeCloseTo(before[2]!.x, 1);
    expect(after[2]!.y).toBeCloseTo(before[2]!.y, 1);
    expect(scaleNode(page, node.id, 1)).toBe(page);
    expect(scaleNode(page, node.id, 0)).toBe(page);
    expectValid(scaled);
  });

  it("scales everything inside a frame, type included", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 0, y: 0, width: 400, height: 300 });
    const child = { ...rect(40, 20), strokeWidth: 3 };
    const text = { ...createText({ x: 10, y: 200, width: 1, height: 1 }, "Hi"), fontSize: 20, letterSpacing: 1 };
    page = insertNode(page, frame);
    page = insertNode(insertNode(page, child, frame.id), text, frame.id);
    const scaled = scaleNode(page, frame.id, 0.5);
    expect(scaled.nodes[frame.id]).toMatchObject({ x: 0, y: 0, width: 200, height: 150 });
    expect(scaled.nodes[child.id]).toMatchObject({ x: 20, y: 10, width: 50, height: 25, strokeWidth: 1.5 });
    expect(scaled.nodes[text.id]).toMatchObject({ x: 5, y: 100, fontSize: 10, letterSpacing: 0.5 });
    expect(scaled.nodes[text.id]!.width).toBeLessThan(page.nodes[text.id]!.width);
    expectValid(scaled);
  });

  it("builds a line from its two end points", () => {
    let page = createPage("Test");
    const line = createLine({ x: 10, y: 10 }, { x: 10, y: 110 });
    page = insertNode(page, line);
    const [start, end] = worldCorners(page, line.id);
    expectSamePlace([start!, end!], [{ x: 10, y: 10 }, { x: 10, y: 110 }]);
  });

  it("re-fits auto-sized text when its content or font changes", () => {
    let page = createPage("Test");
    const text = createText({ x: 0, y: 0, width: 1, height: 1 }, "Hi");
    page = insertNode(page, text);
    const short = page.nodes[text.id]!;
    page = patchNodes(page, [text.id], { text: "Hi there\nsecond line" });
    const long = page.nodes[text.id]!;
    expect(long.width).toBeGreaterThan(short.width);
    // One line is 16px × 1.4 = 22.4, rounded up to whole pixels.
    expect([short.height, long.height]).toEqual([23, 45]);
    page = patchNodes(page, [text.id], { fontSize: 32 });
    expect(page.nodes[text.id]!.height).toBeGreaterThan(long.height);
  });

  it("ignores properties a node type does not have", () => {
    const { page, a } = setup();
    expect(patchNodes(page, [a], { fontSize: 40 })).toBe(page);
  });
});

describe("layer hierarchy", () => {
  it("keeps a node where it is on the canvas when it moves into a rotated frame", () => {
    let page = createPage("Test");
    const frame = { ...createFrame({ x: 300, y: 200, width: 400, height: 300 }), rotation: 25 };
    const node = { ...rect(350, 260, 80, 40), rotation: -10 };
    page = insertNode(insertNode(page, frame), node);
    const before = worldCorners(page, node.id);
    page = placeNode(page, node.id, worldMatrix(page, node.id), frame.id);
    expect(page.nodes[node.id]!.parentId).toBe(frame.id);
    expect(page.children).toEqual([frame.id]);
    expectSamePlace(worldCorners(page, node.id), before);
    expect(page.nodes[node.id]!.rotation).toBeCloseTo(-35, 6);
    expectValid(page);
  });

  it("refuses to place a node inside itself or its own descendants", () => {
    let page = createPage("Test");
    const outer = createFrame({ x: 0, y: 0, width: 200, height: 200 });
    const inner = createFrame({ x: 10, y: 10, width: 50, height: 50 });
    page = insertNode(insertNode(page, outer), inner, outer.id);
    expect(placeNode(page, outer.id, translation(0, 0), inner.id)).toBe(page);
    expect(moveNodesInTree(page, [outer.id], inner.id, null)).toBe(page);
  });

  it("groups nodes into a tight box without moving them", () => {
    const { page, a, b, c } = setup();
    const before = [a, b].map((id) => worldCorners(page, id));
    const { page: grouped, groupId } = groupNodes(page, [a, b]);
    const group = grouped.nodes[groupId!]!;
    expect(group).toMatchObject({ type: "group", x: 0, y: 0, width: 300, height: 150 });
    expect(childrenOf(grouped, groupId!)).toEqual([a, b]);
    // The group takes the place of its front-most member in the stack.
    expect(grouped.children).toEqual([groupId, c]);
    [a, b].forEach((id, i) => expectSamePlace(worldCorners(grouped, id), before[i]!));
    expectValid(grouped);
  });

  it("ungroups a rotated group back to the same canvas positions", () => {
    const { page, a, b, c } = setup();
    let { page: grouped, groupId } = groupNodes(page, [a, b]);
    grouped = patchNodes(grouped, [groupId!], { rotation: 40 });
    const before = [a, b].map((id) => worldCorners(grouped, id));
    const { page: flat, ids } = ungroupNodes(grouped, [groupId!]);
    expect(ids).toEqual([a, b]);
    expect(flat.nodes[groupId!]).toBeUndefined();
    expect(flat.children).toEqual([a, b, c]);
    [a, b].forEach((id, i) => expectSamePlace(worldCorners(flat, id), before[i]!));
    expectValid(flat);
  });

  it("re-fits a group when a child moves, and removes it when it empties", () => {
    const { page, a, b } = setup();
    const { page: grouped, groupId } = groupNodes(page, [a, b]);
    const moved = translateNodes(grouped, [b], 100, 0);
    expect(worldBounds(moved, groupId!)).toEqual({ x: 0, y: 0, width: 400, height: 150 });
    expect(worldBounds(moved, a)).toEqual({ x: 0, y: 0, width: 100, height: 50 });
    const emptied = removeNodes(grouped, [a, b]);
    expect(emptied.nodes[groupId!]).toBeUndefined();
    expectValid(emptied);
  });

  it("scales a group's children when the group is resized", () => {
    const { page, a, b } = setup();
    const { page: grouped, groupId } = groupNodes(page, [a, b]);
    const scaled = resizeNode(grouped, groupId!, 600, 300);
    expect(worldBounds(scaled, a)).toEqual({ x: 0, y: 0, width: 200, height: 100 });
    expect(worldBounds(scaled, b)).toEqual({ x: 400, y: 200, width: 200, height: 100 });
  });

  it("leaves a frame's children alone when the frame is resized", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 0, y: 0, width: 200, height: 200 });
    const child = rect(20, 20);
    page = insertNode(insertNode(page, frame), child, frame.id);
    page = resizeNode(page, frame.id, 500, 400);
    expect(page.nodes[child.id]).toMatchObject({ x: 20, y: 20, width: 100, height: 50 });
  });

  it("removes a container together with everything inside it", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 0, y: 0, width: 200, height: 200 });
    const child = rect(20, 20);
    page = insertNode(insertNode(page, frame), child, frame.id);
    page = removeNodes(page, [frame.id]);
    expect(page.children).toEqual([]);
    expect(Object.keys(page.nodes)).toEqual([]);
  });

  it("reorders layers one step at a time and to either end", () => {
    const { page, a, b, c } = setup();
    expect(reorderNodes(page, [a], "forward").children).toEqual([b, a, c]);
    expect(reorderNodes(page, [c], "backward").children).toEqual([a, c, b]);
    expect(reorderNodes(page, [a], "front").children).toEqual([b, c, a]);
    expect(reorderNodes(page, [c], "back").children).toEqual([c, a, b]);
    expect(reorderNodes(page, [a, b], "forward").children).toEqual([c, a, b]);
    expect(reorderNodes(page, [c], "forward")).toBe(page);
  });

  it("moves layers to a chosen spot in the tree, keeping their canvas position", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 100, y: 100, width: 300, height: 300 });
    const inside = rect(10, 10);
    const outside = rect(150, 150);
    page = insertNode(insertNode(insertNode(page, frame), inside, frame.id), outside);
    const before = worldCorners(page, outside.id);
    page = moveNodesInTree(page, [outside.id], frame.id, inside.id);
    expect(childrenOf(page, frame.id)).toEqual([outside.id, inside.id]);
    expect(page.nodes[outside.id]).toMatchObject({ x: 50, y: 50 });
    expectSamePlace(worldCorners(page, outside.id), before);
    page = moveNodesInTree(page, [inside.id], null, null);
    expect(page.children).toEqual([frame.id, inside.id]);
    expect(page.nodes[inside.id]).toMatchObject({ x: 110, y: 110, parentId: null });
    expectValid(page);
  });

  it("duplicates whole subtrees with fresh ids, directly above the original", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 0, y: 0, width: 200, height: 200 });
    const child = rect(20, 20);
    page = insertNode(insertNode(page, frame), child, frame.id);
    const { page: copied, ids } = duplicateNodes(page, [frame.id]);
    const copy = copied.nodes[ids[0]!]!;
    expect(copied.children).toEqual([frame.id, copy.id]);
    expect(copy.id).not.toBe(frame.id);
    const copiedChildren = childrenOf(copied, copy.id);
    expect(copiedChildren).toHaveLength(1);
    expect(copiedChildren[0]).not.toBe(child.id);
    expect(copied.nodes[copiedChildren[0]!]).toMatchObject({ x: 20, y: 20, parentId: copy.id });
    expectValid(copied);
  });

  it("finds the deepest frame under a point", () => {
    let page = createPage("Test");
    const outer = createFrame({ x: 0, y: 0, width: 400, height: 400 });
    const inner = createFrame({ x: 100, y: 100, width: 100, height: 100 });
    page = insertNode(insertNode(page, outer), inner, outer.id);
    expect(findContainerAt(page, { x: 150, y: 150 })).toBe(inner.id);
    expect(findContainerAt(page, { x: 20, y: 20 })).toBe(outer.id);
    expect(findContainerAt(page, { x: 900, y: 900 })).toBeNull();
    expect(findContainerAt(page, { x: 150, y: 150 }, new Set([inner.id]))).toBe(outer.id);
  });

  it("returns the same page when there is nothing to re-fit", () => {
    const { page } = setup();
    expect(refitGroups(page)).toBe(page);
  });
});

describe("alignment", () => {
  it("aligns a multi-selection to its own bounds", () => {
    const { page, a, b, c } = setup();
    const left = alignNodes(page, [a, b, c], "left");
    expect([a, b, c].map((id) => left.nodes[id]!.x)).toEqual([0, 0, 0]);
    const bottom = alignNodes(page, [a, b, c], "bottom");
    expect([a, b, c].map((id) => bottom.nodes[id]!.y)).toEqual([300, 300, 300]);
    const centre = alignNodes(page, [a, c], "center");
    expect([a, c].map((id) => centre.nodes[id]!.x)).toEqual([200, 200]);
  });

  it("aligns a single node to its parent frame", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 50, y: 50, width: 400, height: 300 });
    const child = rect(10, 10);
    page = insertNode(insertNode(page, frame), child, frame.id);
    page = alignNodes(page, [child.id], "right");
    page = alignNodes(page, [child.id], "middle");
    expect(page.nodes[child.id]).toMatchObject({ x: 300, y: 125 });
  });

  it("distributes three or more nodes with equal gaps", () => {
    let page = createPage("Test");
    const nodes = [rect(0, 0, 50, 50), rect(60, 0, 50, 50), rect(350, 0, 50, 50)];
    for (const n of nodes) page = insertNode(page, n);
    const spread = distributeNodes(page, nodes.map((n) => n.id), "horizontal");
    expect(nodes.map((n) => spread.nodes[n.id]!.x)).toEqual([0, 175, 350]);
    expect(distributeNodes(page, [nodes[0]!.id, nodes[1]!.id], "horizontal")).toBe(page);
  });
});

describe("auto layout", () => {
  const xs = (page: Page, ids: NodeId[]) => ids.map((id) => page.nodes[id]!.x);
  const ys = (page: Page, ids: NodeId[]) => ids.map((id) => page.nodes[id]!.y);

  function wrapped() {
    const { page, a, b, c } = setup();
    const result = addAutoLayout(page, [a, b, c]);
    return { page: result.page, frame: result.frameId!, a, b, c };
  }

  it("wraps the selection in a frame that hugs it, reading the direction and gap from the layers", () => {
    const { page, frame, a, b, c } = wrapped();
    const node = page.nodes[frame]!;
    expect(node).toMatchObject({ type: "frame", x: 0, y: 0, width: 500, height: 50, children: [a, b, c] });
    expect(node.type === "frame" && node.layout).toMatchObject({ mode: "horizontal", gap: 100, widthSizing: "hug", heightSizing: "hug" });
    expect(xs(page, [a, b, c])).toEqual([0, 200, 400]);
    expect(ys(page, [a, b, c])).toEqual([0, 0, 0]);
    expectValid(page);
    // Settled: laying it out again changes nothing.
    expect(refitGroups(page)).toBe(page);
  });

  it("re-flows when the gap, padding or direction change", () => {
    const { page, frame, a, b, c } = wrapped();
    const padded = setAutoLayout(page, [frame], { gap: 10, paddingLeft: 20, paddingRight: 20, paddingTop: 5, paddingBottom: 5 });
    expect(padded.nodes[frame]).toMatchObject({ width: 360, height: 60 });
    expect(xs(padded, [a, b, c])).toEqual([20, 130, 240]);
    expect(ys(padded, [a, b, c])).toEqual([5, 5, 5]);
    const column = setAutoLayout(padded, [frame], { mode: "vertical" });
    expect(column.nodes[frame]).toMatchObject({ width: 140, height: 180 });
    expect(ys(column, [a, b, c])).toEqual([5, 65, 125]);
    expect(setAutoLayout(column, [frame], { mode: "vertical" })).toBe(column);
  });

  it("follows its children: resized, hidden and removed layers move the rest", () => {
    const { page, frame, a, b, c } = wrapped();
    const tight = setAutoLayout(page, [frame], { gap: 10 });
    const wider = resizeNode(tight, a, 150, 80);
    expect(xs(wider, [a, b, c])).toEqual([0, 160, 270]);
    expect(wider.nodes[frame]).toMatchObject({ width: 370, height: 80 });
    // Shorter layers are centred across the row.
    expect(ys(wider, [a, b, c])).toEqual([0, 15, 15]);
    const hidden = patchNodes(tight, [b], { visible: false });
    expect(hidden.nodes[c]!.x).toBe(110);
    const removed = removeNodes(tight, [a]);
    expect(xs(removed, [b, c])).toEqual([0, 110]);
    expect(removed.nodes[frame]!.width).toBe(210);
  });

  it("stops hugging a side that is resized, and aligns or spaces the children in the room", () => {
    const { page, frame, a, b, c } = wrapped();
    const tight = setAutoLayout(page, [frame], { gap: 10 });
    const fixed = resizeNode(tight, frame, 400, 50);
    const node = fixed.nodes[frame]!;
    expect(node.type === "frame" && node.layout).toMatchObject({ widthSizing: "fixed", heightSizing: "hug" });
    expect(node.width).toBe(400);
    expect(xs(setAutoLayout(fixed, [frame], { primaryAlign: "end" }), [a, b, c])).toEqual([80, 190, 300]);
    expect(xs(setAutoLayout(fixed, [frame], { primaryAlign: "center" }), [a, b, c])).toEqual([40, 150, 260]);
    expect(xs(setAutoLayout(fixed, [frame], { primaryAlign: "space-between" }), [a, b, c])).toEqual([0, 150, 300]);
    expect(setAutoLayout(fixed, [frame], { widthSizing: "hug" }).nodes[frame]!.width).toBe(320);
  });

  it("gives a plain frame the layout in place, keeping its size", () => {
    let page = createPage("Test");
    const frame = createFrame({ x: 50, y: 50, width: 400, height: 300 });
    const top = rect(20, 30);
    const bottom = rect(20, 100);
    page = insertNode(page, frame);
    // Layer order is the reverse of the visible order.
    page = insertNode(insertNode(page, bottom, frame.id), top, frame.id);
    const result = addAutoLayout(page, [frame.id]);
    const node = result.page.nodes[frame.id]!;
    expect(node).toMatchObject({ x: 50, y: 50, width: 400, height: 300, children: [top.id, bottom.id] });
    expect(node.type === "frame" && node.layout).toMatchObject({ mode: "vertical", gap: 20, paddingLeft: 20, paddingTop: 30, paddingRight: 280, paddingBottom: 150, widthSizing: "fixed" });
    expect(ys(result.page, [top.id, bottom.id])).toEqual([30, 100]);
    expectValid(result.page);
  });

  it("finds the slot a dragged layer lands in, and frees the children when removed", () => {
    const { page, frame, a, b, c } = wrapped();
    const dragged = new Set([c]);
    expect(layoutSlotAt(page, frame, { x: 10, y: 20 }, dragged)).toBe(a);
    expect(layoutSlotAt(page, frame, { x: 120, y: 20 }, dragged)).toBe(b);
    expect(layoutSlotAt(page, frame, { x: 480, y: 20 }, dragged)).toBe(null);
    expect(layoutSlotAt(page, null, { x: 0, y: 0 }, dragged)).toBe(undefined);
    const reordered = placeNode(page, c, worldMatrix(page, c), frame, 0);
    expect(reordered.nodes[frame]).toMatchObject({ children: [c, a, b] });
    expect(xs(reordered, [c, a, b])).toEqual([0, 200, 400]);

    const plain = setAutoLayout(page, [frame], null);
    expect("layout" in plain.nodes[frame]!).toBe(false);
    expect(translateNodes(plain, [a], 7, 0).nodes[a]!.x).toBe(7);
    expectValid(plain);
  });

  it("pads each side on its own", () => {
    const { page, frame, a, b, c } = wrapped();
    const padded = setAutoLayout(page, [frame], { gap: 10, paddingLeft: 5, paddingRight: 30, paddingTop: 8, paddingBottom: 2 });
    expect(padded.nodes[frame]).toMatchObject({ width: 355, height: 60 });
    expect(xs(padded, [a, b, c])).toEqual([5, 115, 225]);
    expect(ys(padded, [a, b, c])).toEqual([8, 8, 8]);
  });

  it("stretches children that fill, sharing the spare room and keeping to their limits", () => {
    const { page, frame, a, b, c } = wrapped();
    // Filling along the row makes a hugging frame keep its width instead.
    let filled = setLayoutItem(setAutoLayout(page, [frame], { gap: 10 }), [b], { fillWidth: true });
    const node = filled.nodes[frame]!;
    expect(node.type === "frame" && node.layout?.widthSizing).toBe("fixed");
    filled = resizeNode(filled, frame, 520, 50);
    expect(filled.nodes[b]).toMatchObject({ x: 110, width: 300 });
    expect(filled.nodes[c]!.x).toBe(420);
    const both = setLayoutItem(filled, [c], { fillWidth: true });
    expect([both.nodes[b]!.width, both.nodes[c]!.width]).toEqual([200, 200]);
    const capped = setLayoutItem(both, [b], { maxWidth: 120 });
    expect(capped.nodes[b]!.width).toBe(120);

    // Across the row, a filling child is as tall as the frame, and the tallest other child sets a hugging height.
    const tall = setLayoutItem(resizeNode(filled, a, 100, 90), [c], { fillHeight: true });
    expect(tall.nodes[frame]!.height).toBe(90);
    expect(tall.nodes[c]).toMatchObject({ y: 0, height: 90 });
    // Sizing a filling child by hand hands it back.
    expect(resizeNode(filled, b, 60, 50).nodes[b]!.layoutItem?.fillWidth).toBeUndefined();
    expect(setLayoutItem(filled, [b], { fillWidth: true })).toBe(filled);
    expectValid(capped);
    expect(refitGroups(capped)).toBe(capped);
  });

  it("lets a nested auto layout frame fill its parent instead of hugging", () => {
    const { page, frame, a } = wrapped();
    const inner = addAutoLayout(page, [a]);
    const innerId = inner.frameId!;
    let next = resizeNode(setAutoLayout(inner.page, [frame], { gap: 10 }), frame, 600, 50);
    next = setLayoutItem(next, [innerId], { fillWidth: true });
    expect(next.nodes[innerId]).toMatchObject({ x: 0, width: 380 });
    expect(next.nodes[a]!.width).toBe(100);
    expect(refitGroups(next)).toBe(next);
  });

  it("wraps children that do not fit onto further rows", () => {
    const { page, frame, a, b, c } = wrapped();
    let wrapping = setAutoLayout(page, [frame], { gap: 10, wrap: true, counterAlign: "start" });
    // A frame that hugs its width has nothing to wrap at.
    expect(xs(wrapping, [a, b, c])).toEqual([0, 110, 220]);
    wrapping = resizeNode(wrapping, frame, 250, 50);
    wrapping = setAutoLayout(wrapping, [frame], { heightSizing: "hug" });
    expect(xs(wrapping, [a, b, c])).toEqual([0, 110, 0]);
    expect(ys(wrapping, [a, b, c])).toEqual([0, 0, 60]);
    expect(wrapping.nodes[frame]).toMatchObject({ width: 250, height: 110 });
    // A point in the second row lands in front of the layer there, not the first row.
    expect(layoutSlotAt(wrapping, frame, { x: 20, y: 80 }, new Set())).toBe(c);
    expect(layoutSlotAt(wrapping, frame, { x: 240, y: 20 }, new Set())).toBe(c);
    expect(layoutSlotAt(wrapping, frame, { x: 240, y: 100 }, new Set())).toBe(null);
  });

  it("leaves absolute children where they are and out of the flow", () => {
    const { page, frame, a, b, c } = wrapped();
    const tight = setAutoLayout(page, [frame], { gap: 10 });
    const pinned = setLayoutItem(tight, [b], { absolute: true });
    expect(xs(pinned, [a, c])).toEqual([0, 110]);
    expect(pinned.nodes[frame]!.width).toBe(210);
    const moved = translateNodes(pinned, [b], 33, 12);
    expect(moved.nodes[b]).toMatchObject({ x: 143, y: 12 });
    expect(layoutSlotAt(pinned, frame, { x: 120, y: 20 }, new Set([a]))).toBe(c);
    const back = setLayoutItem(moved, [b], { absolute: false });
    expect("layoutItem" in back.nodes[b]!).toBe(false);
    expect(xs(back, [a, b, c])).toEqual([0, 110, 220]);
  });

  it("keeps a hugging frame within its minimum and maximum", () => {
    const { page, frame, a, b, c } = wrapped();
    const tight = setAutoLayout(page, [frame], { gap: 10 });
    const roomy = setLayoutItem(tight, [frame], { minWidth: 400, minHeight: 80 });
    expect(roomy.nodes[frame]).toMatchObject({ width: 400, height: 80 });
    expect(ys(roomy, [a, b, c])).toEqual([15, 15, 15]);
    expect(setLayoutItem(roomy, [frame], { minWidth: undefined, maxWidth: 300 }).nodes[frame]!.width).toBe(300);
    expect(setLayoutItem(roomy, [frame], { minWidth: undefined, minHeight: undefined }).nodes[frame]).toMatchObject({ width: 320, height: 50 });
  });

  it("scales the gap and padding with the frame", () => {
    const { page, frame, a, b, c } = wrapped();
    const padded = setAutoLayout(page, [frame], { gap: 10, paddingLeft: 20, paddingRight: 20 });
    const scaled = scaleNode(padded, frame, 2);
    const node = scaled.nodes[frame]!;
    expect(node.type === "frame" && node.layout).toMatchObject({ gap: 20, paddingLeft: 40, paddingRight: 40 });
    expect(node.width).toBe(720);
    expect(xs(scaled, [a, b, c])).toEqual([40, 260, 480]);
  });
});
