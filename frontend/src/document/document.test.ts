import { describe, expect, it } from "vitest";
import { insertNode } from "../editor/commands";
import { parseProject, serializeProject } from "../storage/projectFile";
import { createDocument, createFrame, createRectangle, createText } from "./factory";
import { ProjectFormatError } from "./migrate";
import { SCHEMA_VERSION, type DrafiqoDocument } from "./types";
import { validateDocument } from "./validate";

function sampleDocument(): DrafiqoDocument {
  const doc = createDocument("Sample");
  let page = doc.pages[0]!;
  const frame = createFrame({ x: 0, y: 0, width: 400, height: 300 });
  page = insertNode(page, frame);
  page = insertNode(page, createRectangle({ x: 20, y: 20, width: 100, height: 50 }), frame.id);
  page = insertNode(page, createText({ x: 20, y: 100, width: 10, height: 10 }, "Hello\nworld"), frame.id);
  return { ...doc, pages: [page] };
}

const errorsOf = (value: unknown) => {
  const result = validateDocument(value);
  return result.ok ? [] : result.errors;
};

describe("document creation", () => {
  it("creates a valid empty document with one page and the current schema version", () => {
    const doc = createDocument();
    expect(doc.schemaVersion).toBe(SCHEMA_VERSION);
    expect(doc.pages).toHaveLength(1);
    expect(validateDocument(doc).ok).toBe(true);
  });

  it("gives every object a distinct id", () => {
    const ids = new Set(Array.from({ length: 500 }, () => createRectangle({ x: 0, y: 0, width: 1, height: 1 }).id));
    expect(ids.size).toBe(500);
  });
});

describe("validation", () => {
  it("accepts a document with nested content", () => {
    expect(errorsOf(sampleDocument())).toEqual([]);
  });

  it("rejects non-documents", () => {
    expect(validateDocument(null).ok).toBe(false);
    expect(validateDocument([]).ok).toBe(false);
    expect(validateDocument({ format: "something-else" }).ok).toBe(false);
  });

  it("reports a child that does not exist", () => {
    const doc = structuredClone(sampleDocument());
    doc.pages[0]!.children.push("ghost");
    expect(errorsOf(doc).join("\n")).toContain("missing node");
  });

  it("reports a parent link that disagrees with the tree", () => {
    const doc = structuredClone(sampleDocument());
    const page = doc.pages[0]!;
    const child = Object.values(page.nodes).find((n) => n.type === "rectangle")!;
    child.parentId = null;
    expect(errorsOf(doc).join("\n")).toContain("does not match the layer tree");
  });

  it("reports nodes that are not attached to the tree", () => {
    const doc = structuredClone(sampleDocument());
    const orphan = createRectangle({ x: 0, y: 0, width: 1, height: 1 });
    doc.pages[0]!.nodes[orphan.id] = orphan;
    expect(errorsOf(doc).join("\n")).toContain("not attached");
  });

  it("reports unsupported node types instead of dropping them", () => {
    const doc = structuredClone(sampleDocument()) as unknown as { pages: { nodes: Record<string, { type: string }> }[] };
    Object.values(doc.pages[0]!.nodes)[0]!.type = "hologram";
    expect(errorsOf(doc).join("\n")).toContain("unsupported node type");
  });

  it("reports invalid property values", () => {
    const doc = structuredClone(sampleDocument());
    const rect = Object.values(doc.pages[0]!.nodes).find((n) => n.type === "rectangle")!;
    rect.width = -5;
    rect.fills[0]!.color = "red";
    const errors = errorsOf(doc).join("\n");
    expect(errors).toContain("width");
    expect(errors).toContain("colour");
  });
});

describe("project files", () => {
  it("round-trips a document through the .drafiqo format without losing structure", () => {
    const doc = sampleDocument();
    const reopened = parseProject(serializeProject(doc));
    expect(reopened.pages).toEqual(doc.pages);
    expect(reopened.id).toBe(doc.id);
    const text = Object.values(reopened.pages[0]!.nodes).find((n) => n.type === "text");
    expect(text && text.type === "text" && text.text).toBe("Hello\nworld");
  });

  it("stamps the save time", () => {
    const saved = JSON.parse(serializeProject(sampleDocument(), new Date("2030-01-02T03:04:05Z")));
    expect(saved.updatedAt).toBe("2030-01-02T03:04:05.000Z");
  });

  it("rejects files that are not JSON, not projects, or structurally invalid", () => {
    expect(() => parseProject("not json")).toThrow(ProjectFormatError);
    expect(() => parseProject("{}")).toThrow(ProjectFormatError);
    expect(() => parseProject(JSON.stringify({ ...sampleDocument(), pages: [] }))).toThrow(/at least one page/);
  });

  it("refuses projects from a newer schema rather than misreading them", () => {
    const future = JSON.stringify({ ...sampleDocument(), schemaVersion: SCHEMA_VERSION + 1 });
    expect(() => parseProject(future)).toThrow(/newer version/);
  });
});
