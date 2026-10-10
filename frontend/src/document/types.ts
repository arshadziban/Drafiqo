// The Drafiqo document model. Plain JSON-serializable data, independent of
// React and of how the canvas is rendered.

export const SCHEMA_VERSION = 1;
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
export type Paint = SolidPaint;

export interface DropShadowEffect {
  id: string;
  type: "drop-shadow";
  color: string;
  opacity: number;
  offsetX: number;
  offsetY: number;
  blur: number;
  visible: boolean;
}
export type Effect = DropShadowEffect;

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
  strokes: Paint[];
  strokeWidth: number;
  effects: Effect[];
}

export interface FrameNode extends BaseNode {
  type: "frame";
  children: NodeId[];
  clipContent: boolean;
  cornerRadius: number;
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
  cornerRadius: number;
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

export interface VectorNode extends BaseNode {
  type: "vector";
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
