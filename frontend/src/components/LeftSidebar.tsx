import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Group,
  Image as ImageIcon,
  Lock,
  Plus,
  Trash2,
  Unlock,
} from "lucide-react";
import { memo, useState, type ComponentType, type DragEvent } from "react";
import { useCanvasUi } from "../canvas/uiStore";
import { childrenOf, isEffectivelyLocked, paintOrder } from "../document/tree";
import { isContainer, type NodeId, type NodeType, type Page } from "../document/types";
import { createPageAction, deletePageAction } from "../editor/actions";
import { moveNodesInTree, movePage, patchNodes } from "../editor/commands";
import { currentPage, useEditor } from "../editor/store";
import { IconEllipse, IconFrame, IconLine, IconPen, IconPolygon, IconRectangle, IconSection, IconSidebarLeft, IconStar, IconText, type IconProps } from "../icons/icons";

const TYPE_ICONS: Record<NodeType, ComponentType<IconProps>> = {
  frame: IconFrame,
  section: IconSection,
  group: Group,
  rectangle: IconRectangle,
  ellipse: IconEllipse,
  line: IconLine,
  polygon: IconPolygon,
  star: IconStar,
  text: IconText,
  vector: IconPen,
};

function RenameInput({ initial, onDone, label }: { initial: string; onDone: (name: string | null) => void; label: string }) {
  return (
    <input
      autoFocus
      aria-label={label}
      defaultValue={initial}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => onDone(e.target.value.trim() || null)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") onDone(null);
      }}
      className="h-5 w-full min-w-0 rounded-sm bg-ink-950 px-1 text-ink-100 ring-1 ring-accent outline-none"
    />
  );
}

// ---------------------------------------------------------------------------
// Pages
// ---------------------------------------------------------------------------

function PagesPanel() {
  const pages = useEditor((s) => s.doc.pages);
  const pageId = useEditor((s) => s.pageId);
  const setPage = useEditor((s) => s.setPage);
  const editDoc = useEditor((s) => s.editDoc);
  const [renaming, setRenaming] = useState<string | null>(null);
  const [dropIndex, setDropIndex] = useState<number | null>(null);

  const rename = (id: string, name: string | null) => {
    setRenaming(null);
    if (name) editDoc((doc) => ({ ...doc, pages: doc.pages.map((p) => (p.id === id && p.name !== name ? { ...p, name } : p)) }));
  };

  return (
    <div className="flex max-h-[40%] shrink-0 flex-col border-b border-ink-700">
      <header className="flex h-9 shrink-0 items-center justify-between pr-2 pl-3">
        <h2 className="text-[10.5px] font-semibold tracking-wider text-ink-400 uppercase">Pages</h2>
        <div className="flex items-center gap-0.5">
          <button type="button" aria-label="Add page" data-tip="Add page" onClick={createPageAction} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
            <Plus size={14} strokeWidth={1.75} />
          </button>
          <button
            type="button"
            aria-label="Hide sidebar"
            data-tip="Hide sidebar"
            data-tip-shortcut={"Mod+\\"}
            onClick={() => useEditor.setState({ showLeftSidebar: false })}
            className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100"
          >
            <IconSidebarLeft size={16} />
          </button>
        </div>
      </header>
      <ul className="overflow-y-auto pb-2" data-testid="pages">
        {pages.map((page, index) => (
          <li
            key={page.id}
            draggable={renaming !== page.id}
            onDragStart={(e) => {
              e.dataTransfer.setData("application/x-drafiqo-page", page.id);
              e.dataTransfer.effectAllowed = "move";
            }}
            onDragOver={(e) => {
              if (!e.dataTransfer.types.includes("application/x-drafiqo-page")) return;
              e.preventDefault();
              const rect = e.currentTarget.getBoundingClientRect();
              setDropIndex(e.clientY < rect.top + rect.height / 2 ? index : index + 1);
            }}
            onDragLeave={() => setDropIndex(null)}
            onDrop={(e) => {
              const id = e.dataTransfer.getData("application/x-drafiqo-page");
              const from = pages.findIndex((p) => p.id === id);
              if (dropIndex !== null && from >= 0) {
                // Removing the page first shifts every later index down by one.
                const to = dropIndex > from ? dropIndex - 1 : dropIndex;
                editDoc((doc) => movePage(doc, id, to));
              }
              setDropIndex(null);
            }}
            onClick={() => setPage(page.id)}
            onDoubleClick={() => setRenaming(page.id)}
            className={`group mx-1.5 flex h-7 items-center gap-1 rounded-md px-2 ${
              page.id === pageId ? "bg-ink-700 font-medium text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
            } ${dropIndex === index ? "shadow-[0_-2px_0_var(--color-accent)]" : ""} ${
              dropIndex === index + 1 && index === pages.length - 1 ? "shadow-[0_2px_0_var(--color-accent)]" : ""
            }`}
          >
            {renaming === page.id ? (
              <RenameInput label="Page name" initial={page.name} onDone={(name) => rename(page.id, name)} />
            ) : (
              <>
                <span className="flex-1 truncate">{page.name}</span>
                {pages.length > 1 && (
                  <button
                    type="button"
                    aria-label={`Delete ${page.name}`}
                    data-tip="Delete page"
                    onClick={(e) => {
                      e.stopPropagation();
                      deletePageAction(page.id);
                    }}
                    className="rounded p-0.5 text-ink-400 opacity-0 group-hover:opacity-100 hover:text-ink-100"
                  >
                    <Trash2 size={12} />
                  </button>
                )}
              </>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Layers
// ---------------------------------------------------------------------------

type DropZone = { id: NodeId; where: "above" | "below" | "inside" };

/** Rows in panel order: front-most layer first, children under their parent. */
function visibleRows(page: Page, collapsed: Record<NodeId, boolean>): { id: NodeId; depth: number }[] {
  const rows: { id: NodeId; depth: number }[] = [];
  const visit = (ids: readonly NodeId[], depth: number) => {
    for (let i = ids.length - 1; i >= 0; i--) {
      const id = ids[i]!;
      const node = page.nodes[id];
      if (!node) continue;
      rows.push({ id, depth });
      if (isContainer(node) && !collapsed[id]) visit(node.children, depth + 1);
    }
  };
  visit(page.children, 0);
  return rows;
}

function applyDrop(zone: DropZone, dragged: NodeId[]) {
  const s = useEditor.getState();
  const page = currentPage(s);
  const target = page.nodes[zone.id];
  if (!target) return;
  if (zone.where === "inside") {
    s.edit((p) => moveNodesInTree(p, dragged, zone.id, null), dragged);
    return;
  }
  const siblings = childrenOf(page, target.parentId);
  // The panel lists layers front-first, so "above" a row means later in paint order.
  const before = zone.where === "below" ? zone.id : (siblings[siblings.indexOf(zone.id) + 1] ?? null);
  const safeBefore = before && dragged.includes(before) ? (siblings.slice(siblings.indexOf(before) + 1).find((id) => !dragged.includes(id)) ?? null) : before;
  s.edit((p) => moveNodesInTree(p, dragged, target.parentId, safeBefore), dragged);
}

const LayerRow = memo(function LayerRow({
  id,
  depth,
  zone,
  setZone,
}: {
  id: NodeId;
  depth: number;
  zone: DropZone["where"] | null;
  setZone: (zone: DropZone | null) => void;
}) {
  const node = useEditor((s) => currentPage(s).nodes[id]);
  const selected = useEditor((s) => s.selection.includes(id));
  const collapsed = useEditor((s) => !!s.collapsed[id]);
  const parentLocked = useEditor((s) => {
    const page = currentPage(s);
    const parentId = page.nodes[id]?.parentId;
    return parentId ? isEffectivelyLocked(page, parentId) : false;
  });
  const renaming = useCanvasUi((s) => s.renamingId === id);
  if (!node) return null;
  // A rectangle filled with a picture is an image layer.
  const Icon = node.type === "rectangle" && node.fills.some((f) => f.type === "image") ? ImageIcon : TYPE_ICONS[node.type];
  const container = isContainer(node);

  const onClick = (e: React.MouseEvent) => {
    const s = useEditor.getState();
    if (e.metaKey || e.ctrlKey) {
      s.select(selected ? s.selection.filter((n) => n !== id) : [...s.selection, id]);
    } else if (e.shiftKey && s.selection.length > 0) {
      // Range-select between the last selected layer and this one, in panel order.
      const order = paintOrder(currentPage(s));
      const a = order.indexOf(s.selection[s.selection.length - 1]!);
      const b = order.indexOf(id);
      s.select(order.slice(Math.min(a, b), Math.max(a, b) + 1));
    } else {
      s.select([id]);
    }
  };

  const onDragOver = (e: DragEvent) => {
    if (!e.dataTransfer.types.includes("application/x-drafiqo-layer")) return;
    e.preventDefault();
    const rect = e.currentTarget.getBoundingClientRect();
    const t = (e.clientY - rect.top) / rect.height;
    const where = container ? (t < 0.25 ? "above" : t > 0.75 ? "below" : "inside") : t < 0.5 ? "above" : "below";
    setZone({ id, where });
  };

  return (
    <li
      data-layer-id={id}
      data-selected={selected || undefined}
      draggable={!renaming}
      onDragStart={(e) => {
        const s = useEditor.getState();
        if (!s.selection.includes(id)) s.select([id]);
        e.dataTransfer.setData("application/x-drafiqo-layer", id);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={onDragOver}
      onDrop={(e) => {
        e.preventDefault();
        const s = useEditor.getState();
        if (zone) applyDrop({ id, where: zone }, s.selection);
        setZone(null);
      }}
      onDragEnd={() => setZone(null)}
      onClick={onClick}
      onDoubleClick={() => useCanvasUi.setState({ renamingId: id })}
      style={{ paddingLeft: 6 + depth * 14 }}
      className={`group relative mx-1.5 flex h-7 items-center gap-1 rounded-md pr-1 ${
        selected ? "bg-accent-soft text-ink-100" : "text-ink-300 hover:bg-ink-800 hover:text-ink-100"
      } ${zone === "inside" ? "ring-1 ring-accent" : ""} ${zone === "above" ? "shadow-[0_-2px_0_var(--color-accent)]" : ""} ${
        zone === "below" ? "shadow-[0_2px_0_var(--color-accent)]" : ""
      } ${node.visible ? "" : "opacity-50"}`}
    >
      {container ? (
        <button
          type="button"
          aria-label={collapsed ? "Expand" : "Collapse"}
          onClick={(e) => {
            e.stopPropagation();
            useEditor.setState((s) => ({ collapsed: { ...s.collapsed, [id]: !s.collapsed[id] } }));
          }}
          className="flex h-4 w-4 shrink-0 items-center justify-center text-ink-400 hover:text-ink-100"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronDown size={12} />}
        </button>
      ) : (
        <span className="w-4 shrink-0" />
      )}
      <Icon size={14} className={`mr-0.5 shrink-0 ${selected ? "text-accent-hover" : "text-ink-400"}`} />
      {renaming ? (
        <RenameInput
          label="Layer name"
          initial={node.name}
          onDone={(name) => {
            useCanvasUi.setState({ renamingId: null });
            if (name) useEditor.getState().edit((p) => patchNodes(p, [id], { name }));
          }}
        />
      ) : (
        <span className="flex-1 truncate">{node.name}</span>
      )}
      {!renaming && (
        <>
          <button
            type="button"
            aria-label={node.locked ? "Unlock" : "Lock"}
            data-tip={node.locked ? "Unlock" : "Lock"}
            onClick={(e) => {
              e.stopPropagation();
              useEditor.getState().edit((p) => patchNodes(p, [id], { locked: !node.locked }));
            }}
            className={`shrink-0 rounded p-0.5 hover:text-ink-100 ${node.locked ? "text-ink-100" : `text-ink-400 opacity-0 group-hover:opacity-100 ${parentLocked ? "opacity-40" : ""}`}`}
          >
            {node.locked ? <Lock size={12} /> : <Unlock size={12} />}
          </button>
          <button
            type="button"
            aria-label={node.visible ? "Hide" : "Show"}
            data-tip={node.visible ? "Hide" : "Show"}
            onClick={(e) => {
              e.stopPropagation();
              useEditor.getState().edit((p) => patchNodes(p, [id], { visible: !node.visible }));
            }}
            className={`shrink-0 rounded p-0.5 hover:text-ink-100 ${node.visible ? "text-ink-400 opacity-0 group-hover:opacity-100" : "text-ink-100"}`}
          >
            {node.visible ? <Eye size={12} /> : <EyeOff size={12} />}
          </button>
        </>
      )}
    </li>
  );
});

function LayersPanel() {
  const page = useEditor(currentPage);
  const collapsed = useEditor((s) => s.collapsed);
  const [zone, setZone] = useState<DropZone | null>(null);
  const rows = visibleRows(page, collapsed);

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-9 shrink-0 items-center px-3">
        <h2 className="text-[10.5px] font-semibold tracking-wider text-ink-400 uppercase">Layers</h2>
      </header>
      {rows.length === 0 ? (
        <p className="px-3 leading-relaxed text-ink-400">Nothing on this page yet. Pick a tool and draw on the canvas.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto pb-3" data-testid="layers" onDragLeave={(e) => e.currentTarget === e.target && setZone(null)}>
          {rows.map(({ id, depth }) => (
            <LayerRow key={id} id={id} depth={depth} zone={zone?.id === id ? zone.where : null} setZone={setZone} />
          ))}
        </ul>
      )}
    </div>
  );
}

export function LeftSidebar() {
  return (
    <aside className="flex w-60 shrink-0 flex-col border-r border-black/40 bg-ink-900">
      <PagesPanel />
      <LayersPanel />
    </aside>
  );
}
