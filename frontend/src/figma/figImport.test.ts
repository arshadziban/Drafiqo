import { deflateSync, zipSync } from "fflate";
import { compileSchema, encodeBinarySchema, parseSchema } from "kiwi-schema";
import { describe, expect, it } from "vitest";
import { createDocument } from "../document/factory";
import type { Page } from "../document/types";
import { validateDocument } from "../document/validate";
import { refitGroups } from "../editor/commands";
import { convertFigNodes, pathData, weightOf } from "./figConvert";
import { FigFileError, countLayers, figKey, readFigFile } from "./figFile";

// A cut-down version of Figma's own schema: the same names, only the fields these tests use.
const SCHEMA = parseSchema(`
  enum NodeType { NONE = 0; DOCUMENT = 1; CANVAS = 2; FRAME = 3; VECTOR = 4; TEXT = 5; RECTANGLE = 6; SYMBOL = 7; INSTANCE = 8; SLICE = 9; }
  enum PaintType { SOLID = 0; GRADIENT_LINEAR = 1; }
  enum StackMode { NONE = 0; HORIZONTAL = 1; VERTICAL = 2; }
  enum WindingRule { NONZERO = 0; ODD = 1; }
  struct GUID { uint sessionID; uint localID; }
  struct Color { float r; float g; float b; float a; }
  struct Vector { float x; float y; }
  struct Matrix { float m00; float m01; float m02; float m10; float m11; float m12; }
  struct ParentIndex { GUID guid; string position; }
  message ColorStop { Color color = 1; float position = 2; }
  message Paint { PaintType type = 1; Color color = 2; float opacity = 3; bool visible = 4; ColorStop[] stops = 5; }
  message Path { WindingRule windingRule = 1; uint commandsBlob = 2; }
  message FontName { string family = 1; string style = 2; }
  message TextData { string characters = 1; }
  message SymbolData { GUID symbolID = 1; }
  message Blob { byte[] bytes = 1; }
  message NodeChange {
    GUID guid = 1; ParentIndex parentIndex = 2; NodeType type = 3; string name = 4; bool visible = 5; float opacity = 6;
    Vector size = 7; Matrix transform = 8; Paint[] fillPaints = 9; Paint[] strokePaints = 10; float strokeWeight = 11;
    float cornerRadius = 12; Path[] fillGeometry = 13; StackMode stackMode = 14; float stackSpacing = 15;
    float stackHorizontalPadding = 16; float stackVerticalPadding = 17; float fontSize = 18; FontName fontName = 19;
    TextData textData = 20; SymbolData symbolData = 21; bool internalOnly = 22; Color backgroundColor = 23; bool resizeToFit = 24;
  }
  message Message { NodeChange[] nodeChanges = 1; Blob[] blobs = 2; }
`);

const guid = (localID: number) => ({ sessionID: 1, localID });
const at = (x: number, y: number) => ({ m00: 1, m01: 0, m02: x, m10: 0, m11: 1, m12: y });
const black = { type: "SOLID", color: { r: 0, g: 0, b: 0, a: 1 }, opacity: 1, visible: true };
const node = (id: number, parent: number | null, position: string, fields: Record<string, unknown>) => ({ guid: guid(id), ...(parent === null ? {} : { parentIndex: { guid: guid(parent), position } }), visible: true, opacity: 1, ...fields });

/** M 0 0, L 10 0, L 10 10, Z as Figma packs path commands. */
function square(): Uint8Array {
  const bytes = new Uint8Array(1 + 8 + 1 + 8 + 1 + 8 + 1);
  const view = new DataView(bytes.buffer);
  let offset = 0;
  for (const [command, ...numbers] of [[1, 0, 0], [2, 10, 0], [2, 10, 10], [0]] as number[][]) {
    bytes[offset++] = command!;
    for (const n of numbers) {
      view.setFloat32(offset, n, true);
      offset += 4;
    }
  }
  return bytes;
}

const NODES = [
  node(0, null, "", { type: "DOCUMENT", name: "Document" }),
  node(1, 0, "!", { type: "CANVAS", name: "Internal", internalOnly: true }),
  node(2, 0, "#", { type: "CANVAS", name: "Screens", backgroundColor: { r: 1, g: 1, b: 1, a: 1 } }),
  // Written out of order: `position` decides the order, not where a node sits in the file.
  node(11, 10, "b", { type: "TEXT", name: "Label", size: { x: 60, y: 20 }, transform: at(40, 14), fillPaints: [black], fontSize: 16, fontName: { family: "Inter", style: "Semi Bold" }, textData: { characters: "Hello" } }),
  node(10, 2, "a", { type: "FRAME", name: "Card", size: { x: 110, y: 48 }, transform: at(100, 50), cornerRadius: 8, fillPaints: [{ ...black, color: { r: 1, g: 0, b: 0, a: 0.5 } }], stackMode: "HORIZONTAL", stackSpacing: 6, stackHorizontalPadding: 10, stackVerticalPadding: 14 }),
  node(12, 10, "a", { type: "INSTANCE", name: "Icon", size: { x: 24, y: 24 }, transform: at(10, 14), symbolData: { symbolID: guid(20) } }),
  node(13, 10, "c", { type: "SLICE", name: "Export area", size: { x: 5, y: 5 }, transform: at(0, 0) }),
  node(20, 1, "a", { type: "SYMBOL", name: "icon/star", size: { x: 24, y: 24 }, transform: at(0, 0) }),
  node(21, 20, "a", { type: "VECTOR", name: "Shape", size: { x: 10, y: 10 }, transform: at(7, 7), fillPaints: [black], strokeWeight: 3, fillGeometry: [{ windingRule: "ODD", commandsBlob: 0 }] }),
];

function figFile(zipped: boolean): Uint8Array {
  const schema = deflateSync(encodeBinarySchema(SCHEMA));
  const message = deflateSync(compileSchema(SCHEMA).encodeMessage({ nodeChanges: NODES, blobs: [{ bytes: square() }] }));
  const canvas = new Uint8Array(12 + 4 + schema.length + 4 + message.length);
  const view = new DataView(canvas.buffer);
  canvas.set(new TextEncoder().encode("fig-kiwi"));
  view.setUint32(8, 106, true);
  view.setUint32(12, schema.length, true);
  canvas.set(schema, 16);
  view.setUint32(16 + schema.length, message.length, true);
  canvas.set(message, 20 + schema.length);
  return zipped ? zipSync({ "canvas.fig": canvas, "thumbnail.png": new Uint8Array([1, 2, 3]) }) : canvas;
}

describe("reading a .fig file", () => {
  it.each([true, false])("finds the pages and their layers (zipped: %s)", (zipped) => {
    const file = readFigFile(figFile(zipped));
    expect(file.pages.map((page) => page.name)).toEqual(["Screens"]);
    const [card] = file.children.get(figKey(file.pages[0]!.guid))!;
    expect(card).toMatchObject({ type: "FRAME", name: "Card", stackMode: "HORIZONTAL", cornerRadius: 8 });
    expect(file.children.get(figKey(card!.guid))!.map((child) => child.name)).toEqual(["Icon", "Label", "Export area"]);
    expect(countLayers(file, card!)).toBe(4);
    expect(pathData(file.blobs[0])).toBe("M0 0 L10 0 L10 10 Z");
  });

  it("refuses files that are not Figma designs", () => {
    expect(() => readFigFile(new TextEncoder().encode("just some text, not a design"))).toThrow(FigFileError);
    expect(() => readFigFile(zipSync({ "notes.txt": new Uint8Array([1]) }))).toThrow("no Figma design");
  });
});

describe("converting Figma layers", () => {
  const file = readFigFile(figFile(true));
  const result = convertFigNodes(file, file.children.get(figKey(file.pages[0]!.guid))!);
  const page: Page = { id: "pg", name: "Screens", background: "#ffffff", children: result.children, nodes: result.nodes };
  const named = (name: string) => Object.values(page.nodes).find((n) => n.name === name)!;

  it("carries frames, auto layout, text and paints across", () => {
    const card = named("Card");
    expect(card).toMatchObject({ type: "frame", x: 100, y: 50, width: 110, height: 48, cornerRadii: [8, 8, 8, 8], clipContent: true });
    expect(card.fills[0]).toMatchObject({ type: "solid", color: "#ff0000", opacity: 0.5 });
    expect(card.type === "frame" && card.layout).toMatchObject({ mode: "horizontal", gap: 6, paddingLeft: 10, paddingRight: 10, paddingTop: 14, paddingBottom: 14, widthSizing: "hug", heightSizing: "fixed" });
    expect(named("Label")).toMatchObject({ type: "text", text: "Hello", fontFamily: "Inter", fontSize: 16, fontWeight: 600, x: 40, y: 14 });
    expect([...result.fonts]).toEqual(["Inter"]);
    expect(weightOf("ExtraBold Italic")).toBe(800);
    expect(weightOf("Regular")).toBe(400);
  });

  it("draws vectors as outlines and fills instances from their component", () => {
    const icon = named("Icon");
    expect(icon).toMatchObject({ type: "frame", width: 24, height: 24 });
    const shape = named("Shape");
    expect(shape.parentId).toBe(icon.id);
    expect(shape).toMatchObject({ type: "vector", x: 7, y: 7, outline: { fill: "M0 0 L10 0 L10 10 Z", stroke: "", width: 10, height: 10, evenOdd: true } });
    // A weight without a stroke colour is not a stroke.
    expect(shape.strokeWidth).toBe(0);
    // Things that are not layers are left out without a fuss.
    expect(Object.values(page.nodes).map((n) => n.name).sort()).toEqual(["Card", "Icon", "Label", "Shape"]);
  });

  it("produces a valid page that auto layout leaves as Figma had it", () => {
    const checked = validateDocument({ ...createDocument(), pages: [page] });
    expect(checked.ok ? [] : checked.errors).toEqual([]);
    expect(refitGroups(page)).toBe(page);
  });
});
