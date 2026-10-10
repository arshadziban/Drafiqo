import { memo } from "react";
import type { NodeId } from "../document/types";
import { currentPage, useEditor } from "../editor/store";
import { NodeElement } from "./renderNode";

const renderChild = (id: NodeId) => <NodeView key={id} id={id} />;

/** Live canvas node. Subscribes only to its own node, so edits repaint just what changed. */
export const NodeView = memo(function NodeView({ id }: { id: NodeId }) {
  const node = useEditor((s) => currentPage(s).nodes[id]);
  const editing = useEditor((s) => s.editingTextId === id);
  if (!node) return null;
  return <NodeElement node={node} editing={editing} renderChild={renderChild} />;
});
