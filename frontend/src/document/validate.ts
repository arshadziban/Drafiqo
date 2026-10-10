import { FILE_FORMAT, NODE_TYPES, SCHEMA_VERSION, type DrafiqoDocument, type NodeType } from "./types";

export type ValidationResult = { ok: true; document: DrafiqoDocument } | { ok: false; errors: string[] };

type Obj = Record<string, unknown>;

const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const isNum = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);
const isStr = (v: unknown): v is string => typeof v === "string";
const isBool = (v: unknown): v is boolean => typeof v === "boolean";
const isColor = (v: unknown): v is string => isStr(v) && /^#[0-9a-fA-F]{6}$/.test(v);
const isUnit = (v: unknown): v is number => isNum(v) && v >= 0 && v <= 1;
const oneOf = (values: readonly string[]) => (v: unknown) => isStr(v) && values.includes(v);

const MAX_ERRORS = 20;

class Reporter {
  errors: string[] = [];
  add(path: string, message: string) {
    if (this.errors.length < MAX_ERRORS) this.errors.push(`${path}: ${message}`);
  }
  check(obj: Obj, path: string, key: string, test: (v: unknown) => boolean, expected: string) {
    if (!test(obj[key])) this.add(`${path}.${key}`, `expected ${expected}`);
  }
}

function checkPaints(r: Reporter, value: unknown, path: string) {
  if (!Array.isArray(value)) return r.add(path, "expected an array");
  value.forEach((paint, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(paint)) return r.add(p, "expected an object");
    r.check(paint, p, "id", isStr, "a string");
    r.check(paint, p, "type", (v) => v === "solid", '"solid"');
    r.check(paint, p, "color", isColor, "a #rrggbb colour");
    r.check(paint, p, "opacity", isUnit, "a number between 0 and 1");
    r.check(paint, p, "visible", isBool, "a boolean");
  });
}

function checkEffects(r: Reporter, value: unknown, path: string) {
  if (!Array.isArray(value)) return r.add(path, "expected an array");
  value.forEach((effect, i) => {
    const p = `${path}[${i}]`;
    if (!isObj(effect)) return r.add(p, "expected an object");
    r.check(effect, p, "id", isStr, "a string");
    r.check(effect, p, "type", oneOf(["drop-shadow", "inner-shadow", "layer-blur"]), '"drop-shadow", "inner-shadow" or "layer-blur"');
    r.check(effect, p, "blur", (v) => isNum(v) && v >= 0, "a non-negative number");
    r.check(effect, p, "visible", isBool, "a boolean");
    if (effect.type === "layer-blur") return;
    r.check(effect, p, "color", isColor, "a #rrggbb colour");
    r.check(effect, p, "opacity", isUnit, "a number between 0 and 1");
    for (const key of ["offsetX", "offsetY", "spread"]) r.check(effect, p, key, isNum, "a number");
  });
}

const nonNegative = (v: unknown) => isNum(v) && v >= 0;
const isCap = oneOf(["butt", "round", "square"]);

function checkNode(r: Reporter, node: Obj, path: string) {
  r.check(node, path, "name", isStr, "a string");
  r.check(node, path, "parentId", (v) => v === null || isStr(v), "a string or null");
  for (const key of ["x", "y", "rotation"]) r.check(node, path, key, isNum, "a number");
  for (const key of ["width", "height", "strokeWidth"]) r.check(node, path, key, nonNegative, "a non-negative number");
  r.check(node, path, "opacity", isUnit, "a number between 0 and 1");
  r.check(node, path, "visible", isBool, "a boolean");
  r.check(node, path, "locked", isBool, "a boolean");
  checkPaints(r, node.fills, `${path}.fills`);
  checkPaints(r, node.strokes, `${path}.strokes`);
  checkEffects(r, node.effects, `${path}.effects`);

  switch (node.type as NodeType) {
    case "frame":
      r.check(node, path, "clipContent", isBool, "a boolean");
      r.check(node, path, "cornerRadius", nonNegative, "a non-negative number");
      break;
    case "rectangle":
      r.check(node, path, "cornerRadius", nonNegative, "a non-negative number");
      break;
    case "line":
      r.check(node, path, "strokeCap", isCap, "a stroke cap");
      break;
    case "polygon":
      r.check(node, path, "sides", (v) => Number.isInteger(v) && (v as number) >= 3, "an integer of at least 3");
      break;
    case "star":
      r.check(node, path, "pointCount", (v) => Number.isInteger(v) && (v as number) >= 3, "an integer of at least 3");
      r.check(node, path, "innerRatio", isUnit, "a number between 0 and 1");
      break;
    case "text":
      r.check(node, path, "text", isStr, "a string");
      r.check(node, path, "fontFamily", isStr, "a string");
      r.check(node, path, "fontSize", (v) => isNum(v) && v > 0, "a positive number");
      r.check(node, path, "fontWeight", (v) => isNum(v) && v >= 1 && v <= 1000, "a font weight");
      r.check(node, path, "lineHeight", (v) => isNum(v) && v > 0, "a positive number");
      r.check(node, path, "letterSpacing", isNum, "a number");
      r.check(node, path, "textAlign", oneOf(["left", "center", "right"]), "left, center or right");
      r.check(node, path, "autoResize", oneOf(["auto", "height", "fixed"]), "auto, height or fixed");
      break;
    case "vector":
      r.check(node, path, "closed", isBool, "a boolean");
      r.check(node, path, "strokeCap", isCap, "a stroke cap");
      r.check(node, path, "strokeJoin", oneOf(["miter", "round", "bevel"]), "a stroke join");
      if (!Array.isArray(node.points)) r.add(`${path}.points`, "expected an array");
      else
        node.points.forEach((pt, i) => {
          const p = `${path}.points[${i}]`;
          if (!isObj(pt)) return r.add(p, "expected an object");
          r.check(pt, p, "x", isNum, "a number");
          r.check(pt, p, "y", isNum, "a number");
          for (const key of ["inX", "inY", "outX", "outY"])
            r.check(pt, p, key, (v) => v === undefined || isNum(v), "a number");
        });
      break;
    default:
      break;
  }
}

function checkPage(r: Reporter, page: Obj, path: string) {
  r.check(page, path, "id", isStr, "a string");
  r.check(page, path, "name", isStr, "a string");
  r.check(page, path, "background", isColor, "a #rrggbb colour");
  if (!isObj(page.nodes)) return r.add(`${path}.nodes`, "expected an object");
  if (!Array.isArray(page.children)) return r.add(`${path}.children`, "expected an array");
  const nodes = page.nodes;

  for (const [id, node] of Object.entries(nodes)) {
    const p = `${path}.nodes.${id}`;
    if (!isObj(node)) {
      r.add(p, "expected an object");
      continue;
    }
    if (node.id !== id) r.add(`${p}.id`, "does not match its key");
    if (!isStr(node.type) || !NODE_TYPES.includes(node.type as NodeType)) {
      // Unknown content is reported, never silently dropped.
      r.add(`${p}.type`, `unsupported node type ${JSON.stringify(node.type)}`);
      continue;
    }
    checkNode(r, node, p);
    const isContainerType = node.type === "frame" || node.type === "section" || node.type === "group";
    if (isContainerType && !Array.isArray(node.children)) r.add(`${p}.children`, "expected an array");
  }

  // Tree integrity: every node is reachable exactly once and parent links agree.
  const seen = new Set<string>();
  const visit = (ids: unknown[], parentId: string | null, p: string) => {
    for (const id of ids) {
      if (!isStr(id) || !isObj(nodes[id])) {
        r.add(p, `references missing node ${JSON.stringify(id)}`);
        continue;
      }
      if (seen.has(id)) {
        r.add(p, `node ${id} appears more than once in the layer tree`);
        continue;
      }
      seen.add(id);
      const node = nodes[id];
      if (node.parentId !== parentId) r.add(`${path}.nodes.${id}.parentId`, "does not match the layer tree");
      if (Array.isArray(node.children)) visit(node.children, id, `${path}.nodes.${id}.children`);
    }
  };
  visit(page.children, null, `${path}.children`);
  for (const id of Object.keys(nodes)) {
    if (!seen.has(id)) r.add(`${path}.nodes.${id}`, "is not attached to the layer tree");
  }
}

/** Structural validation of data that claims to be a current-schema document. */
export function validateDocument(value: unknown): ValidationResult {
  const r = new Reporter();
  if (!isObj(value)) return { ok: false, errors: ["document: expected an object"] };
  r.check(value, "document", "format", (v) => v === FILE_FORMAT, `"${FILE_FORMAT}"`);
  r.check(value, "document", "schemaVersion", (v) => v === SCHEMA_VERSION, `schema version ${SCHEMA_VERSION}`);
  for (const key of ["id", "name", "createdAt", "updatedAt"]) r.check(value, "document", key, isStr, "a string");
  if (!Array.isArray(value.pages) || value.pages.length === 0) {
    r.add("document.pages", "expected at least one page");
  } else {
    const pageIds = new Set<unknown>();
    value.pages.forEach((page, i) => {
      const p = `document.pages[${i}]`;
      if (!isObj(page)) return r.add(p, "expected an object");
      if (pageIds.has(page.id)) r.add(`${p}.id`, "duplicate page id");
      pageIds.add(page.id);
      checkPage(r, page, p);
    });
  }
  return r.errors.length === 0 ? { ok: true, document: value as unknown as DrafiqoDocument } : { ok: false, errors: r.errors };
}
