// What an AI assistant can ask the editor to do, through the MCP server in
// /mcp. Every handler works on the open document exactly as the user's own
// tools do: one call is one undo step, and nothing is saved to disk.

import { createEllipse, createFrame, createLine, createPolygon, createRectangle, createStar, createText, dropShadow, layerBlur, solidPaint } from "../document/factory";
import { childrenOf, subtreeIds } from "../document/tree";
import { isContainer, type AutoLayout, type CornerRadii, type Effect, type LayoutItem, type NodeId, type Page, type SceneNode } from "../document/types";
import { zoomToFit } from "../editor/actions";
import { addPage, insertNode, moveNodesInTree, patchNodes, refitGroups, removeNodes, resizeNode, setLayoutItem, type NodePatch } from "../editor/commands";
import { currentPage, useEditor } from "../editor/store";
import { renderExport } from "../export/exportDocument";
import { sourceBounds } from "../export/exportRenderer";
import type { ExportTarget } from "../export/exportTypes";
import { GOOGLE_FAMILIES, ensureFont, installedFamilies } from "../fonts/fontLibrary";

type Json = Record<string, unknown>;

/** A layer as the assistant describes it. Unknown keys are ignored; wrong values are reported back. */
export interface NodeSpec extends Json {
  type?: string;
  children?: NodeSpec[];
}

class BadRequest extends Error {}

const fail = (message: string): never => {
  throw new BadRequest(message);
};

const number = (spec: Json, key: string): number | undefined => {
  const value = spec[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "number" || !Number.isFinite(value)) fail(`"${key}" must be a number, got ${JSON.stringify(value)}.`);
  return value as number;
};

const text = (spec: Json, key: string): string | undefined => {
  const value = spec[key];
  if (value === undefined || value === null) return undefined;
  if (typeof value !== "string") fail(`"${key}" must be a string, got ${JSON.stringify(value)}.`);
  return value as string;
};

function oneOf<T extends string>(spec: Json, key: string, allowed: readonly T[]): T | undefined {
  const value = text(spec, key);
  if (value !== undefined && !allowed.includes(value as T)) fail(`"${key}" must be one of ${allowed.join(", ")}; got "${value}".`);
  return value as T | undefined;
}

/** #rgb or #rrggbb, as the document stores colours. */
function colour(value: unknown, key: string): string {
  const match = typeof value === "string" ? /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec(value.trim()) : null;
  if (!match) return fail(`"${key}" must be a hex colour such as "#1a73e8", got ${JSON.stringify(value)}.`);
  const hex = match[1]!.toLowerCase();
  return `#${hex.length === 3 ? [...hex].map((c) => c + c).join("") : hex}`;
}

/** `fill` / `stroke`: a colour, or null / "none" for nothing. Undefined when the spec does not say. */
function paints(spec: Json, key: "fill" | "stroke") {
  if (!(key in spec)) return undefined;
  const value = spec[key];
  if (value === null || value === "none" || value === "transparent") return [];
  return [solidPaint(colour(value, key), number(spec, `${key}Opacity`) ?? 1)];
}

function effects(spec: Json): Effect[] | undefined {
  if (!("shadow" in spec) && !("blur" in spec)) return undefined;
  const out: Effect[] = [];
  const shadow = spec.shadow;
  if (shadow && typeof shadow === "object") {
    const s = shadow as Json;
    out.push({
      ...dropShadow(),
      type: s.inner === true ? "inner-shadow" : "drop-shadow",
      color: s.color === undefined ? "#000000" : colour(s.color, "shadow.color"),
      opacity: number(s, "opacity") ?? 0.25,
      offsetX: number(s, "x") ?? 0,
      offsetY: number(s, "y") ?? 4,
      blur: Math.max(0, number(s, "blur") ?? 8),
      spread: number(s, "spread") ?? 0,
    });
  }
  const blur = number(spec, "blur");
  if (blur !== undefined && blur > 0) out.push({ ...layerBlur(), blur });
  return out;
}

function radii(spec: Json): CornerRadii | undefined {
  const value = spec.cornerRadius;
  if (value === undefined || value === null) return undefined;
  if (typeof value === "number" && value >= 0) return [value, value, value, value];
  if (Array.isArray(value) && value.length === 4 && value.every((v) => typeof v === "number" && v >= 0)) return value as unknown as CornerRadii;
  return fail(`"cornerRadius" must be a number or four numbers (top-left, top-right, bottom-right, bottom-left).`);
}

const ALIGN = ["start", "center", "end", "space-between"] as const;
const CROSS = ["start", "center", "end"] as const;
const SIZING = ["fixed", "hug", "fill"] as const;

/** The auto layout a spec asks for, on top of what the frame already has. */
function layoutOf(spec: Json, current: AutoLayout | undefined, sized: { width: boolean; height: boolean }): AutoLayout | null | undefined {
  if (!("layout" in spec)) return undefined;
  const value = spec.layout;
  if (value === null || value === "none") return null;
  const l: Json = typeof value === "string" ? { mode: value } : (value as Json);
  if (!l || typeof l !== "object") return fail(`"layout" must be "horizontal", "vertical", an object, or null.`);
  const padding = number(l, "padding");
  const side = (key: "paddingTop" | "paddingRight" | "paddingBottom" | "paddingLeft", axis: "paddingX" | "paddingY") =>
    Math.max(0, number(l, key) ?? number(l, axis) ?? padding ?? current?.[key] ?? 0);
  return {
    mode: oneOf(l, "mode", ["horizontal", "vertical"] as const) ?? current?.mode ?? "vertical",
    gap: number(l, "gap") ?? current?.gap ?? 0,
    paddingTop: side("paddingTop", "paddingY"),
    paddingRight: side("paddingRight", "paddingX"),
    paddingBottom: side("paddingBottom", "paddingY"),
    paddingLeft: side("paddingLeft", "paddingX"),
    primaryAlign: oneOf(l, "align", ALIGN) ?? current?.primaryAlign ?? "start",
    counterAlign: oneOf(l, "crossAlign", CROSS) ?? current?.counterAlign ?? "start",
    // A frame given a size keeps it; one without hugs its content.
    widthSizing: current?.widthSizing ?? (sized.width ? "fixed" : "hug"),
    heightSizing: current?.heightSizing ?? (sized.height ? "fixed" : "hug"),
    wrap: typeof l.wrap === "boolean" ? l.wrap : (current?.wrap ?? false),
  };
}

/** How the layer is sized by an auto layout parent, read from `widthSizing`, `heightSizing` and `absolute`. */
function sizingOf(spec: Json) {
  const width = oneOf(spec, "widthSizing", SIZING);
  const height = oneOf(spec, "heightSizing", SIZING);
  const item: LayoutItem = {};
  if (width) item.fillWidth = width === "fill";
  if (height) item.fillHeight = height === "fill";
  if (typeof spec.absolute === "boolean") item.absolute = spec.absolute;
  for (const key of ["minWidth", "maxWidth", "minHeight", "maxHeight"] as const) {
    const limit = number(spec, key);
    if (limit !== undefined) item[key] = limit;
  }
  const frame: Partial<AutoLayout> = {};
  if (width && width !== "fill") frame.widthSizing = width;
  if (height && height !== "fill") frame.heightSizing = height;
  return { item, frame };
}

/** The plain properties of a spec, as a patch for `patchNodes` (only keys the node type has are applied). */
function patchOf(spec: Json): NodePatch {
  const patch: NodePatch = {};
  const set = <K extends keyof NodePatch>(key: K, value: NodePatch[K] | undefined) => {
    if (value !== undefined) patch[key] = value;
  };
  set("name", text(spec, "name"));
  set("x", number(spec, "x"));
  set("y", number(spec, "y"));
  set("rotation", number(spec, "rotation"));
  set("opacity", number(spec, "opacity"));
  if (typeof spec.visible === "boolean") patch.visible = spec.visible;
  if (typeof spec.locked === "boolean") patch.locked = spec.locked;
  set("fills", paints(spec, "fill"));
  set("strokes", paints(spec, "stroke"));
  set("strokeWidth", number(spec, "strokeWidth"));
  set("effects", effects(spec));
  set("cornerRadii", radii(spec));
  if (typeof spec.clipContent === "boolean") patch.clipContent = spec.clipContent;
  set("sides", number(spec, "sides"));
  set("pointCount", number(spec, "points"));
  set("innerRatio", number(spec, "innerRatio"));
  set("text", text(spec, "text"));
  set("fontFamily", text(spec, "fontFamily"));
  set("fontSize", number(spec, "fontSize"));
  set("fontWeight", number(spec, "fontWeight"));
  set("lineHeight", number(spec, "lineHeight"));
  set("letterSpacing", number(spec, "letterSpacing"));
  set("textAlign", oneOf(spec, "textAlign", ["left", "center", "right"] as const));
  return patch;
}

const TYPES = ["frame", "rectangle", "ellipse", "line", "polygon", "star", "text"] as const;

function blank(spec: NodeSpec): SceneNode {
  const type = oneOf(spec, "type", TYPES) ?? fail(`Every node needs a "type": one of ${TYPES.join(", ")}.`);
  const box = { x: number(spec, "x") ?? 0, y: number(spec, "y") ?? 0, width: Math.max(1, number(spec, "width") ?? 100), height: Math.max(1, number(spec, "height") ?? 100) };
  switch (type) {
    case "frame":
      return createFrame(box);
    case "rectangle":
      return createRectangle(box);
    case "ellipse":
      return createEllipse(box);
    case "polygon":
      return createPolygon(box);
    case "star":
      return createStar(box);
    case "line":
      return createLine({ x: box.x, y: box.y }, { x: number(spec, "x2") ?? box.x + box.width, y: number(spec, "y2") ?? box.y });
    default:
      // A text given a width wraps inside it; otherwise its box hugs the words.
      return createText(box, text(spec, "text") ?? "", number(spec, "width") === undefined ? "auto" : number(spec, "height") === undefined ? "height" : "fixed");
  }
}

/** Adds a spec and everything nested in it to the page, returning the new layer's id. */
function build(page: Page, spec: NodeSpec, parentId: NodeId | null): { page: Page; id: NodeId } {
  if (!spec || typeof spec !== "object") fail("Each node must be an object.");
  let node = blank(spec);
  // A line's place comes from its end points, not from x/y.
  const { x: _x, y: _y, ...appearance } = patchOf(spec);
  node = { ...node, ...(node.type === "line" ? appearance : patchOf(spec)) } as SceneNode;
  const { item, frame } = sizingOf(spec);
  if (node.type === "frame") {
    const layout = layoutOf(spec, undefined, { width: number(spec, "width") !== undefined, height: number(spec, "height") !== undefined });
    if (layout) node = { ...node, layout: { ...layout, ...frame } };
  }
  const active = Object.fromEntries(Object.entries(item).filter(([, value]) => value !== false)) as LayoutItem;
  if (Object.keys(active).length > 0) node = { ...node, layoutItem: active };

  let next = insertNode(page, node, parentId);
  const children = spec.children ?? [];
  if (children.length > 0) {
    if (!Array.isArray(children)) fail(`"children" must be a list of nodes.`);
    if (node.type !== "frame") fail(`Only a frame can have children; "${node.type}" cannot.`);
    for (const child of children) next = build(next, child, node.id).page;
  }
  return { page: next, id: node.id };
}

/** Changes an existing layer to match the keys present in the spec. */
function update(page: Page, spec: NodeSpec): Page {
  const id = text(spec, "id") ?? fail(`Each update needs the "id" of the layer to change.`);
  const before = page.nodes[id] ?? fail(`There is no layer with id "${id}" on this page.`);
  let next = patchNodes(page, [id], patchOf(spec));
  const width = number(spec, "width");
  const height = number(spec, "height");
  if (width !== undefined || height !== undefined) next = resizeNode(next, id, width ?? next.nodes[id]!.width, height ?? next.nodes[id]!.height);

  const node = next.nodes[id]!;
  const { item, frame } = sizingOf(spec);
  if (node.type === "frame") {
    const layout = layoutOf(spec, node.layout, { width: true, height: true });
    const { layout: _had, ...plain } = node;
    if (layout === null) next = refitGroups({ ...next, nodes: { ...next.nodes, [id]: plain } });
    else if (layout || (node.layout && Object.keys(frame).length > 0)) {
      next = refitGroups({ ...next, nodes: { ...next.nodes, [id]: { ...node, layout: { ...(layout ?? node.layout!), ...frame } } } });
    }
  }
  if (Object.keys(item).length > 0) next = setLayoutItem(next, [id], item);

  if ("parentId" in spec) {
    const parentId = spec.parentId === null ? null : (text(spec, "parentId") ?? null);
    if (parentId !== null && !next.nodes[parentId]) fail(`There is no layer with id "${parentId}" to move into.`);
    if (parentId !== before.parentId) next = moveNodesInTree(next, [id], parentId, null);
  }
  return next;
}

/** A layer as the assistant reads it back: enough to find it, check it and change it. */
function describe(page: Page, id: NodeId, depth: number): Json | null {
  const node = page.nodes[id];
  if (!node) return null;
  const round = (value: number) => Math.round(value * 100) / 100;
  const visiblePaint = (list: readonly { type: string; visible: boolean; color?: string }[]) => list.find((p) => p.visible && p.type === "solid")?.color;
  const out: Json = { id, type: node.type, name: node.name, x: round(node.x), y: round(node.y), width: round(node.width), height: round(node.height) };
  if (node.rotation) out.rotation = round(node.rotation);
  if (node.opacity !== 1) out.opacity = node.opacity;
  if (!node.visible) out.visible = false;
  const fill = visiblePaint(node.fills);
  if (fill) out.fill = fill;
  const stroke = node.strokeWidth > 0 ? visiblePaint(node.strokes) : undefined;
  if (stroke) Object.assign(out, { stroke, strokeWidth: node.strokeWidth });
  if ((node.type === "frame" || node.type === "rectangle") && node.cornerRadii.some((r) => r > 0)) out.cornerRadius = node.cornerRadii.every((r) => r === node.cornerRadii[0]) ? node.cornerRadii[0] : node.cornerRadii;
  if (node.type === "text") Object.assign(out, { text: node.text, fontFamily: node.fontFamily, fontSize: node.fontSize, fontWeight: node.fontWeight, textAlign: node.textAlign });
  if (node.type === "frame" && node.layout) {
    const l = node.layout;
    out.layout = { mode: l.mode, gap: l.gap, paddingTop: l.paddingTop, paddingRight: l.paddingRight, paddingBottom: l.paddingBottom, paddingLeft: l.paddingLeft, align: l.primaryAlign, crossAlign: l.counterAlign, wrap: l.wrap };
    Object.assign(out, { widthSizing: l.widthSizing, heightSizing: l.heightSizing });
  }
  if (node.layoutItem?.fillWidth) out.widthSizing = "fill";
  if (node.layoutItem?.fillHeight) out.heightSizing = "fill";
  if (node.layoutItem?.absolute) out.absolute = true;
  if (isContainer(node) && node.children.length > 0) {
    out.children = depth > 0 ? node.children.map((child) => describe(page, child, depth - 1)) : `${node.children.length} layers (ask for this id to see them)`;
  }
  return out;
}

/** Fetches the fonts the specs name before anything is measured with them. */
async function loadFonts(specs: readonly NodeSpec[]): Promise<void> {
  const wanted: Promise<void>[] = [];
  const visit = (spec: NodeSpec) => {
    if (spec && typeof spec.fontFamily === "string") wanted.push(ensureFont(spec.fontFamily, [typeof spec.fontWeight === "number" ? spec.fontWeight : 400]));
    if (spec && Array.isArray(spec.children)) spec.children.forEach(visit);
  };
  specs.forEach(visit);
  await installedFamilies();
  await Promise.all(wanted);
}

const list = (value: unknown, key: string): NodeSpec[] => (Array.isArray(value) ? (value as NodeSpec[]) : fail(`"${key}" must be a list.`));

async function toBase64(bytes: Uint8Array): Promise<string> {
  const url = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(new Blob([bytes as BlobPart]));
  });
  return url.slice(url.indexOf(",") + 1);
}

const MAX_PICTURE_SIDE = 1600;

export const handlers: Record<string, (params: Json) => unknown> = {
  get_document() {
    const s = useEditor.getState();
    return {
      name: s.doc.name,
      currentPageId: s.pageId,
      pages: s.doc.pages.map((page) => ({ id: page.id, name: page.name, background: page.background, layers: Object.keys(page.nodes).length })),
      selection: s.selection,
    };
  },

  get_nodes(params) {
    const page = currentPage(useEditor.getState());
    const depth = number(params, "depth") ?? 6;
    const id = text(params, "nodeId");
    if (id) return describe(page, id, depth) ?? fail(`There is no layer with id "${id}" on this page.`);
    // Listed back to front, the order they are painted in.
    return { page: page.name, background: page.background, layers: page.children.map((child) => describe(page, child, depth)) };
  },

  async create_nodes(params) {
    const specs = list(params.nodes, "nodes");
    const parentId = text(params, "parentId") ?? null;
    await loadFonts(specs);
    const s = useEditor.getState();
    if (parentId !== null && currentPage(s).nodes[parentId]?.type !== "frame") fail(`"parentId" must be the id of a frame on the current page.`);
    const created: NodeId[] = [];
    let result: Page | null = null;
    s.edit((page) => {
      let next = page;
      for (const spec of specs) {
        const built = build(next, spec, parentId);
        next = built.page;
        created.push(built.id);
      }
      return (result = next);
    }, created);
    if (parentId === null) zoomToFit();
    const page = result ?? currentPage(useEditor.getState());
    return { created: created.map((id) => describe(page, id, 12)) };
  },

  async update_nodes(params) {
    const specs = list(params.updates, "updates");
    await loadFonts(specs);
    const s = useEditor.getState();
    s.edit((page) => specs.reduce(update, page));
    const page = currentPage(useEditor.getState());
    return { updated: specs.map((spec) => describe(page, String(spec.id), 0)) };
  },

  delete_nodes(params) {
    const ids = list(params.ids, "ids") as unknown as NodeId[];
    const s = useEditor.getState();
    const page = currentPage(s);
    const missing = ids.filter((id) => !page.nodes[id]);
    if (missing.length > 0) fail(`No layer with id ${missing.map((id) => `"${id}"`).join(", ")} on this page.`);
    const doomed = new Set(ids.flatMap((id) => subtreeIds(page, id)));
    s.edit((p) => removeNodes(p, ids), s.selection.filter((id) => !doomed.has(id)));
    return { deleted: doomed.size };
  },

  select_nodes(params) {
    const ids = list(params.ids, "ids") as unknown as NodeId[];
    const s = useEditor.getState();
    const page = currentPage(s);
    s.select(ids.filter((id) => page.nodes[id]));
    zoomToFit();
    return { selection: useEditor.getState().selection };
  },

  set_page(params) {
    const s = useEditor.getState();
    const create = text(params, "create");
    if (create !== undefined) {
      const added = addPage(s.doc);
      s.editDoc(() => ({ ...added.doc, pages: added.doc.pages.map((p) => (p.id === added.pageId && create ? { ...p, name: create } : p)) }), { pageId: added.pageId, selection: [] });
    }
    const pageId = text(params, "pageId");
    if (pageId) {
      if (!useEditor.getState().doc.pages.some((p) => p.id === pageId)) fail(`There is no page with id "${pageId}".`);
      useEditor.getState().setPage(pageId);
    }
    const now = useEditor.getState();
    const name = text(params, "name");
    const background = "background" in params ? colour(params.background, "background") : undefined;
    if (name || background) {
      now.editDoc((doc) => ({ ...doc, pages: doc.pages.map((p) => (p.id === now.pageId ? { ...p, ...(name ? { name } : {}), ...(background ? { background } : {}) } : p)) }));
    }
    return handlers.get_document!({});
  },

  async search_fonts(params) {
    const wanted = (text(params, "query") ?? "").trim().toLowerCase();
    const matches = (family: string) => !wanted || family.toLowerCase().includes(wanted);
    const local = (await installedFamilies()).filter(matches);
    const google = GOOGLE_FAMILIES.filter(matches);
    return { installed: local.slice(0, 40), google: google.slice(0, 40), more: Math.max(0, local.length - 40) + Math.max(0, google.length - 40) };
  },

  /** A PNG of one layer, or of the whole page, so the assistant can look at what it made. */
  async export_image(params) {
    const page = currentPage(useEditor.getState());
    const id = text(params, "nodeId");
    if (id && !page.nodes[id]) fail(`There is no layer with id "${id}" on this page.`);
    if (!id && page.children.length === 0) fail("The page is empty, so there is nothing to picture.");
    const target: ExportTarget = id ? { key: id, label: page.nodes[id]!.name, kind: "node", nodeIds: [id] } : { key: "page", label: page.name, kind: "page", nodeIds: [...childrenOf(page, null)] };
    const bounds = sourceBounds(page, target);
    const scale = Math.min(Math.max(0.1, number(params, "scale") ?? 1), MAX_PICTURE_SIDE / Math.max(bounds.width, bounds.height, 1));
    const size = { width: Math.max(1, Math.round(bounds.width * scale)), height: Math.max(1, Math.round(bounds.height * scale)) };
    const result = await renderExport(page, { target, format: "png", size, fit: "stretch", transparent: false, background: page.background, quality: 1, lossless: true, pdfMode: "image", fileName: "preview" });
    return { image: await toBase64(result.bytes), mimeType: "image/png", width: result.width, height: result.height };
  },
};

/** Runs one request, turning anything that goes wrong into a message the assistant can act on. */
export async function handleRequest(method: string, params: Json): Promise<{ result: unknown } | { error: string }> {
  const handler = handlers[method];
  if (!handler) return { error: `Unknown request "${method}".` };
  const s = useEditor.getState();
  if (s.editingTextId || s.transaction) return { error: "The user is in the middle of an edit in Drafiqo. Try again in a moment." };
  try {
    return { result: await handler(params ?? {}) };
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }
}
