import { Fragment, type ReactElement, type ReactNode, type SVGProps } from "react";
import { localMatrix } from "../document/geometry";
import { layoutText } from "../document/textLayout";
import type { Effect, NodeId, Paint, SceneNode, TextNode } from "../document/types";
import { polygonPoints, starPoints, vectorPath } from "./shapes";

type ShapeProps = SVGProps<SVGElement>;

/** The node's own outline as an SVG element, painted with the given props. */
function geometry(node: SceneNode, props: ShapeProps, key?: string): ReactElement | null {
  const p = { ...(props as Record<string, unknown>), key };
  return shape(node, p);
}

function shape(node: SceneNode, { key, ...p }: Record<string, unknown> & { key?: string }): ReactElement | null {
  switch (node.type) {
    case "frame":
    case "rectangle": {
      const r = Math.min(node.cornerRadius, node.width / 2, node.height / 2);
      return <rect key={key} width={node.width} height={node.height} rx={r} {...p} />;
    }
    case "section":
      return <rect key={key} width={node.width} height={node.height} rx={2} {...p} />;
    case "ellipse":
      return <ellipse key={key} cx={node.width / 2} cy={node.height / 2} rx={node.width / 2} ry={node.height / 2} {...p} />;
    case "line":
      return <line key={key} x1={0} y1={0} x2={node.width} y2={0} strokeLinecap={node.strokeCap} {...p} />;
    case "polygon":
      return <polygon key={key} points={polygonPoints(node)} {...p} />;
    case "star":
      return <polygon key={key} points={starPoints(node)} {...p} />;
    case "vector":
      return <path key={key} d={vectorPath(node.points, node.closed)} strokeLinecap={node.strokeCap} strokeLinejoin={node.strokeJoin} {...p} />;
    default:
      return null;
  }
}

function fillLayers(node: SceneNode): (ReactElement | null)[] {
  if (node.type === "line") return [];
  return node.fills
    .filter((f) => f.visible)
    .map((f) => geometry(node, { fill: f.color, fillOpacity: f.opacity }, f.id));
}

function strokeLayers(node: SceneNode): (ReactElement | null)[] {
  if (node.strokeWidth <= 0) return [];
  return node.strokes
    .filter((s) => s.visible)
    .map((s) =>
      geometry(node, { fill: "none", stroke: s.color, strokeOpacity: s.opacity, strokeWidth: node.strokeWidth }, s.id),
    );
}

export function fontStack(family: string): string {
  return `"${family}", system-ui, sans-serif`;
}

function TextContent({ node, paint }: { node: TextNode; paint: Paint }) {
  const layout = layoutText(node);
  const x = node.textAlign === "center" ? node.width / 2 : node.textAlign === "right" ? node.width : 0;
  const anchor = node.textAlign === "center" ? "middle" : node.textAlign === "right" ? "end" : "start";
  return (
    <text
      fontFamily={fontStack(node.fontFamily)}
      fontSize={node.fontSize}
      fontWeight={node.fontWeight}
      letterSpacing={node.letterSpacing}
      textAnchor={anchor}
      fill={paint.color}
      fillOpacity={paint.opacity}
      style={{ whiteSpace: "pre" }}
    >
      {layout.lines.map((line, i) => (
        <tspan key={i} x={x} y={i * layout.lineHeightPx + layout.baseline}>
          {line}
        </tspan>
      ))}
    </text>
  );
}

function ShadowFilter({ id, node, effects }: { id: string; node: SceneNode; effects: Effect[] }) {
  const pad = Math.max(...effects.map((e) => e.blur * 2 + Math.max(Math.abs(e.offsetX), Math.abs(e.offsetY)))) + node.strokeWidth + 2;
  return (
    <filter
      id={id}
      filterUnits="userSpaceOnUse"
      x={-pad}
      y={-pad}
      width={node.width + pad * 2}
      height={node.height + pad * 2}
      colorInterpolationFilters="sRGB"
    >
      {effects.map((e, i) => (
        <Fragment key={e.id}>
          <feGaussianBlur in="SourceAlpha" stdDeviation={e.blur / 2} result={`blur${i}`} />
          <feOffset in={`blur${i}`} dx={e.offsetX} dy={e.offsetY} result={`offset${i}`} />
          <feFlood floodColor={e.color} floodOpacity={e.opacity} result={`colour${i}`} />
          <feComposite in={`colour${i}`} in2={`offset${i}`} operator="in" result={`shadow${i}`} />
        </Fragment>
      ))}
      <feMerge>
        {effects.map((e, i) => (
          <feMergeNode key={e.id} in={`shadow${i}`} />
        ))}
        <feMergeNode in="SourceGraphic" />
      </feMerge>
    </filter>
  );
}

export interface NodeElementProps {
  node: SceneNode;
  renderChild: (id: NodeId) => ReactNode;
  /** True while the node's text is being edited in place (its glyphs are hidden). */
  editing?: boolean;
  /** Adds hit areas and data attributes for the live canvas; off for export. */
  interactive?: boolean;
}

/**
 * The SVG for one node. Pure: the same markup serves the live canvas and the
 * exporter, so what is exported is what is drawn.
 */
export function NodeElement({ node, renderChild, editing = false, interactive = true }: NodeElementProps): ReactElement | null {
  if (!node.visible) return null;
  const id = node.id;
  const shadows = node.effects.filter((e) => e.visible);
  const filterId = `fx-${id}`;
  const clipId = `clip-${id}`;
  let body: ReactElement;

  if (node.type === "group") {
    body = <>{node.children.map(renderChild)}</>;
  } else if (node.type === "frame" || node.type === "section") {
    const clip = node.type === "frame" && node.clipContent;
    body = (
      <>
        {fillLayers(node)}
        {clip && <clipPath id={clipId}>{geometry(node, {})}</clipPath>}
        <g clipPath={clip ? `url(#${clipId})` : undefined}>{node.children.map(renderChild)}</g>
        {strokeLayers(node)}
      </>
    );
  } else if (node.type === "text") {
    body = (
      <>
        {/* The whole text box is clickable, not just the glyphs. */}
        {interactive && <rect width={node.width} height={node.height} fill="transparent" />}
        <g visibility={editing ? "hidden" : undefined}>
          {node.fills
            .filter((f) => f.visible)
            .map((f) => (
              <TextContent key={f.id} node={node} paint={f} />
            ))}
        </g>
      </>
    );
  } else {
    const thin = interactive && (node.type === "line" || node.type === "vector");
    body = (
      <>
        {fillLayers(node)}
        {strokeLayers(node)}
        {/* Wider invisible stroke so thin lines are easy to grab. */}
        {thin && geometry(node, { fill: "none", stroke: "transparent", strokeWidth: Math.max(node.strokeWidth, 10), pointerEvents: "stroke" })}
      </>
    );
  }

  return (
    <g
      data-node-id={interactive ? id : undefined}
      data-node-type={interactive ? node.type : undefined}
      transform={`matrix(${localMatrix(node).join(" ")})`}
      opacity={node.opacity === 1 ? undefined : node.opacity}
      filter={shadows.length > 0 ? `url(#${filterId})` : undefined}
      pointerEvents={interactive && node.locked ? "none" : undefined}
    >
      {shadows.length > 0 && <ShadowFilter id={filterId} node={node} effects={shadows} />}
      {body}
    </g>
  );
}
