import { describe, expect, it } from "vitest";
import { createPage, createText } from "../document/factory";
import { insertNode } from "../editor/commands";
import { GOOGLE_FAMILIES, googleCssUrl, googleFontUses, inlineFontFiles, isGoogleFont } from "./fontLibrary";

describe("font library", () => {
  it("knows the Google catalogue from everything else", () => {
    expect(GOOGLE_FAMILIES.length).toBeGreaterThan(1500);
    expect(isGoogleFont("Roboto")).toBe(true);
    expect(isGoogleFont("My Own Font")).toBe(false);
    // Names of things every object has are not fonts.
    expect(isGoogleFont("constructor")).toBe(false);
  });

  it("asks Google only for weights the family comes in", () => {
    // Lobster has a single weight; Open Sans starts at 300.
    expect(googleCssUrl("Lobster", [700])).toBe("https://fonts.googleapis.com/css2?family=Lobster:wght@400&display=swap");
    expect(googleCssUrl("Open Sans", [900, 300, 300])).toBe("https://fonts.googleapis.com/css2?family=Open+Sans:wght@300;800&display=swap");
    expect(googleCssUrl("Open Sans", [400], "Hi & bye")).toContain("&text=Hi%20%26%20bye");
  });

  it("collects the weights and characters a page sets in Google fonts", () => {
    let page = createPage("Test");
    page = insertNode(page, { ...createText({ x: 0, y: 0, width: 1, height: 1 }, "Hi there"), fontFamily: "Roboto", fontWeight: 700 });
    page = insertNode(page, { ...createText({ x: 0, y: 0, width: 1, height: 1 }, "Hey"), fontFamily: "Roboto" });
    page = insertNode(page, { ...createText({ x: 0, y: 0, width: 1, height: 1 }, "Local"), fontFamily: "My Own Font" });
    const uses = googleFontUses(page);
    expect([...uses.keys()]).toEqual(["Roboto"]);
    expect([...uses.get("Roboto")!.weights].sort()).toEqual([400, 700]);
    expect([...uses.get("Roboto")!.characters].sort().join("")).toBe("Hehirty");
  });

  it("puts the font files into the stylesheet", async () => {
    const css = `@font-face { font-family: 'Roboto'; src: url(https://fonts.gstatic.com/a.woff2) format('woff2'); }\n@font-face { src: url(https://fonts.gstatic.com/b.woff2); }`;
    const inlined = await inlineFontFiles(css, async (url) => `data:font/woff2;base64,${url.slice(-7, -6)}`);
    expect(inlined).toContain("url(data:font/woff2;base64,a) format('woff2')");
    expect(inlined).toContain("url(data:font/woff2;base64,b)");
    expect(inlined).not.toContain("gstatic");
  });
});
