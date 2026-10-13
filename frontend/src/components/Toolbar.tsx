import {
  ChevronDown,
  Minus,
  Play,
  Plus,
  Redo2,
  Square,
  Undo2,
  X,
} from "lucide-react";
import { useCallback, useState } from "react";
import {
  alignSelection,
  copySelection,
  cutSelection,
  deleteSelection,
  distributeSelection,
  duplicateSelection,
  addAutoLayoutSelection,
  groupSelection,
  paste,
  reorderSelection,
  selectAll,
  toggleLockSelection,
  toggleVisibleSelection,
  ungroupSelection,
  zoomIn,
  zoomOut,
  zoomTo,
  zoomToFit,
} from "../editor/actions";
import { placeImageFromPicker } from "../editor/images";
import { importFigmaFromPicker } from "../figma/importFigma";
import { presentationSlides, slideOfSelection, startPresenting } from "../editor/present";
import { currentPage, currentViewport, isDirty, useEditor } from "../editor/store";
import { IconSidebarRight } from "../icons/icons";
import { newProject, openProject, openRecentProject, renameProject, saveProject, saveProjectAs } from "../storage/fileActions";
import { platform } from "../storage/platform";
import { loadRecent } from "../storage/recent";
import { openExportDialog } from "./openExportDialog";
import { IconButton, MenuList, useDismiss, type MenuEntry } from "./ui";

const Divider = () => <div className="mx-1.5 h-4 w-px shrink-0 bg-ink-700" />;

function Menu({ label, items, align = "left", ariaLabel }: { label: React.ReactNode; items: () => MenuEntry[]; align?: "left" | "right"; ariaLabel?: string }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        aria-label={ariaLabel}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className={`flex h-7 items-center rounded-md px-2 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100 ${open ? "bg-ink-700 text-ink-100" : "text-ink-300"}`}
      >
        {label}
      </button>
      {open && (
        <div className={`absolute top-9 z-50 ${align === "right" ? "right-0" : "left-0"}`}>
          <MenuList items={items()} onClose={close} />
        </div>
      )}
    </div>
  );
}

function fileMenu(): MenuEntry[] {
  const items: MenuEntry[] = [
    { label: "New project", shortcut: "Mod+N", action: () => void newProject() },
    { label: "Open…", shortcut: "Mod+O", action: () => void openProject() },
    "separator",
    { label: "Place image…", shortcut: "Mod+Shift+K", action: () => void placeImageFromPicker() },
    { label: "Import Figma file…", action: importFigmaFromPicker },
    "separator",
    { label: "Save", shortcut: "Mod+S", action: () => void saveProject() },
    { label: "Save as…", shortcut: "Mod+Shift+S", action: () => void saveProjectAs() },
    "separator",
    { label: "Export…", shortcut: "Mod+Shift+E", action: openExportDialog },
  ];
  const recent = platform.kind === "desktop" ? loadRecent() : [];
  if (recent.length > 0) {
    items.push("separator", { heading: "Recent projects" });
    for (const r of recent) items.push({ label: r.name, action: () => void openRecentProject(r.path) });
  }
  return items;
}

function editMenu(): MenuEntry[] {
  const s = useEditor.getState();
  const none = s.selection.length === 0;
  return [
    { label: "Undo", shortcut: "Mod+Z", action: s.undo, disabled: s.history.past.length === 0 && !s.transaction },
    { label: "Redo", shortcut: "Mod+Shift+Z", action: s.redo, disabled: s.history.future.length === 0 },
    "separator",
    { label: "Cut", shortcut: "Mod+X", action: cutSelection, disabled: none },
    { label: "Copy", shortcut: "Mod+C", action: () => void copySelection(), disabled: none },
    { label: "Paste", shortcut: "Mod+V", action: paste },
    { label: "Duplicate", shortcut: "Mod+D", action: duplicateSelection, disabled: none },
    { label: "Delete", shortcut: "⌫", action: deleteSelection, disabled: none },
    "separator",
    { label: "Select all", shortcut: "Mod+A", action: selectAll },
  ];
}

function viewMenu(): MenuEntry[] {
  const s = useEditor.getState();
  return [
    { label: "Zoom in", shortcut: "Mod++", action: zoomIn },
    { label: "Zoom out", shortcut: "Mod+-", action: zoomOut },
    { label: "Zoom to 100%", shortcut: "Mod+0", action: () => zoomTo(1) },
    { label: "Zoom to fit", shortcut: "Shift+1", action: zoomToFit },
    "separator",
    { label: "Left sidebar", shortcut: "Mod+\\", checked: s.showLeftSidebar, action: () => useEditor.setState({ showLeftSidebar: !s.showLeftSidebar }) },
    "separator",
    { label: "Grid", shortcut: "Mod+'", checked: s.showGrid, action: () => useEditor.setState({ showGrid: !s.showGrid }) },
    { label: "Snapping", checked: s.snapEnabled, action: () => useEditor.setState({ snapEnabled: !s.snapEnabled }) },
  ];
}

function objectMenu(): MenuEntry[] {
  const count = useEditor.getState().selection.length;
  const none = count === 0;
  return [
    { label: "Group", shortcut: "Mod+G", action: groupSelection, disabled: none },
    { label: "Ungroup", shortcut: "Mod+Shift+G", action: ungroupSelection, disabled: none },
    { label: "Add auto layout", shortcut: "Shift+A", action: addAutoLayoutSelection, disabled: none },
    "separator",
    { label: "Bring to front", shortcut: "]", action: () => reorderSelection("front"), disabled: none },
    { label: "Bring forward", shortcut: "Mod+]", action: () => reorderSelection("forward"), disabled: none },
    { label: "Send backward", shortcut: "Mod+[", action: () => reorderSelection("backward"), disabled: none },
    { label: "Send to back", shortcut: "[", action: () => reorderSelection("back"), disabled: none },
    "separator",
    { label: "Align left", action: () => alignSelection("left"), disabled: none },
    { label: "Align horizontal centres", action: () => alignSelection("center"), disabled: none },
    { label: "Align right", action: () => alignSelection("right"), disabled: none },
    { label: "Align top", action: () => alignSelection("top"), disabled: none },
    { label: "Align vertical centres", action: () => alignSelection("middle"), disabled: none },
    { label: "Align bottom", action: () => alignSelection("bottom"), disabled: none },
    { label: "Distribute horizontally", action: () => distributeSelection("horizontal"), disabled: count < 3 },
    { label: "Distribute vertically", action: () => distributeSelection("vertical"), disabled: count < 3 },
    "separator",
    { label: "Lock / unlock", shortcut: "Mod+Shift+L", action: toggleLockSelection, disabled: none },
    { label: "Hide / show", shortcut: "Mod+Shift+H", action: toggleVisibleSelection, disabled: none },
  ];
}

/** The project name; click it to rename the project (and its file, once saved). */
function ProjectName({ name }: { name: string }) {
  const [editing, setEditing] = useState(false);
  if (!editing) {
    return (
      <button
        type="button"
        data-tip="Rename project"
        onClick={() => setEditing(true)}
        data-testid="project-name"
        className="-mx-1.5 h-7 min-w-0 truncate rounded-md px-1.5 text-[12.5px] font-semibold text-ink-100 transition-colors duration-100 hover:bg-ink-700"
      >
        {name}
      </button>
    );
  }
  const finish = (value: string | null) => {
    setEditing(false);
    if (value !== null && value.trim() !== "") void renameProject(value);
  };
  return (
    <input
      autoFocus
      aria-label="Project name"
      defaultValue={name}
      size={Math.max(8, name.length + 2)}
      onFocus={(e) => e.target.select()}
      onBlur={(e) => finish(e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") e.currentTarget.blur();
        if (e.key === "Escape") finish(null);
      }}
      className="h-7 max-w-64 rounded-md border border-accent bg-ink-950 px-1.5 text-[12.5px] font-semibold text-ink-100 outline-none"
    />
  );
}

function StatusPill({ tone, children }: { tone: string; children: React.ReactNode }) {
  return (
    <span className="flex items-center gap-1.5 text-ink-400">
      <span className={`h-1.5 w-1.5 rounded-full ${tone}`} />
      {children}
    </span>
  );
}

function SaveStatus() {
  const dirty = useEditor(isDirty);
  const status = useEditor((s) => s.saveStatus);
  const error = useEditor((s) => s.saveError);
  const hasFile = useEditor((s) => s.filePath !== null);

  if (status === "saving") return <StatusPill tone="animate-pulse bg-accent">Saving…</StatusPill>;
  if (status === "error") {
    return (
      <button
        type="button"
        data-tip={error ?? undefined}
        onClick={() => void saveProject()}
        className="flex h-6 items-center gap-1.5 rounded-md bg-red-500/15 px-2 font-medium text-red-300 hover:bg-red-500/25"
      >
        <span className="h-1.5 w-1.5 rounded-full bg-red-400" />
        Save failed — retry
      </button>
    );
  }
  if (dirty) return <StatusPill tone="bg-amber-400">Unsaved changes</StatusPill>;
  return <StatusPill tone={hasFile ? "bg-emerald-400" : "bg-ink-600"}>{hasFile ? "Saved" : "Not saved yet"}</StatusPill>;
}

/** The desktop window is frameless, so the toolbar supplies minimise, maximise and close. */
function WindowControls() {
  const base = "flex h-12 w-11 items-center justify-center text-ink-300 transition-colors";
  return (
    <div className="-mr-2.5 ml-2 flex self-stretch">
      <button type="button" aria-label="Minimize window" className={`${base} hover:bg-white/8 hover:text-ink-100`} onClick={() => platform.minimizeWindow()}>
        <Minus size={15} strokeWidth={1.5} />
      </button>
      <button type="button" aria-label="Maximize window" className={`${base} hover:bg-white/8 hover:text-ink-100`} onClick={() => platform.toggleMaximizeWindow()}>
        <Square size={11} strokeWidth={1.75} />
      </button>
      <button type="button" aria-label="Close window" className={`${base} hover:bg-red-600 hover:text-white`} onClick={() => platform.closeWindow()}>
        <X size={16} strokeWidth={1.5} />
      </button>
    </div>
  );
}

export function Toolbar() {
  const name = useEditor((s) => s.doc.name);
  const zoom = useEditor((s) => currentViewport(s).zoom);
  const canUndo = useEditor((s) => s.history.past.length > 0);
  const canRedo = useEditor((s) => s.history.future.length > 0);
  const undo = useEditor((s) => s.undo);
  const redo = useEditor((s) => s.redo);
  const showLeft = useEditor((s) => s.showLeftSidebar);

  return (
    <header
      data-tauri-drag-region
      className="relative z-40 flex h-12 shrink-0 items-center border-b border-black/40 bg-ink-900 pl-2.5 pr-2.5 shadow-[0_1px_0_rgb(255_255_255/0.03)]"
    >
      <div data-tauri-drag-region className="flex flex-1 items-center gap-0.5">
        <img src="/drafiqo.svg" alt="Drafiqo" className="mr-2 h-7 w-7 rounded-md" />
        <Menu label="File" items={fileMenu} />
        <Menu label="Edit" items={editMenu} />
        <Menu label="View" items={viewMenu} />
        <Menu label="Object" items={objectMenu} />
        {!showLeft && (
          <IconButton label="Show sidebar" shortcut={"Mod+\\"} onClick={() => useEditor.setState({ showLeftSidebar: true })}>
            <IconSidebarRight size={18} />
          </IconButton>
        )}
      </div>

      <div data-tauri-drag-region className="flex min-w-0 items-center justify-center gap-2.5 px-4">
        <ProjectName name={name} />
        <span className="h-3 w-px shrink-0 bg-ink-700" />
        <span className="shrink-0" data-testid="save-status">
          <SaveStatus />
        </span>
      </div>

      <div data-tauri-drag-region className="flex flex-1 items-center justify-end gap-0.5">
        <IconButton label="Undo" shortcut="Mod+Z" disabled={!canUndo} onClick={undo}>
          <Undo2 size={15} strokeWidth={1.75} />
        </IconButton>
        <IconButton label="Redo" shortcut="Mod+Shift+Z" disabled={!canRedo} onClick={redo}>
          <Redo2 size={15} strokeWidth={1.75} />
        </IconButton>
        <Divider />
        <div className="flex items-center rounded-lg bg-ink-850 p-0.5 ring-1 ring-white/5">
          <IconButton label="Zoom out" shortcut="Mod+-" onClick={zoomOut}>
            <Minus size={14} strokeWidth={1.75} />
          </IconButton>
          <Menu
            align="right"
            label={
              <span data-tip="Zoom options" className="flex w-14 items-center justify-center gap-1 tabular-nums">
                <span data-testid="zoom-level">{Math.round(zoom * 100)}%</span>
                <ChevronDown size={11} className="text-ink-400" />
              </span>
            }
            items={() => [
              { label: "Zoom in", shortcut: "Mod++", action: zoomIn },
              { label: "Zoom out", shortcut: "Mod+-", action: zoomOut },
              { label: "Zoom to fit", shortcut: "Shift+1", action: zoomToFit },
              "separator",
              { label: "50%", action: () => zoomTo(0.5) },
              { label: "100%", shortcut: "Mod+0", action: () => zoomTo(1) },
              { label: "200%", action: () => zoomTo(2) },
            ]}
          />
          <IconButton label="Zoom in" shortcut="Mod++" onClick={zoomIn}>
            <Plus size={14} strokeWidth={1.75} />
          </IconButton>
        </div>
        <Divider />
        <div className="flex items-center rounded-lg bg-ink-850 p-0.5 ring-1 ring-white/5">
          <IconButton label="Present" shortcut="Mod+Alt+Enter" onClick={() => startPresenting("selection")}>
            <Play size={14} strokeWidth={1.75} />
          </IconButton>
          <Menu
            align="right"
            ariaLabel="Presentation options"
            label={<ChevronDown size={11} className="text-ink-400" />}
            items={() => {
              const s = useEditor.getState();
              const page = currentPage(s);
              const onFrame = slideOfSelection(page, presentationSlides(page), s.selection) !== null;
              return [
                { label: "Present from selected frame", shortcut: "Mod+Alt+Enter", disabled: !onFrame, action: () => startPresenting("selection") },
                { label: "Present from start", action: () => startPresenting("start") },
              ];
            }}
          />
        </div>
      </div>
      {platform.kind === "desktop" && <WindowControls />}
    </header>
  );
}
