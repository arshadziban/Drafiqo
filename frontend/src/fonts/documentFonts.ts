import { currentPage, useEditor } from "../editor/store";
import { ensureFont, installedFamilies, readyFontCss } from "./fontLibrary";

const SETTLE_MS = 200;

/**
 * Keeps the fonts a document uses loaded: when a project is opened, pasted
 * into or undone to, its Google fonts are fetched without anyone asking.
 */
export function watchDocumentFonts(): void {
  let pages = useEditor.getState().doc.pages;
  let timer = 0;
  const load = () => {
    const s = useEditor.getState();
    const wanted = new Map<string, Set<number>>();
    for (const page of s.doc.pages) {
      for (const node of Object.values(page.nodes)) {
        if (node.type !== "text") continue;
        wanted.set(node.fontFamily, (wanted.get(node.fontFamily) ?? new Set()).add(node.fontWeight));
      }
    }
    for (const [family, weights] of wanted) void ensureFont(family, [...weights]);
    // Slides and export previews are pictures and need the fonts inside them.
    readyFontCss(currentPage(s));
  };
  useEditor.subscribe((s) => {
    if (s.doc.pages === pages) return;
    pages = s.doc.pages;
    window.clearTimeout(timer);
    timer = window.setTimeout(load, SETTLE_MS);
  });
  // Which fonts need fetching depends on which are installed.
  void installedFamilies().then(load);
}
