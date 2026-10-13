import { memo } from "react";
import type { NodeId, TextNode } from "../document/types";
import { currentPage, useEditor } from "../editor/store";
import { useCulled } from "./culling";
import { NodeElement } from "./renderNode";

const renderChild = (id: NodeId) => <NodeView key={id} id={id} />;

/** Only a text layer needs to know whether it is being edited (its glyphs hide behind the editor). */
function TextView({ node }: { node: TextNode }) {
  const editing = useEditor((s) => s.editingTextId === node.id);
  return <NodeElement node={node} editing={editing} renderChild={renderChild} />;
}

/** Live canvas node. Subscribes only to its own node, so edits repaint just what changed. */
export const NodeView = memo(function NodeView({ id }: { id: NodeId }) {
  const node = useEditor((s) => currentPage(s).nodes[id]);
  const culled = useCulled((s) => s.hidden.has(id));
  if (!node || culled) return null;
  if (node.type === "text") return <TextView node={node} />;
  return <NodeElement node={node} renderChild={renderChild} />;
});
