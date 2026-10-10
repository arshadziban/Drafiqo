import { afterEach, describe, expect, it } from "vitest";
import { insertNode, patchNodes } from "../editor/commands";
import { listExportTargets, renderSvg } from "../export/exportRenderer";
import { parseProject, serializeProject } from "../storage/projectFile";
import { getAsset, nodesUsingAsset, pruneAssets, referencedAssetIds, setAssets } from "./assets";
import { createDocument, createRectangle, createText, imagePaint, solidPaint } from "./factory";
import { ProjectFormatError } from "./migrate";
import { SCHEMA_VERSION, type DrafiqoDocument, type ImageAsset } from "./types";
import { validateDocument } from "./validate";

// A real 1 × 1 PNG.
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNkYPhfDwAChwGA60e6kgAAAABJRU5ErkJggg==";

const asset = (id: string, overrides: Partial<ImageAsset> = {}): ImageAsset => ({ id, name: id, mime: "image/png", width: 40, height: 20, url: PNG, ...overrides });

/** A document with one rectangle per picture, each filled with it. */
function documentWith(assets: ImageAsset[], used: string[] = assets.map((a) => a.id)): DrafiqoDocument {
  const doc = createDocument("Pictures");
  let page = doc.pages[0]!;
  const ids: string[] = [];
  for (const id of used) {
    const rect = createRectangle({ x: ids.length * 100, y: 0, width: 80, height: 40 });
    page = patchNodes(insertNode(page, rect), [rect.id], { fills: [imagePaint(id)] });
    ids.push(rect.id);
  }
  return { ...doc, pages: [page], assets: Object.fromEntries(assets.map((a) => [a.id, a])) };
}

const errorsOf = (value: unknown) => {
  const result = validateDocument(value);
  return result.ok ? [] : result.errors;
};

afterEach(() => setAssets({}));

describe("image validation", () => {
  it("accepts a document with pictures and image fills", () => {
    expect(errorsOf(documentWith([asset("a"), asset("b", { mime: "image/jpeg", url: PNG.replace("image/png", "image/jpeg") })]))).toEqual([]);
  });

  it("rejects malformed pictures", () => {
    const base = documentWith([asset("a")]);
    expect(errorsOf({ ...base, assets: { a: asset("other") } }).join("\n")).toMatch(/id/);
    expect(errorsOf({ ...base, assets: { a: asset("a", { width: 0 }) } }).join("\n")).toMatch(/width/);
    expect(errorsOf({ ...base, assets: { a: asset("a", { mime: "application/pdf" }) } }).join("\n")).toMatch(/mime/);
    // The bytes must be a data: URL of the type the asset claims, never a link to somewhere else.
    expect(errorsOf({ ...base, assets: { a: asset("a", { url: "https://example.com/x.png" }) } }).join("\n")).toMatch(/url/);
    expect(errorsOf({ ...base, assets: { a: asset("a", { url: PNG.replace("image/png", "image/gif") }) } }).join("\n")).toMatch(/url/);
    expect(errorsOf({ ...base, assets: undefined }).join("\n")).toMatch(/assets/);
  });

  it("allows image fills only where a picture makes sense", () => {
    const doc = documentWith([asset("a")]);
    const node = Object.values(doc.pages[0]!.nodes)[0]!;
    const strokeWithImage = structuredClone(doc);
    Object.values(strokeWithImage.pages[0]!.nodes)[0]!.strokes = [imagePaint("a")] as never;
    expect(errorsOf(strokeWithImage).join("\n")).toMatch(/strokes/);

    const withText = structuredClone(doc);
    const text = createText({ x: 0, y: 0, width: 10, height: 10 }, "Hi");
    withText.pages[0]!.nodes[text.id] = { ...text, fills: [imagePaint("a")] as never };
    withText.pages[0]!.children.push(text.id);
    expect(errorsOf(withText).join("\n")).toMatch(/fills/);
    expect(node.fills[0]!.type).toBe("image");
  });

  it("rejects an image fill with an unknown scale mode", () => {
    const doc = structuredClone(documentWith([asset("a")]));
    const fill = Object.values(doc.pages[0]!.nodes)[0]!.fills[0] as { scaleMode: string };
    fill.scaleMode = "zoom";
    expect(errorsOf(doc).join("\n")).toMatch(/scaleMode/);
  });
});

describe("opening projects saved before pictures existed", () => {
  it("adds an empty picture store to a version 2 project", () => {
    const { assets: _assets, ...v2 } = { ...documentWith([]), schemaVersion: 2 };
    const opened = parseProject(JSON.stringify(v2));
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    expect(opened.assets).toEqual({});
  });

  it("refuses a project that claims to be current but has no picture store", () => {
    const { assets: _assets, ...broken } = documentWith([]);
    expect(() => parseProject(JSON.stringify(broken))).toThrow(ProjectFormatError);
  });
});

describe("saving pictures", () => {
  it("writes the pictures that are used and reads them back", () => {
    const doc = documentWith([asset("a"), asset("b")]);
    const back = parseProject(serializeProject(doc));
    expect(Object.keys(back.assets).sort()).toEqual(["a", "b"]);
    expect(back.assets.a!.url).toBe(PNG);
  });

  it("leaves out pictures nothing uses any more", () => {
    const doc = documentWith([asset("kept"), asset("unused")], ["kept"]);
    expect(Object.keys(parseProject(serializeProject(doc)).assets)).toEqual(["kept"]);
  });

  it("keeps a picture while any fill still uses it, even a hidden one", () => {
    const doc = documentWith([asset("a")], ["a", "a"]);
    const hidden = patchNodes(doc.pages[0]!, [doc.pages[0]!.children[0]!], { visible: false });
    expect(Object.keys(pruneAssets({ ...doc, pages: [hidden] }).assets)).toEqual(["a"]);
  });

  it("returns the very same document when nothing needs dropping", () => {
    const doc = documentWith([asset("a")]);
    expect(pruneAssets(doc)).toBe(doc);
  });

  it("knows which pictures and layers are in use", () => {
    const doc = documentWith([asset("a"), asset("b")], ["a", "a", "b"]);
    const page = doc.pages[0]!;
    expect([...referencedAssetIds(doc.pages)].sort()).toEqual(["a", "b"]);
    expect(nodesUsingAsset(page, "a")).toHaveLength(2);
    expect(nodesUsingAsset(page, "missing")).toEqual([]);
  });
});

describe("drawing pictures", () => {
  const svgOf = (doc: DrafiqoDocument) => {
    setAssets(doc.assets);
    const page = doc.pages[0]!;
    return renderSvg(page, listExportTargets(page, []).find((t) => t.kind === "page")!);
  };

  it("embeds the picture, clipped to the shape, in an exported SVG", () => {
    const svg = svgOf(documentWith([asset("a")]));
    expect(svg).toContain("<image");
    expect(svg).toContain(PNG);
    expect(svg).toContain("<clipPath");
    expect(svg).toContain('preserveAspectRatio="xMidYMid slice"');
  });

  it("maps each scale mode to how the picture sits in its box", () => {
    const modes = { fill: "xMidYMid slice", fit: "xMidYMid meet", stretch: "none" } as const;
    for (const [mode, aspect] of Object.entries(modes)) {
      const doc = documentWith([asset("a")]);
      const page = doc.pages[0]!;
      const id = page.children[0]!;
      const patched = patchNodes(page, [id], { fills: [{ ...imagePaint("a"), scaleMode: mode as "fill" }] });
      expect(svgOf({ ...doc, pages: [patched] })).toContain(`preserveAspectRatio="${aspect}"`);
    }
  });

  it("applies the fill's opacity and skips hidden fills", () => {
    const doc = documentWith([asset("a")]);
    const page = doc.pages[0]!;
    const id = page.children[0]!;
    const faded = patchNodes(page, [id], { fills: [{ ...imagePaint("a"), opacity: 0.4 }] });
    expect(svgOf({ ...doc, pages: [faded] })).toContain('opacity="0.4"');
    const hidden = patchNodes(page, [id], { fills: [{ ...imagePaint("a"), visible: false }] });
    expect(svgOf({ ...doc, pages: [hidden] })).not.toContain("<image");
  });

  it("shows a grey placeholder, not a broken page, when the picture is missing", () => {
    const doc = documentWith([asset("a")]);
    const svg = svgOf({ ...doc, assets: {} });
    expect(svg).not.toContain("<image");
    expect(svg).toContain("#3a3d44");
  });

  it("draws colour fills as before", () => {
    const doc = documentWith([asset("a")]);
    const page = doc.pages[0]!;
    const patched = patchNodes(page, [page.children[0]!], { fills: [solidPaint("#112233")] });
    const svg = svgOf({ ...doc, pages: [patched] });
    expect(svg).toContain("#112233");
    expect(svg).not.toContain("<image");
  });

  it("looks pictures up in the registry the editor keeps", () => {
    setAssets({ a: asset("a") });
    expect(getAsset("a")?.name).toBe("a");
    expect(getAsset("nope")).toBeUndefined();
  });
});
