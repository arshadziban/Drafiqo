import { beforeEach, describe, expect, it } from "vitest";
import { createDocument, createRectangle } from "../document/factory";
import { insertNode, patchNodes, removeNodes, translateNodes } from "../editor/commands";
import { currentPage, isDirty, useEditor } from "../editor/store";
import { emptyHistory, record, redo, undo } from "./history";

describe("history", () => {
  it("undoes and redoes in order", () => {
    let h = emptyHistory<number>();
    h = record(h, 1);
    h = record(h, 2);
    const back = undo(h, 3)!;
    expect(back.state).toBe(2);
    const backAgain = undo(back.history, back.state)!;
    expect(backAgain.state).toBe(1);
    expect(undo(backAgain.history, backAgain.state)).toBeNull();
    const forward = redo(backAgain.history, backAgain.state)!;
    expect(forward.state).toBe(2);
    expect(redo(forward.history, forward.state)!.state).toBe(3);
  });

  it("drops the redo branch when a new edit is recorded", () => {
    const back = undo(record(emptyHistory<number>(), 1), 2)!;
    expect(record(back.history, back.state).future).toEqual([]);
  });

  it("caps how much is remembered", () => {
    let h = emptyHistory<number>();
    for (let i = 0; i < 10; i++) h = record(h, i, 4);
    expect(h.past).toEqual([6, 7, 8, 9]);
  });
});

describe("editor history", () => {
  const editor = () => useEditor.getState();
  const nodeCount = () => Object.keys(currentPage(editor()).nodes).length;

  beforeEach(() => editor().loadDocument(createDocument(), null));

  it("undoes and redoes creation, edits and deletion", () => {
    const rect = createRectangle({ x: 0, y: 0, width: 10, height: 10 });
    editor().edit((p) => insertNode(p, rect), [rect.id]);
    editor().edit((p) => patchNodes(p, [rect.id], { opacity: 0.5 }));
    editor().edit((p) => removeNodes(p, [rect.id]), []);
    expect(nodeCount()).toBe(0);

    editor().undo();
    expect(currentPage(editor()).nodes[rect.id]!.opacity).toBe(0.5);
    expect(editor().selection).toEqual([rect.id]);
    editor().undo();
    expect(currentPage(editor()).nodes[rect.id]!.opacity).toBe(1);
    editor().undo();
    expect(nodeCount()).toBe(0);
    expect(editor().selection).toEqual([]);

    editor().redo();
    editor().redo();
    editor().redo();
    expect(nodeCount()).toBe(0);
    editor().undo();
    expect(nodeCount()).toBe(1);
  });

  it("collapses a whole drag into one history entry", () => {
    const rect = createRectangle({ x: 0, y: 0, width: 10, height: 10 });
    editor().edit((p) => insertNode(p, rect));
    const base = currentPage(editor());
    editor().begin();
    for (let i = 1; i <= 50; i++) editor().transient(() => translateNodes(base, [rect.id], i, i));
    editor().commit();
    expect(currentPage(editor()).nodes[rect.id]).toMatchObject({ x: 50, y: 50 });
    expect(editor().history.past).toHaveLength(2);
    editor().undo();
    expect(currentPage(editor()).nodes[rect.id]).toMatchObject({ x: 0, y: 0 });
  });

  it("records nothing for a transaction that changed nothing, and can cancel one", () => {
    const rect = createRectangle({ x: 0, y: 0, width: 10, height: 10 });
    editor().edit((p) => insertNode(p, rect));
    editor().begin();
    editor().commit();
    expect(editor().history.past).toHaveLength(1);

    editor().begin();
    editor().transient((p) => translateNodes(p, [rect.id], 30, 0));
    editor().cancel();
    expect(currentPage(editor()).nodes[rect.id]!.x).toBe(0);
    expect(editor().history.past).toHaveLength(1);
  });

  it("does not record edits that leave the document unchanged", () => {
    editor().edit((p) => p);
    editor().edit((p) => removeNodes(p, ["missing"]));
    expect(editor().history.past).toHaveLength(0);
    expect(isDirty(editor())).toBe(false);
  });

  it("undoes page-level changes and returns to the right page", () => {
    const first = editor().pageId;
    editor().editDoc((doc) => ({ ...doc, pages: [...doc.pages, { ...doc.pages[0]!, id: "second", name: "Second" }] }), { pageId: "second" });
    expect(editor().pageId).toBe("second");
    editor().undo();
    expect(editor().doc.pages).toHaveLength(1);
    expect(editor().pageId).toBe(first);
  });

  it("tracks unsaved changes, including undoing back to the saved state", () => {
    expect(isDirty(editor())).toBe(false);
    const rect = createRectangle({ x: 0, y: 0, width: 10, height: 10 });
    editor().edit((p) => insertNode(p, rect));
    expect(isDirty(editor())).toBe(true);
    editor().undo();
    expect(isDirty(editor())).toBe(false);
  });
});
