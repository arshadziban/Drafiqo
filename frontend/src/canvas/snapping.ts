import type { Rect } from "../document/geometry";

export interface SnapGuide {
  axis: "x" | "y";
  /** Position of the guide on its axis, in page space. */
  position: number;
  /** Extent of the guide along the other axis. */
  from: number;
  to: number;
}

export interface SnapResult {
  dx: number;
  dy: number;
  guides: SnapGuide[];
}

const stops = (start: number, size: number) => [start, start + size / 2, start + size];

function snapAxis(moving: Rect, targets: readonly Rect[], axis: "x" | "y", threshold: number) {
  const horizontal = axis === "x";
  const mine = horizontal ? stops(moving.x, moving.width) : stops(moving.y, moving.height);
  let best: { delta: number; position: number; target: Rect } | null = null;
  for (const target of targets) {
    const theirs = horizontal ? stops(target.x, target.width) : stops(target.y, target.height);
    for (const a of mine) {
      for (const b of theirs) {
        const delta = b - a;
        if (Math.abs(delta) <= threshold && (!best || Math.abs(delta) < Math.abs(best.delta))) {
          best = { delta, position: b, target };
        }
      }
    }
  }
  return best;
}

/**
 * Finds the smallest nudge that lines an edge or centre of `moving` up with
 * one of the `targets`, per axis, and the guides to draw for it.
 */
export function snapRect(moving: Rect, targets: readonly Rect[], threshold: number): SnapResult {
  const result: SnapResult = { dx: 0, dy: 0, guides: [] };
  const x = snapAxis(moving, targets, "x", threshold);
  const y = snapAxis(moving, targets, "y", threshold);
  if (x) result.dx = x.delta;
  if (y) result.dy = y.delta;
  const moved = { ...moving, x: moving.x + result.dx, y: moving.y + result.dy };
  if (x) {
    result.guides.push({
      axis: "x",
      position: x.position,
      from: Math.min(moved.y, x.target.y),
      to: Math.max(moved.y + moved.height, x.target.y + x.target.height),
    });
  }
  if (y) {
    result.guides.push({
      axis: "y",
      position: y.position,
      from: Math.min(moved.x, y.target.x),
      to: Math.max(moved.x + moved.width, y.target.x + y.target.width),
    });
  }
  return result;
}
