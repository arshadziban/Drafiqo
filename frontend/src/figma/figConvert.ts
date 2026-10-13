// Turns Figma layers into Drafiqo ones. What Drafiqo has an equal for comes
// across as that (frames, shapes, text, auto layout, shadows); everything
// drawn with a path comes across as an outline that looks the same. What has
// no equal is left out and named in the notes, so nothing goes missing quietly.

import { createId, solidPaint } from "../document/factory";
import { decompose, type Matrix } from "../document/geometry";
import type { AutoLayout, BaseNode, Effect, ImageAsset, LayoutItem, NodeId, Paint, SceneNode, SolidPaint, StrokeCap, StrokeJoin, TextNode } from "../document/types";
import { figKey, type FigFile, type FigGuid, type FigNode } from "./figFile";

type Rgba = { r: number; g: number; b: number; a: number };
type FigPaint = { type?: string; color?: Rgba; opacity?: number; visible?: boolean; stops?: { color: Rgba }[]; image?: { hash?: Uint8Array; name?: string }; imageScaleMode?: string; originalImageWidth?: number; originalImageHeight?: number };
type FigEffect = { type?: string; color?: Rgba; offset?: { x: number; y: number }; radius?: number; spread?: number; visible?: boolean };
type Geometry = { windingRule?: string; commandsBlob?: number }[];

export interface FigImport {
  /** Top-level layers, back to front. */
  children: NodeId[];
  nodes: Record<NodeId, SceneNode>;
  assets: ImageAsset[];
  /** Font families the text is set in. */
  fonts: Set<string>;
  /** Things that could not be carried over exactly, in plain words. */
  notes: string[];
}

const channel = (value: number) => Math.round(Math.min(1, Math.max(0, value)) * 255).toString(16).padStart(2, "0");
const hex = (c: Rgba) => `#${channel(c.r)}${channel(c.g)}${channel(c.b)}`;
const num = (value: unknown, fallback = 0): number => (typeof value === "number" && Number.isFinite(value) ? value : fallback);
const fmt = (n: number) => String(Math.round(n * 1000) / 1000);

const COMMAND_SIZES = [0, 2, 2, 4, 6];
const COMMAND_LETTERS = "ZMLQC";

/** Figma's packed path commands (a byte for the command, then its numbers) as SVG path data. */
export function pathData(blob: Uint8Array | undefined): string {
  if (!blob) return "";
  const view = new DataView(blob.buffer, blob.byteOffset, blob.byteLength);
  const parts: string[] = [];
  for (let offset = 0; offset < blob.length; ) {
    const command = blob[offset++]!;
    const count = COMMAND_SIZES[command];
    if (count === undefined || offset + count * 4 > blob.length) break;
    const numbers: string[] = [];
    for (let i = 0; i < count; i++, offset += 4) numbers.push(fmt(view.getFloat32(offset, true)));
    parts.push(count > 0 ? `${COMMAND_LETTERS[command]}${numbers.join(" ")}` : "Z");
  }
  return parts.join(" ");
}

const WEIGHTS: [RegExp, number][] = [
  [/thin|hairline/, 100],
  [/extra ?light|ultra ?light/, 200],
  [/semi ?bold|demi ?bold/, 600],
  [/extra ?bold|ultra ?bold/, 800],
  [/black|heavy/, 900],
  [/light/, 300],
  [/medium/, 500],
  [/bold/, 700],
];

/** A font weight from a style name such as "SemiBold Italic". */
export function weightOf(style: string): number {
  const name = style.toLowerCase();
  return WEIGHTS.find(([pattern]) => pattern.test(name))?.[1] ?? 400;
}

function imageType(bytes: Uint8Array): string | null {
  const [a, b, c, d] = bytes;
  if (a === 0x89 && b === 0x50) return "image/png";
  if (a === 0xff && b === 0xd8) return "image/jpeg";
  if (a === 0x47 && b === 0x49 && c === 0x46) return "image/gif";
  if (a === 0x52 && b === 0x49 && c === 0x46 && d === 0x46) return "image/webp";
  if (a === 0x3c) return "image/svg+xml";
  return null;
}

function base64(bytes: Uint8Array): string {
  let text = "";
  for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(text);
}

const SHAPES_WITH_OUTLINE = new Set(["VECTOR", "BOOLEAN_OPERATION", "BRUSH", "STAR", "REGULAR_POLYGON", "ELLIPSE", "HIGHLIGHT", "WASHI_TAPE"]);
const NOT_LAYERS = new Set(["SLICE", "VARIABLE", "VARIABLE_SET", "VARIABLE_OVERRIDE", "CODE_LIBRARY", "CODE_FILE", "MODULE", "RESPONSIVE_SET"]);
/** Following one component into another stops here, in case a damaged file refers to itself. */
const MAX_NESTING = 24;

/** Converts the given Figma layers (and everything inside them). */
export function convertFigNodes(file: FigFile, roots: readonly FigNode[]): FigImport {
  const nodes: Record<NodeId, SceneNode> = {};
  const assets = new Map<string, ImageAsset | null>();
  const fonts = new Set<string>();
  const notes = new Set<string>();

  const asset = (paint: FigPaint): ImageAsset | null => {
    const hash = paint.image?.hash;
    if (!hash) return null;
    const name = [...hash].map((byte) => byte.toString(16).padStart(2, "0")).join("");
    if (!assets.has(name)) {
      const bytes = file.images.get(name);
      const mime = bytes && imageType(bytes);
      assets.set(
        name,
        bytes && mime
          ? { id: `img_${name.slice(0, 24)}`, name: paint.image?.name || "Image", mime, width: Math.max(1, num(paint.originalImageWidth, 512)), height: Math.max(1, num(paint.originalImageHeight, 512)), url: `data:${mime};base64,${base64(bytes)}` }
          : null,
      );
    }
    return assets.get(name) ?? null;
  };

  const solid = (color: Rgba, paint: FigPaint): SolidPaint => ({ ...solidPaint(hex(color), Math.min(1, Math.max(0, num(paint.opacity, 1) * num(color.a, 1)))), visible: paint.visible !== false });

  const paints = (list: unknown, allowImage: boolean): Paint[] =>
    (Array.isArray(list) ? (list as FigPaint[]) : []).flatMap((paint): Paint[] => {
      if (paint.type === "SOLID" && paint.color) return [solid(paint.color, paint)];
      if (paint.type === "IMAGE") {
        const picture = allowImage ? asset(paint) : null;
        if (!picture) {
          notes.add("A picture fill could not be carried over.");
          return [];
        }
        const scaleMode = paint.imageScaleMode === "FIT" ? "fit" : paint.imageScaleMode === "STRETCH" ? "stretch" : "fill";
        return [{ id: createId("p"), type: "image", assetId: picture.id, scaleMode, opacity: num(paint.opacity, 1), visible: paint.visible !== false }];
      }
      if (paint.type?.startsWith("GRADIENT") && paint.stops?.length) {
        // No gradients here yet: the colour halfway along stands in.
        notes.add("Gradients are shown as a single colour.");
        return [solid(paint.stops[Math.floor((paint.stops.length - 1) / 2)]!.color, paint)];
      }
      return [];
    });

  const effects = (list: unknown): Effect[] => {
    const out: Effect[] = [];
    for (const effect of Array.isArray(list) ? (list as FigEffect[]) : []) {
      const visible = effect.visible !== false;
      if (effect.type === "DROP_SHADOW" || effect.type === "INNER_SHADOW") {
        const color = effect.color ?? { r: 0, g: 0, b: 0, a: 0.25 };
        out.push({
          id: createId("fx"),
          type: effect.type === "DROP_SHADOW" ? "drop-shadow" : "inner-shadow",
          color: hex(color),
          opacity: Math.min(1, Math.max(0, num(color.a, 1))),
          offsetX: num(effect.offset?.x),
          offsetY: num(effect.offset?.y),
          blur: Math.max(0, num(effect.radius)),
          spread: num(effect.spread),
          visible,
        });
      } else if (effect.type === "FOREGROUND_BLUR" && !out.some((e) => e.type === "layer-blur")) {
        out.push({ id: createId("fx"), type: "layer-blur", blur: Math.max(0, num(effect.radius)), visible });
      } else if (effect.type === "BACKGROUND_BLUR") {
        notes.add("Background blur is not supported and was left out.");
      }
    }
    return out;
  };

  const geometry = (list: unknown): { d: string; evenOdd: boolean } => {
    const parts = Array.isArray(list) ? (list as Geometry) : [];
    return {
      d: parts.map((part) => pathData(file.blobs[num(part.commandsBlob, -1)])).filter(Boolean).join(" "),
      evenOdd: parts.some((part) => part.windingRule === "ODD"),
    };
  };

  const layout = (fig: FigNode): AutoLayout | undefined => {
    if (fig.stackMode !== "HORIZONTAL" && fig.stackMode !== "VERTICAL") return undefined;
    const horizontal = fig.stackMode === "HORIZONTAL";
    const left = num(fig.stackHorizontalPadding, num(fig.stackPadding));
    const top = num(fig.stackVerticalPadding, num(fig.stackPadding));
    const align = fig.stackPrimaryAlignItems;
    const cross = fig.stackCounterAlignItems;
    // Along its direction a Figma frame hugs unless told otherwise; across it, it is fixed unless told otherwise.
    const primary = fig.stackPrimarySizing === "FIXED" ? "fixed" : "hug";
    const counter = typeof fig.stackCounterSizing === "string" && fig.stackCounterSizing.startsWith("RESIZE_TO_FIT") ? "hug" : "fixed";
    return {
      mode: horizontal ? "horizontal" : "vertical",
      gap: num(fig.stackSpacing),
      paddingTop: Math.max(0, top),
      paddingRight: Math.max(0, num(fig.stackPaddingRight, left)),
      paddingBottom: Math.max(0, num(fig.stackPaddingBottom, top)),
      paddingLeft: Math.max(0, left),
      primaryAlign: align === "CENTER" ? "center" : align === "MAX" ? "end" : align === "SPACE_BETWEEN" || align === "SPACE_EVENLY" ? "space-between" : "start",
      counterAlign: cross === "CENTER" ? "center" : cross === "MAX" ? "end" : "start",
      widthSizing: horizontal ? primary : counter,
      heightSizing: horizontal ? counter : primary,
      wrap: fig.stackWrap === "WRAP",
    };
  };

  /** How a child behaves in its auto layout parent. */
  const layoutItem = (fig: FigNode, parent: AutoLayout | undefined): LayoutItem | undefined => {
    if (!parent) return undefined;
    const item: LayoutItem = {};
    if (fig.stackPositioning === "ABSOLUTE") item.absolute = true;
    const grows = num(fig.stackChildPrimaryGrow) > 0;
    const stretches = fig.stackChildAlignSelf === "STRETCH";
    if (parent.mode === "horizontal" ? grows : stretches) item.fillWidth = true;
    if (parent.mode === "horizontal" ? stretches : grows) item.fillHeight = true;
    return Object.keys(item).length > 0 ? item : undefined;
  };

  const text = (fig: FigNode, base: BaseNode): TextNode => {
    const fontSize = Math.max(1, num(fig.fontSize, 12));
    const font = (fig.fontName ?? {}) as { family?: string; style?: string };
    const meta = ((fig.derivedTextData as { fontMetaData?: { fontWeight?: number; fontLineHeight?: number }[] } | undefined)?.fontMetaData ?? [])[0];
    const line = fig.lineHeight as { value?: number; units?: string } | undefined;
    const spacing = fig.letterSpacing as { value?: number; units?: string } | undefined;
    // "Auto" line height is stored as 100 %: the font's own line height.
    const natural = num(meta?.fontLineHeight, 1.2);
    const lineHeight = !line ? natural : line.units === "PIXELS" ? num(line.value) / fontSize : line.units === "RAW" ? num(line.value, natural) : (num(line.value, 100) / 100) * natural;
    const family = font.family || "Arial";
    fonts.add(family);
    const styles = fig.textData as { characters?: string; characterStyleIDs?: unknown[] } | undefined;
    if (styles?.characterStyleIDs?.length) notes.add("Text with several styles in one layer takes the style of its first character.");
    return {
      ...base,
      type: "text",
      fills: base.fills.filter((fill): fill is SolidPaint => fill.type === "solid"),
      text: styles?.characters ?? "",
      fontFamily: family,
      fontSize,
      fontWeight: num(meta?.fontWeight, weightOf(font.style ?? "")),
      lineHeight: lineHeight > 0 ? Math.round(lineHeight * 1000) / 1000 : natural,
      letterSpacing: spacing?.units === "PIXELS" ? num(spacing.value) : (num(spacing?.value) / 100) * fontSize,
      textAlign: fig.textAlignHorizontal === "CENTER" ? "center" : fig.textAlignHorizontal === "RIGHT" ? "right" : "left",
      autoResize: fig.textAutoResize === "WIDTH_AND_HEIGHT" ? "auto" : fig.textAutoResize === "HEIGHT" ? "height" : "fixed",
    };
  };

  /** The layers inside a node: its own, or for an instance of a component, a copy of the component's. */
  const inside = (fig: FigNode): FigNode[] => {
    const own = file.children.get(figKey(fig.guid)) ?? [];
    if (fig.type !== "INSTANCE" || own.length > 0) return own;
    const symbol = (fig.symbolData as { symbolID?: FigGuid; symbolOverrides?: unknown[] } | undefined)?.symbolID;
    const master = symbol && file.nodes.get(figKey(symbol));
    if (!master) return [];
    if ((fig.symbolData as { symbolOverrides?: unknown[] }).symbolOverrides?.some((override) => Object.keys(override as object).length > 2)) {
      notes.add("Component instances are shown as their main component; changes made on an instance are not carried over.");
    }
    return file.children.get(figKey(master.guid)) ?? [];
  };

  const convert = (fig: FigNode, parentId: NodeId | null, parentLayout: AutoLayout | undefined, depth: number): NodeId | null => {
    if (NOT_LAYERS.has(fig.type) || depth > MAX_NESTING * 4) return null;
    const size = (fig.size ?? { x: 0, y: 0 }) as { x: number; y: number };
    const width = Math.max(0, num(size.x));
    const height = Math.max(0, num(size.y));
    const t = (fig.transform ?? {}) as Record<string, number>;
    const matrix: Matrix = [num(t.m00, 1), num(t.m10), num(t.m01), num(t.m11, 1), num(t.m02), num(t.m12)];
    if (matrix[0] * matrix[3] - matrix[1] * matrix[2] < 0) notes.add("Mirrored layers are shown unmirrored.");
    if (fig.mask === true) notes.add("Masks are not supported; masked layers are shown whole.");
    const item = layoutItem(fig, parentLayout);
    const id = createId("n");
    const base = {
      id,
      name: fig.name || fig.type,
      parentId,
      ...decompose(matrix, width, height),
      width,
      height,
      opacity: Math.min(1, Math.max(0, num(fig.opacity, 1))),
      visible: fig.visible !== false,
      locked: fig.locked === true,
      fills: paints(fig.fillPaints, fig.type !== "TEXT"),
      strokes: paints(fig.strokePaints, false).filter((paint): paint is SolidPaint => paint.type === "solid"),
      strokeWidth: Math.max(0, num(fig.strokeWeight)),
      effects: effects(fig.effects),
      ...(item ? { layoutItem: item } : {}),
    };
    // A layer without stroke colours has no stroke, whatever weight Figma keeps for it.
    if (base.strokes.length === 0) base.strokeWidth = 0;
    const strokeCap: StrokeCap = fig.strokeCap === "ROUND" ? "round" : fig.strokeCap === "SQUARE" ? "square" : "butt";
    const strokeJoin: StrokeJoin = fig.strokeJoin === "ROUND" ? "round" : fig.strokeJoin === "BEVEL" ? "bevel" : "miter";
    const independent = fig.rectangleCornerRadiiIndependent === true;
    const radius = Math.max(0, num(fig.cornerRadius));
    const corner = (key: string) => Math.max(0, independent ? num(fig[key], radius) : radius);
    const cornerRadii: [number, number, number, number] = [corner("rectangleTopLeftCornerRadius"), corner("rectangleTopRightCornerRadius"), corner("rectangleBottomRightCornerRadius"), corner("rectangleBottomLeftCornerRadius")];

    let node: SceneNode;
    let below: FigNode[] = [];
    let ownLayout: AutoLayout | undefined;

    switch (fig.type) {
      case "FRAME":
      case "SYMBOL":
      case "INSTANCE":
      case "SECTION":
      case "COMPONENT_SET": {
        below = inside(fig);
        // What Figma calls a group is a frame that follows its children and paints nothing itself.
        if (fig.resizeToFit === true && fig.type === "FRAME") {
          node = { ...base, type: "group", fills: [], strokes: [], strokeWidth: 0, effects: [], children: [] };
          if (base.effects.length > 0) notes.add("Effects on groups are not supported and were left out.");
        } else {
          ownLayout = layout(fig);
          node = { ...base, type: "frame", children: [], clipContent: fig.frameMaskDisabled !== true && fig.type !== "SECTION", cornerRadii, ...(ownLayout ? { layout: ownLayout } : {}) };
        }
        break;
      }
      case "RECTANGLE":
      case "ROUNDED_RECTANGLE":
        node = { ...base, type: "rectangle", cornerRadii };
        break;
      case "LINE":
        node = { ...base, ...decompose(matrix, width, 0), height: 0, type: "line", fills: [], strokeCap };
        break;
      case "TEXT":
        node = text(fig, base);
        break;
      default: {
        const arc = fig.arcData as { startingAngle?: number; endingAngle?: number; innerRadius?: number } | undefined;
        const wholeEllipse = fig.type === "ELLIPSE" && (!arc || (num(arc.innerRadius) === 0 && Math.abs(Math.abs(num(arc.endingAngle, Math.PI * 2) - num(arc.startingAngle)) - Math.PI * 2) < 1e-3));
        if (wholeEllipse) {
          node = { ...base, type: "ellipse" };
          break;
        }
        const fill = geometry(fig.fillGeometry);
        const stroke = base.strokes.length > 0 ? geometry(fig.strokeGeometry) : { d: "", evenOdd: false };
        // A shape with nothing to paint still holds its place (icons often carry an invisible bounding box).
        if (!fill.d && !stroke.d && !SHAPES_WITH_OUTLINE.has(fig.type)) {
          notes.add(`"${fig.type.toLowerCase().replace(/_/g, " ")}" layers are not supported and were left out.`);
          return null;
        }
        node = { ...base, type: "vector", points: [], closed: true, strokeCap, strokeJoin, outline: { fill: fill.d, stroke: stroke.d, width, height, evenOdd: fill.evenOdd } };
      }
    }

    nodes[id] = node;
    if (node.type === "frame" || node.type === "group") {
      const instanceDepth = fig.type === "INSTANCE" ? depth + 4 : depth + 1;
      node.children = below.map((child) => convert(child, id, ownLayout, instanceDepth)).filter((child): child is NodeId => child !== null);
    }
    return id;
  };

  const children = roots.map((root) => convert(root, null, undefined, 0)).filter((id): id is NodeId => id !== null);
  return { children, nodes, assets: [...assets.values()].filter((a): a is ImageAsset => a !== null), fonts, notes: [...notes] };
}
