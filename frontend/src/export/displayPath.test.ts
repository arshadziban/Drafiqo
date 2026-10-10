import { describe, expect, it } from "vitest";
import { shortenPath } from "./displayPath";

describe("shortenPath", () => {
  it("leaves short paths alone", () => {
    expect(shortenPath("C:\\Users\\zibsh\\Downloads", 40)).toBe("C:\\Users\\zibsh\\Downloads");
    expect(shortenPath("", 10)).toBe("");
  });

  it("drops the middle of a long Windows path, keeping the user folder and the last folder when they fit", () => {
    const long = "C:\\Users\\zibsh\\Documents\\Projects\\Design\\Exports";
    expect(shortenPath(long, 30)).toBe("C:\\Users\\zibsh\\…\\Exports");
  });

  it("keeps less of the start when there is less room", () => {
    const long = "C:\\Users\\zibsh\\Documents\\Projects\\Design\\Exports";
    expect(shortenPath(long, 20)).toBe("C:\\Users\\…\\Exports");
  });

  it("does the same for POSIX paths", () => {
    expect(shortenPath("/Users/zibsh/Documents/Projects/Design/Exports", 28)).toBe("/Users/zibsh/…/Exports");
  });

  it("falls back to the last folder alone when even that is too long, then to the end of the path", () => {
    expect(shortenPath("C:\\Users\\zibsh\\Documents\\Projects\\Exports", 16)).toBe("…\\Exports");
    const result = shortenPath("C:\\a\\b\\c\\a-very-long-final-folder-name", 20);
    expect(result.length).toBeLessThanOrEqual(20);
    expect(result.startsWith("…")).toBe(true);
    expect(result.endsWith("folder-name")).toBe(true);
  });

  it("never returns more than the limit", () => {
    for (const path of ["C:\\x\\y\\z\\w\\v\\u\\t", "/a/b/c/d/e/f/g/h", "C:\\Users\\zibsh\\Downloads\\a-really-quite-long-name-here"]) {
      for (const max of [12, 20, 30]) expect(shortenPath(path, max).length).toBeLessThanOrEqual(max);
    }
  });
});
