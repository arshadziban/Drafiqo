// Snapshot history. Documents are immutable and share structure between
// versions, so keeping whole snapshots costs only what actually changed.

export interface History<T> {
  past: T[];
  future: T[];
}

export const HISTORY_LIMIT = 300;

export function emptyHistory<T>(): History<T> {
  return { past: [], future: [] };
}

/** Records `previous` as the state to return to; any redo branch is discarded. */
export function record<T>(history: History<T>, previous: T, limit = HISTORY_LIMIT): History<T> {
  const past = [...history.past, previous];
  return { past: past.length > limit ? past.slice(past.length - limit) : past, future: [] };
}

export function undo<T>(history: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = history.past[history.past.length - 1];
  if (state === undefined) return null;
  return { history: { past: history.past.slice(0, -1), future: [current, ...history.future] }, state };
}

export function redo<T>(history: History<T>, current: T): { history: History<T>; state: T } | null {
  const state = history.future[0];
  if (state === undefined) return null;
  return { history: { past: [...history.past, current], future: history.future.slice(1) }, state };
}
