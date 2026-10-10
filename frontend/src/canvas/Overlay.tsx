import { applyToPoint, multiply, selectionBounds, worldMatrix, type Matrix, type Point } from "../document/geometry";
import { isEffectivelyLocked } from "../document/tree";
import type { NodeId, Page } from "../document/types";
import { currentPage, currentViewport, useEditor, type Viewport } from "../editor/store";
import { vectorPath } from "./shapes";
import { useCanvasUi } from "./uiStore";

const ACCENT = "#7c5cff";
const GUIDE = "#ff4d8d";

const viewMatrix = (v: Viewport): Matrix => [v.zoom, 0, 0, v.zoom, v.x, v.y];
const pts = (points: Point[]) => points.map((p) => `${p.x},${p.y}`).join(" ");

const HANDLES: [number, number][] = [
  [0, 0],
  [0.5, 0],
  [1, 0],
  [1, 0.5],
  [1, 1],
  [0.5, 1],
  [0, 1],
  [0, 0.5],
];

function handleCursor(hx: number, hy: number): string {
  if (hx === 0.5) return "ns-resize";
  if (hy === 0.5) return "ew-resize";
  return hx === hy ? "nwse-resize" : "nesw-resize";
}

function Outline({ page, id, view }: { page: Page; id: NodeId; view: Matrix }) {
  const node = page.nodes[id];
  if (!node) return null;
  const m = multiply(view, worldMatrix(page, id));
  const corners = [
    applyToPoint(m, { x: 0, y: 0 }),
    applyToPoint(m, { x: node.width, y: 0 }),
    applyToPoint(m, { x: node.width, y: node.height }),
    applyToPoint(m, { x: 0, y: node.height }),
  ];
  return <polygon points={pts(corners)} fill="none" stroke={ACCENT} strokeWidth={1.5} pointerEvents="none" />;
}

function Handles({ page, id, view }: { page: Page; id: NodeId; view: Matrix }) {
  const node = page.nodes[id];
  if (!node) return null;
  const m = multiply(view, worldMatrix(page, id));
  const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
  const isLine = node.type === "line";
  // On small objects the edge handles would crowd the corners, so they are dropped.
  const scale = Math.hypot(m[0], m[1]);
  const roomy = (hx: number, hy: number) =>
    (hx !== 0.5 || node.width * scale >= 32) && (hy !== 0.5 || node.height * scale >= 32);
  const handles = isLine ? HANDLES.filter(([, hy]) => hy === 0.5) : HANDLES.filter(([hx, hy]) => roomy(hx, hy));
  const top = applyToPoint(m, { x: node.width / 2, y: 0 });
  const up = { x: Math.sin((angle * Math.PI) / 180), y: -Math.cos((angle * Math.PI) / 180) };
  const knob = { x: top.x + up.x * 22, y: top.y + up.y * 22 };
  return (
    <g>
      <line x1={top.x} y1={top.y} x2={knob.x} y2={knob.y} stroke={ACCENT} strokeWidth={1} pointerEvents="none" />
      <circle data-rotate cx={knob.x} cy={knob.y} r={5} fill="#fff" stroke={ACCENT} strokeWidth={1.5} style={{ cursor: "grab" }} />
      {handles.map(([hx, hy]) => {
        const p = applyToPoint(m, { x: hx * node.width, y: (isLine ? 0 : hy) * node.height });
        return (
          <rect
            key={`${hx},${hy}`}
            data-handle={`${hx},${hy}`}
            x={p.x - 4}
            y={p.y - 4}
            width={8}
            height={8}
            rx={1.5}
            fill="#fff"
            stroke={ACCENT}
            strokeWidth={1.5}
            transform={`rotate(${angle} ${p.x} ${p.y})`}
            style={{ cursor: handleCursor(hx, hy) }}
          />
        );
      })}
    </g>
  );
}

function FrameLabels({ page, view, selection }: { page: Page; view: Matrix; selection: NodeId[] }) {
  return (
    <>
      {page.children.map((id) => {
        const node = page.nodes[id];
        if (!node || !node.visible || (node.type !== "frame" && node.type !== "section")) return null;
        const m = multiply(view, worldMatrix(page, id));
        const origin = applyToPoint(m, { x: 0, y: 0 });
        const angle = (Math.atan2(m[1], m[0]) * 180) / Math.PI;
        return (
          <text
            key={id}
            data-label-id={node.locked ? undefined : id}
            transform={`translate(${origin.x} ${origin.y}) rotate(${angle})`}
            y={-7}
            fontSize={11}
            fill={selection.includes(id) ? ACCENT : "#a3aaba"}
            style={{ cursor: "default" }}
          >
            {node.name}
          </text>
        );
      })}
    </>
  );
}

/** Screen-space chrome drawn above the artwork: labels, selection, guides, drafts. */
export function Overlay() {
  const page = useEditor(currentPage);
  const selection = useEditor((s) => s.selection);
  const viewport = useEditor(currentViewport);
  const tool = useEditor((s) => s.tool);
  const editingTextId = useEditor((s) => s.editingTextId);
  const { marquee, guides, penPoints, penCursor } = useCanvasUi();
  const view = viewMatrix(viewport);
  const live = selection.filter((id) => page.nodes[id]);
  const single = live.length === 1 ? live[0]! : null;
  const bounds = live.length > 0 ? selectionBounds(page, live) : null;
  const screenBounds = bounds && {
    x: bounds.x * viewport.zoom + viewport.x,
    y: bounds.y * viewport.zoom + viewport.y,
    width: bounds.width * viewport.zoom,
    height: bounds.height * viewport.zoom,
  };
  const singleNode = single ? page.nodes[single] : undefined;
  const last = penPoints[penPoints.length - 1];

  return (
    <g data-overlay>
      <FrameLabels page={page} view={view} selection={live} />
      {live.map((id) => (
        <Outline key={id} page={page} id={id} view={view} />
      ))}
      {live.length > 1 && screenBounds && (
        <rect {...screenBounds} fill="none" stroke={ACCENT} strokeWidth={1} strokeDasharray="4 3" pointerEvents="none" />
      )}
      {single && tool === "select" && !editingTextId && !isEffectivelyLocked(page, single) && (
        <Handles page={page} id={single} view={view} />
      )}
      {screenBounds && singleNode && !editingTextId && (
        <g pointerEvents="none" transform={`translate(${screenBounds.x + screenBounds.width / 2} ${screenBounds.y + screenBounds.height + 18})`}>
          <rect x={-38} y={-10} width={76} height={16} rx={3} fill={ACCENT} />
          <text textAnchor="middle" y={2} fontSize={10} fill="#fff">
            {Math.round(singleNode.width * 100) / 100} × {Math.round(singleNode.height * 100) / 100}
          </text>
        </g>
      )}
      {guides.map((g, i) =>
        g.axis === "x" ? (
          <line
            key={i}
            x1={g.position * viewport.zoom + viewport.x}
            x2={g.position * viewport.zoom + viewport.x}
            y1={g.from * viewport.zoom + viewport.y}
            y2={g.to * viewport.zoom + viewport.y}
            stroke={GUIDE}
            strokeWidth={1}
            pointerEvents="none"
          />
        ) : (
          <line
            key={i}
            y1={g.position * viewport.zoom + viewport.y}
            y2={g.position * viewport.zoom + viewport.y}
            x1={g.from * viewport.zoom + viewport.x}
            x2={g.to * viewport.zoom + viewport.x}
            stroke={GUIDE}
            strokeWidth={1}
            pointerEvents="none"
          />
        ),
      )}
      {marquee && (
        <rect
          x={marquee.x * viewport.zoom + viewport.x}
          y={marquee.y * viewport.zoom + viewport.y}
          width={marquee.width * viewport.zoom}
          height={marquee.height * viewport.zoom}
          fill={`${ACCENT}22`}
          stroke={ACCENT}
          strokeWidth={1}
          pointerEvents="none"
        />
      )}
      {penPoints.length > 0 && (
        <g pointerEvents="none" transform={`matrix(${view.join(" ")})`}>
          <path d={vectorPath(penPoints, false)} fill="none" stroke={ACCENT} strokeWidth={1.5 / viewport.zoom} />
          {last && penCursor && (
            <path
              d={vectorPath([last, { x: penCursor.x, y: penCursor.y }], false)}
              fill="none"
              stroke={ACCENT}
              strokeWidth={1 / viewport.zoom}
              strokeDasharray={`${4 / viewport.zoom}`}
            />
          )}
          {last && last.outX !== undefined && last.outY !== undefined && last.inX !== undefined && last.inY !== undefined && (
            <line x1={last.inX} y1={last.inY} x2={last.outX} y2={last.outY} stroke={ACCENT} strokeWidth={1 / viewport.zoom} />
          )}
          {penPoints.map((p, i) => (
            <circle key={i} cx={p.x} cy={p.y} r={(i === 0 ? 4.5 : 3.5) / viewport.zoom} fill="#fff" stroke={ACCENT} strokeWidth={1.5 / viewport.zoom} />
          ))}
        </g>
      )}
    </g>
  );
}
