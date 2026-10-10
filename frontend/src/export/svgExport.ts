import type { Page } from "../document/types";
import { renderSvg, sourceBounds } from "./exportRenderer";
import type { ExportRequest, ExportResult } from "./exportTypes";

/** SVG export: the artwork as vectors at its natural size. */
export function exportSvg(page: Page, request: ExportRequest): ExportResult {
  const bounds = sourceBounds(page, request.target);
  const svg = renderSvg(page, request.target, { background: request.transparent ? null : request.background });
  const usesText = request.target.nodeIds.some((id) => hasText(page, id));
  return {
    bytes: new TextEncoder().encode(svg),
    width: bounds.width,
    height: bounds.height,
    warnings: usesText ? ["Text stays editable in the SVG and refers to fonts by name, so it needs those fonts where the file is opened."] : [],
  };
}

function hasText(page: Page, id: string): boolean {
  const node = page.nodes[id];
  if (!node || !node.visible) return false;
  if (node.type === "text") return true;
  return "children" in node && node.children.some((c) => hasText(page, c));
}
