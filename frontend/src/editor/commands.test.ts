import { describe, expect, it } from "vitest";
import { createFrame, createLine, createPage, createRectangle, createText } from "../document/factory";
import { cornersOf, translation, worldBounds, worldMatrix, type Point } from "../document/geometry";
import { childrenOf } from "../document/tree";
import type { NodeId, Page } from "../document/types";
import { validateDocument } from "../document/validate";
import { createDocument } from "../document/factory";
import {
  alignNodes,
  distributeNodes,
  duplicateNodes,
  findContainerAt,
  groupNodes,
  insertNode,
  moveNodesInTree,
  patchNodes,
  placeNode,
  refitGroups,
  removeNodes,
  reorderNodes,
  resizeNode,
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
