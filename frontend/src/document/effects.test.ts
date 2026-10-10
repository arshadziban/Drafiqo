import { describe, expect, it } from "vitest";
import { insertNode, patchNodes } from "../editor/commands";
import { parseProject } from "../storage/projectFile";
import { activeLayerBlur, convertEffect, effectOutset, filterPad } from "./effects";
import { createDocument, createRectangle, dropShadow, innerShadow, layerBlur } from "./factory";
import { SCHEMA_VERSION, type DrafiqoDocument, type Effect } from "./types";
import { validateDocument } from "./validate";

const errorsOf = (value: unknown) => {
  const result = validateDocument(value);
  return result.ok ? [] : result.errors;
};

function documentWith(effects: Effect[]): DrafiqoDocument {
  const doc = createDocument("Effects");
  const rect = createRectangle({ x: 0, y: 0, width: 100, height: 60 });
  const page = patchNodes(insertNode(doc.pages[0]!, rect), [rect.id], { effects });
  return { ...doc, pages: [page] };
}

describe("effect geometry", () => {
  it("has no reach without effects", () => {
    expect(effectOutset([])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(filterPad([])).toBe(0);
  });

  it("reaches by blur plus spread, moved by the offset", () => {
    const shadow = { ...dropShadow(), blur: 10, spread: 4, offsetX: 6, offsetY: -2 };
    expect(effectOutset([shadow])).toEqual({ left: 8, right: 20, top: 16, bottom: 12 });
  });

  it("keeps a plain drop shadow identical to what earlier versions drew", () => {
    const shadow = { ...dropShadow(), blur: 10, offsetX: 0, offsetY: 6 };
    expect(effectOutset([shadow])).toEqual({ left: 10, right: 10, top: 4, bottom: 16 });
    expect(filterPad([shadow])).toBe(26); // blur * 2 + the largest offset
  });

  it("never lets an inner shadow or a hidden effect grow the layer", () => {
    expect(effectOutset([{ ...innerShadow(), blur: 30, offsetX: 20 }])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
    expect(effectOutset([{ ...dropShadow(), blur: 30, visible: false }])).toEqual({ left: 0, right: 0, top: 0, bottom: 0 });
  });

  it("spreads a layer blur in every direction and adds it to shadows cast from the blurred layer", () => {
    expect(effectOutset([{ ...layerBlur(), blur: 12 }])).toEqual({ left: 12, right: 12, top: 12, bottom: 12 });
    const both = effectOutset([{ ...layerBlur(), blur: 12 }, { ...dropShadow(), blur: 8, offsetX: 0, offsetY: 0 }]);
    expect(both).toEqual({ left: 20, right: 20, top: 20, bottom: 20 });
  });

  it("uses only the first visible layer blur", () => {
    const hidden = { ...layerBlur(), blur: 50, visible: false };
    const first = { ...layerBlur(), blur: 6 };
    const second = { ...layerBlur(), blur: 30 };
    expect(activeLayerBlur([hidden, first, second])).toBe(6);
    expect(activeLayerBlur([])).toBe(0);
  });
});

describe("changing an effect's type", () => {
  it("keeps shadow settings between drop and inner shadows", () => {
    const shadow = { ...dropShadow(), color: "#336699", blur: 14, spread: 3 };
    expect(convertEffect(shadow, "inner-shadow")).toEqual({ ...shadow, type: "inner-shadow" });
  });

  it("keeps blur, id and visibility when moving to and from layer blur", () => {
    const shadow = { ...dropShadow(), blur: 14, visible: false };
    const blur = convertEffect(shadow, "layer-blur");
    expect(blur).toEqual({ id: shadow.id, type: "layer-blur", blur: 14, visible: false });
    const back = convertEffect(blur, "drop-shadow");
    expect(back).toMatchObject({ id: shadow.id, type: "drop-shadow", blur: 14, visible: false, spread: 0 });
    expect(errorsOf(documentWith([back]))).toEqual([]);
  });

  it("returns the same effect when the type is unchanged", () => {
    const shadow = dropShadow();
    expect(convertEffect(shadow, "drop-shadow")).toBe(shadow);
  });
});

describe("effect validation", () => {
  it("accepts every effect type", () => {
    expect(errorsOf(documentWith([dropShadow(), innerShadow(), layerBlur()]))).toEqual([]);
  });

  it("rejects an unknown type, a negative blur and a shadow without spread", () => {
    expect(errorsOf(documentWith([{ ...layerBlur(), type: "glow" } as unknown as Effect])).join("\n")).toMatch(/type/);
    expect(errorsOf(documentWith([{ ...layerBlur(), blur: -1 }])).join("\n")).toMatch(/blur/);
    const { spread: _spread, ...noSpread } = dropShadow();
    expect(errorsOf(documentWith([noSpread as unknown as Effect])).join("\n")).toMatch(/spread/);
  });
});

describe("opening projects saved before shadows had a spread", () => {
  it("adds a spread of 0 to old drop shadows and leaves everything else alone", () => {
    const current = documentWith([dropShadow()]);
    const rect = Object.values(current.pages[0]!.nodes)[0]!;
    const { spread: _spread, ...legacyShadow } = rect.effects[0] as unknown as Record<string, unknown>;
    const v1 = {
      ...current,
      schemaVersion: 1,
      pages: [{ ...current.pages[0]!, nodes: { [rect.id]: { ...rect, effects: [legacyShadow] } } }],
    };
    const opened = parseProject(JSON.stringify(v1));
    expect(opened.schemaVersion).toBe(SCHEMA_VERSION);
    const effects = Object.values(opened.pages[0]!.nodes)[0]!.effects;
    expect(effects).toEqual([{ ...legacyShadow, spread: 0 }]);
  });

  it("opens an old project with no effects at all", () => {
    const v1 = { ...documentWith([]), schemaVersion: 1 };
    expect(parseProject(JSON.stringify(v1)).schemaVersion).toBe(SCHEMA_VERSION);
  });
});
