import { Check, ChevronUp, Image as ImageIcon, Scaling } from "lucide-react";
import { useCallback, useEffect, useState, type ComponentType } from "react";
import { placeImageFromPicker } from "../editor/images";
import { useEditor, type Tool } from "../editor/store";
import {
  IconEllipse,
  IconSelect,
  IconFrame,
  IconHand,
  IconLine,
  IconSection,
  IconPen,
  IconRectangle,
  IconStar,
  IconText,
  IconPolygon,
  type IconProps,
} from "../icons/icons";
import { formatShortcut, useDismiss } from "./ui";

type ToolDef = { tool: Tool; label: string; key: string; icon: ComponentType<IconProps> };
/** A command offered in a group's menu that does something instead of switching tool. */
type ActionDef = { label: string; key: string; icon: ComponentType<IconProps>; action: () => void };
type ToolGroup = { name: string; tools: [ToolDef, ...ToolDef[]]; actions?: ActionDef[] };

const IconScale = (props: IconProps) => <Scaling strokeWidth={1.5} {...props} />;

/** Dock order. A group with several tools shows one of them and offers the rest in a flyout. */
const GROUPS: ToolGroup[] = [
  {
    name: "move",
    tools: [
      { tool: "select", label: "Select", key: "V", icon: IconSelect },
      { tool: "hand", label: "Hand", key: "H", icon: IconHand },
      { tool: "scale", label: "Scale", key: "K", icon: IconScale },
    ],
  },
  {
    name: "frame",
    tools: [
      { tool: "frame", label: "Frame", key: "F", icon: IconFrame },
      { tool: "section", label: "Section", key: "Shift+S", icon: IconSection },
    ],
  },
  {
    name: "shape",
    tools: [
      { tool: "rectangle", label: "Rectangle", key: "R", icon: IconRectangle },
      { tool: "line", label: "Line", key: "L", icon: IconLine },
      { tool: "ellipse", label: "Ellipse", key: "O", icon: IconEllipse },
      { tool: "polygon", label: "Polygon", key: "Y", icon: IconPolygon },
      { tool: "star", label: "Star", key: "S", icon: IconStar },
    ],
    actions: [{ label: "Image…", key: "Mod+Shift+K", icon: ImageIcon, action: () => void placeImageFromPicker() }],
  },
  { name: "pen", tools: [{ tool: "pen", label: "Pen", key: "P", icon: IconPen }] },
  { name: "text", tools: [{ tool: "text", label: "Text", key: "T", icon: IconText }] },
];

function DockGroup({ group, tool, setTool }: { group: ToolGroup; tool: Tool; setTool: (tool: Tool) => void }) {
  const current = group.tools.find((t) => t.tool === tool);
  // The button keeps showing whichever tool of the group was used last.
  const [shown, setShown] = useState<ToolDef>(group.tools[0]);
  useEffect(() => {
    if (current) setShown(current);
  }, [current]);
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  const active = current !== undefined;
  const Icon = shown.icon;
  const hasMore = group.tools.length > 1 || (group.actions?.length ?? 0) > 0;

  return (
    <div ref={ref} className="relative flex items-center">
      <div className={`flex items-center rounded-[10px] transition-colors duration-100 ${active ? "bg-accent text-white shadow-sm shadow-black/40" : "text-ink-300"}`}>
        <button
          type="button"
          aria-label={`${shown.label} (${formatShortcut(shown.key)})`}
          aria-pressed={active}
          data-tip={shown.label}
          data-tip-shortcut={shown.key}
          data-tip-side="above"
          onClick={() => setTool(shown.tool)}
          className={`relative flex h-9 items-center justify-center rounded-[10px] transition-colors duration-100 ${hasMore ? "w-9" : "w-10"} ${
            active ? "" : "hover:bg-white/8 hover:text-ink-100 active:bg-white/12"
          }`}
        >
          <Icon size={20} />
        </button>
        {hasMore && (
          <button
            type="button"
            aria-label={`More ${group.name} tools`}
            data-tip={`More ${group.name} tools`}
            data-tip-side="above"
            aria-haspopup="menu"
            aria-expanded={open}
            onClick={() => setOpen((o) => !o)}
            className={`-ml-1 flex h-9 w-4 items-center justify-center rounded-[8px] transition-colors duration-100 ${
              active ? "text-white/75 hover:bg-white/15 hover:text-white" : "text-ink-400 hover:bg-white/8 hover:text-ink-100"
            }`}
          >
            <ChevronUp size={10} strokeWidth={2.5} className={`transition-transform duration-150 ${open ? "" : "rotate-180"}`} />
          </button>
        )}
      </div>

      {open && (
        <div role="menu" className="absolute bottom-full left-0 mb-3 min-w-48 animate-pop rounded-xl bg-ink-850 p-1 shadow-popover">
          {group.tools.map((t) => (
            <button
              key={t.tool}
              type="button"
              role="menuitem"
              onClick={() => {
                setTool(t.tool);
                close();
              }}
              className="group/item flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-ink-100 hover:bg-accent hover:text-white"
            >
              <span className="flex w-3 justify-center">{t.tool === shown.tool && <Check size={12} strokeWidth={2.5} />}</span>
              <t.icon size={16} className="text-ink-300 group-hover/item:text-white" />
              <span className="flex-1">{t.label}</span>
              <span className="pl-4 text-ink-400 group-hover/item:text-white/80">{formatShortcut(t.key)}</span>
            </button>
          ))}
          {group.actions?.map((a) => (
            <div key={a.label} role="none">
              <div className="-mx-1 my-1 h-px bg-ink-700" />
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  close();
                  a.action();
                }}
                className="group/item flex h-8 w-full items-center gap-2.5 rounded-lg px-2 text-left text-ink-100 hover:bg-accent hover:text-white"
              >
                <span className="w-3" />
                <a.icon size={16} className="text-ink-300 group-hover/item:text-white" />
                <span className="flex-1">{a.label}</span>
                <span className="pl-4 text-ink-400 group-hover/item:text-white/80">{formatShortcut(a.key)}</span>
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/** The floating tool bar at the bottom centre of the canvas. */
export function ToolDock() {
  const tool = useEditor((s) => s.tool);
  const setTool = useEditor((s) => s.setTool);
  return (
    <div className="pointer-events-none absolute inset-x-0 bottom-5 z-30 flex justify-center">
      <div
        role="toolbar"
        aria-label="Tools"
        className="pointer-events-auto flex items-center gap-1 rounded-2xl border border-white/8 bg-ink-850/90 p-1.5 shadow-[0_12px_32px_-6px_rgb(0_0_0/0.6),0_2px_8px_rgb(0_0_0/0.35),inset_0_1px_0_rgb(255_255_255/0.05)] backdrop-blur-xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        {GROUPS.map((group, i) => (
          <div key={group.name} className="flex items-center gap-1">
            {i === 1 && <div className="mx-0.5 h-5 w-px bg-white/10" />}
            <DockGroup group={group} tool={tool} setTool={setTool} />
          </div>
        ))}
      </div>
    </div>
  );
}
