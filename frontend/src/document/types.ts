// The Drafiqo document model. Plain JSON-serializable data, independent of
// React and of how the canvas is rendered.

export const SCHEMA_VERSION = 4;
export const FILE_FORMAT = "drafiqo";

export type NodeId = string;
export type PageId = string;

export interface SolidPaint {
  id: string;
  type: "solid";
  /** #rrggbb */
  color: string;
  opacity: number;
  visible: boolean;
}

export type ImageScaleMode = "fill" | "fit" | "stretch";

/** A picture painted inside a shape. The pixels live in the document's `assets`. */
export interface ImagePaint {
  id: string;
  type: "image";
  assetId: string;
  /** fill: covers the shape, cropping the overflow. fit: whole picture inside. stretch: distorts to the shape. */
  scaleMode: ImageScaleMode;
  opacity: number;
  visible: boolean;
}

export type Paint = SolidPaint | ImagePaint;

/** An embedded picture, stored once however many shapes use it. */
export interface ImageAsset {
  id: string;
  name: string;
  mime: string;
  width: number;
  height: number;
  /** The file's bytes as a data: URL. */
  url: string;
}

/** A shadow cast behind the layer, or one painted inside its edges. */
export interface ShadowEffect {
  id: string;
  type: "drop-shadow" | "inner-shadow";
  color: string;
  opacity: number;
  offsetX: number;
  offsetY: number;
  blur: number;
  /** Grows (positive) or shrinks (negative) the shadow before it is blurred. */
  spread: number;
  visible: boolean;
}

/** Blurs the whole layer. */
export interface LayerBlurEffect {
  id: string;
  type: "layer-blur";
  blur: number;
  visible: boolean;
}

export type Effect = ShadowEffect | LayerBlurEffect;
export type EffectType = Effect["type"];

export type StrokeCap = "butt" | "round" | "square";
export type StrokeJoin = "miter" | "round" | "bevel";

/**
 * Geometry shared by every node. `x`/`y` are the top-left corner in the
 * parent's coordinate space; `rotation` is in degrees around the node centre.
 */
export interface BaseNode {
  id: NodeId;
  name: string;
  parentId: NodeId | null;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  opacity: number;
  visible: boolean;
  locked: boolean;
  fills: Paint[];
  strokes: SolidPaint[];
  strokeWidth: number;
  effects: Effect[];
  layoutItem?: LayoutItem;
}

/** Corner radii in the order top-left, top-right, bottom-right, bottom-left. */
export type CornerRadii = [number, number, number, number];

export type LayoutMode = "horizontal" | "vertical";
/** Where the children sit along the layout direction. */
export type LayoutAlign = "start" | "center" | "end" | "space-between";
export type LayoutCrossAlign = "start" | "center" | "end";
/** hug: the frame is as large as its children plus padding. fixed: it keeps the size it was given. */
export type LayoutSizing = "hug" | "fixed";

/** Lines a frame's children up in a row or a column and keeps them there. */
export interface AutoLayout {
  mode: LayoutMode;
  /** Space between neighbouring children; ignored when they are spaced between. */
  gap: number;
  paddingTop: number;
  paddingRight: number;
  paddingBottom: number;
  paddingLeft: number;
  primaryAlign: LayoutAlign;
  counterAlign: LayoutCrossAlign;
  widthSizing: LayoutSizing;
  heightSizing: LayoutSizing;
  /** Children that do not fit start a new row (or column), spaced by the same gap. */
  wrap: boolean;
}

/** How a layer behaves inside an auto layout frame, and the limits on a size the layout decides. */
export interface LayoutItem {
  /** Stretches to the room the parent has along that axis. */
  fillWidth?: boolean;
  fillHeight?: boolean;
  /** Left out of the flow: it keeps the place it is given. */
  absolute?: boolean;
  minWidth?: number;
  maxWidth?: number;
  minHeight?: number;
  maxHeight?: number;
}

export interface FrameNode extends BaseNode {
  type: "frame";
  children: NodeId[];
  clipContent: boolean;
  cornerRadii: CornerRadii;
  /** Present on auto layout frames; children are then placed by the frame. */
  layout?: AutoLayout;
}

export interface SectionNode extends BaseNode {
  type: "section";
  children: NodeId[];
}

export interface GroupNode extends BaseNode {
  type: "group";
  children: NodeId[];
}

export interface RectangleNode extends BaseNode {
  type: "rectangle";
  cornerRadii: CornerRadii;
}

export interface EllipseNode extends BaseNode {
  type: "ellipse";
}

/** A line runs along the local x axis; `height` is always 0. */
export interface LineNode extends BaseNode {
  type: "line";
  strokeCap: StrokeCap;
}

export interface PolygonNode extends BaseNode {
  type: "polygon";
  sides: number;
}

export interface StarNode extends BaseNode {
  type: "star";
  pointCount: number;
  /** Inner radius as a fraction of the outer radius (0–1). */
  innerRatio: number;
}

export type TextAlign = "left" | "center" | "right";
/** auto: box hugs the text. height: fixed width, wraps, height hugs. fixed: both fixed. */
export type TextAutoResize = "auto" | "height" | "fixed";

export interface TextNode extends BaseNode {
  type: "text";
  /** Glyphs are painted with a colour, so text has no image fills. */
  fills: SolidPaint[];
  text: string;
  fontFamily: string;
  fontSize: number;
  fontWeight: number;
  /** Multiplier of the font size. */
  lineHeight: number;
  /** Pixels. */
  letterSpacing: number;
  textAlign: TextAlign;
  autoResize: TextAutoResize;
}

/** Anchor with optional Bézier handles, all in the node's local pixel space. */
export interface PathPoint {
  x: number;
  y: number;
  /** Incoming control point (absolute, local space). */
  inX?: number;
  inY?: number;
  /** Outgoing control point (absolute, local space). */
  outX?: number;
  outY?: number;
}

/**
 * A ready-made outline, as imported from another tool: any number of sub-paths,
 * with the stroke already turned into a shape of its own. Both are SVG path
 * data drawn for a box of `width` × `height` and stretched to the node's size.
 */
export interface VectorOutline {
  fill: string;
  /** Painted with the stroke colour. Empty when there is no stroke. */
  stroke: string;
  width: number;
  height: number;
  evenOdd: boolean;
}

export interface VectorNode extends BaseNode {
  type: "vector";
  /** Takes the place of `points` when present. */
  outline?: VectorOutline;
  points: PathPoint[];
  closed: boolean;
  strokeCap: StrokeCap;
  strokeJoin: StrokeJoin;
}

export type ContainerNode = FrameNode | SectionNode | GroupNode;
export type SceneNode =
  | ContainerNode
  | RectangleNode
  | EllipseNode
  | LineNode
  | PolygonNode
  | StarNode
  | TextNode
  | VectorNode;
export type NodeType = SceneNode["type"];

export interface Page {
  id: PageId;
  name: string;
  background: string;
  /** Top-level node ids, back to front. */
  children: NodeId[];
  /** Every node on the page, keyed by id. */
  nodes: Record<NodeId, SceneNode>;
}

export interface DrafiqoDocument {
  format: typeof FILE_FORMAT;
  schemaVersion: number;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  pages: Page[];
  /** Pictures used by image fills, keyed by id. */
  assets: Record<string, ImageAsset>;
}

export const NODE_TYPES: readonly NodeType[] = [
  "frame",
  "section",
  "group",
  "rectangle",
  "ellipse",
  "line",
  "polygon",
  "star",
  "text",
  "vector",
];

export function isContainer(node: SceneNode): node is ContainerNode {
  return node.type === "frame" || node.type === "section" || node.type === "group";
}
