import { isContainer, type ContainerNode, type DrafiqoDocument, type NodeId, type Page, type PageId, type SceneNode } from "./types";

export function getPage(doc: DrafiqoDocument, pageId: PageId): Page | undefined {
  return doc.pages.find((p) => p.id === pageId);
}

export function childrenOf(page: Page, parentId: NodeId | null): readonly NodeId[] {
  if (parentId === null) return page.children;
  const parent = page.nodes[parentId];
  return parent && isContainer(parent) ? parent.children : [];
}

export function getContainer(page: Page, id: NodeId | null): ContainerNode | undefined {
  const node = id ? page.nodes[id] : undefined;
  return node && isContainer(node) ? node : undefined;
}

/** Ancestor ids from the direct parent up to the top-level node. */
export function ancestorsOf(page: Page, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  let parentId = page.nodes[id]?.parentId ?? null;
  while (parentId) {
    out.push(parentId);
    parentId = page.nodes[parentId]?.parentId ?? null;
  }
  return out;
}

/** Path from the top-level ancestor down to (and including) the node. */
export function pathTo(page: Page, id: NodeId): NodeId[] {
  return [...ancestorsOf(page, id).reverse(), id];
}

export function isDescendantOf(page: Page, id: NodeId, ancestorId: NodeId): boolean {
  return ancestorsOf(page, id).includes(ancestorId);
}

/** The node and everything below it, in depth-first paint order. */
export function subtreeIds(page: Page, id: NodeId): NodeId[] {
  const out: NodeId[] = [];
  const visit = (current: NodeId) => {
    const node = page.nodes[current];
    if (!node) return;
    out.push(current);
    if (isContainer(node)) node.children.forEach(visit);
  };
  visit(id);
  return out;
}

/** Every node on the page in paint order (back to front). */
export function paintOrder(page: Page): NodeId[] {
  return page.children.flatMap((id) => subtreeIds(page, id));
}

/** Drops ids whose ancestor is also in the list, and sorts by paint order. */
export function topLevelSelection(page: Page, ids: readonly NodeId[]): NodeId[] {
  const set = new Set(ids);
  const order = new Map(paintOrder(page).map((id, index) => [id, index]));
  return ids
    .filter((id) => page.nodes[id] && !ancestorsOf(page, id).some((a) => set.has(a)))
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
}

export function isEffectivelyVisible(page: Page, id: NodeId): boolean {
  return pathTo(page, id).every((n) => page.nodes[n]?.visible !== false);
}

export function isEffectivelyLocked(page: Page, id: NodeId): boolean {
  return pathTo(page, id).some((n) => page.nodes[n]?.locked === true);
}

/** A unique layer name such as "Rectangle 3" for a new node of the given base name. */
export function nextName(page: Page, baseName: string): string {
  let max = 0;
  for (const node of Object.values(page.nodes) as SceneNode[]) {
    if (node.name === baseName) max = Math.max(max, 1);
    else if (node.name.startsWith(`${baseName} `)) {
      const n = Number(node.name.slice(baseName.length + 1));
      if (Number.isInteger(n)) max = Math.max(max, n);
    }
  }
  return `${baseName} ${max + 1}`;
}
