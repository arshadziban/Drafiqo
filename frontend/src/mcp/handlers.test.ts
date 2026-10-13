import { beforeEach, describe, expect, it } from "vitest";
import { createDocument } from "../document/factory";
import { validateDocument } from "../document/validate";
import { currentPage, useEditor } from "../editor/store";
import { handleRequest } from "./handlers";

type Described = { id: string; type: string; x: number; y: number; width: number; height: number; children?: Described[] } & Record<string, unknown>;

async function ask<T = Record<string, unknown>>(method: string, params: Record<string, unknown> = {}): Promise<T> {
  const reply = await handleRequest(method, params);
  if ("error" in reply) throw new Error(reply.error);
  return reply.result as T;
}

const card = {
  type: "frame",
  name: "Card",
  width: 300,
  fill: "#fff",
  cornerRadius: 12,
  layout: { mode: "vertical", padding: 20, gap: 10 },
  children: [
    { type: "text", text: "Title", fontSize: 20, fontWeight: 700, fill: "#111827" },
    { type: "rectangle", name: "Bar", height: 40, widthSizing: "fill", fill: "#2563eb" },
  ],
};

describe("assistant requests", () => {
  beforeEach(() => useEditor.getState().loadDocument(createDocument(), null));

  it("builds nested layers with auto layout in one undoable step", async () => {
    const { created } = await ask<{ created: Described[] }>("create_nodes", { nodes: [card] });
    const frame = created[0]!;
    const [title, bar] = frame.children!;
    expect(frame).toMatchObject({ type: "frame", name: "Card", width: 300, fill: "#ffffff", cornerRadius: 12, widthSizing: "fixed", heightSizing: "hug" });
    expect(title).toMatchObject({ type: "text", text: "Title", x: 20, y: 20, fontWeight: 700 });
    // The bar fills the width between the paddings and sits a gap below the title.
    expect(bar).toMatchObject({ x: 20, y: 20 + title!.height + 10, width: 260, height: 40, widthSizing: "fill" });
    expect(frame.height).toBe(bar!.y + 40 + 20);

    const s = useEditor.getState();
    expect(s.selection).toEqual([frame.id]);
    const checked = validateDocument(s.doc);
    expect(checked.ok ? [] : checked.errors).toEqual([]);
    s.undo();
    expect(Object.keys(currentPage(useEditor.getState()).nodes)).toEqual([]);
  });

  it("reads the page back, changes layers and deletes them", async () => {
    const { created } = await ask<{ created: Described[] }>("create_nodes", { nodes: [card] });
    const frame = created[0]!;
    const bar = frame.children![1]!;
    const tree = await ask<{ layers: Described[] }>("get_nodes");
    expect(tree.layers.map((layer) => layer.id)).toEqual([frame.id]);

    await ask("update_nodes", { updates: [{ id: bar.id, height: 60, fill: null, stroke: "#000", strokeWidth: 2 }, { id: frame.id, layout: { gap: 30 } }] });
    const after = await ask<Described>("get_nodes", { nodeId: frame.id });
    expect(after.children![1]).toMatchObject({ height: 60, stroke: "#000000", strokeWidth: 2 });
    expect(after.children![1]!.fill).toBeUndefined();
    expect((after.layout as { gap: number; paddingLeft: number }).gap).toBe(30);
    expect((after.layout as { gap: number; paddingLeft: number }).paddingLeft).toBe(20);
    expect(after.children![1]!.y).toBe(after.children![0]!.y + after.children![0]!.height + 30);

    expect(await ask("delete_nodes", { ids: [frame.id] })).toEqual({ deleted: 3 });
    expect((await ask<{ layers: Described[] }>("get_nodes")).layers).toEqual([]);
  });

  it("says what is wrong instead of half-applying a request", async () => {
    const bad = await handleRequest("create_nodes", { nodes: [{ ...card, children: [{ type: "text", text: "ok" }, { type: "rectangle", fill: "blue-ish" }] }] });
    expect(bad).toEqual({ error: expect.stringContaining('"fill" must be a hex colour') });
    expect(Object.keys(currentPage(useEditor.getState()).nodes)).toEqual([]);
    expect(await handleRequest("update_nodes", { updates: [{ id: "nope", x: 1 }] })).toEqual({ error: 'There is no layer with id "nope" on this page.' });
    expect(await handleRequest("create_nodes", { nodes: [{ type: "rectangle", children: [{ type: "text" }] }] })).toEqual({ error: expect.stringContaining("Only a frame can have children") });
    expect(await handleRequest("launch_rocket", {})).toEqual({ error: 'Unknown request "launch_rocket".' });
  });
});
