import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  ArrowDown,
  ArrowRight,
  Blend,
  ChevronDown,
  Eye,
  EyeOff,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Pin,
  Plus,
  RotateCw,
  Ruler,
  Scaling,
  Scan,
  Expand,
  WrapText,
  X,
} from "lucide-react";
import { useCallback, useMemo, useState } from "react";
import { ensureFont } from "../fonts/fontLibrary";
import { FontPicker } from "./FontPicker";
import { convertEffect } from "../document/effects";
import { dropShadow, innerShadow, layerBlur, solidPaint } from "../document/factory";
import { getPage, topLevelSelection } from "../document/tree";
import { getAsset } from "../document/assets";
import type { AutoLayout, LayoutItem, LayoutSizing, CornerRadii, Effect, EffectType, ImagePaint, ImageScaleMode, LayerBlurEffect, NodeId, Paint, SceneNode, ShadowEffect, SolidPaint, StrokeCap, StrokeJoin, TextAlign, TextAutoResize } from "../document/types";
import { FRAME_PRESETS, addAutoLayoutSelection, alignSelection, distributeSelection, insertFramePreset } from "../editor/actions";
import { patchNodes, resizeNode, scaleNode, setAutoLayout, setLayoutItem, type NodePatch } from "../editor/commands";
import { chooseImageForFill } from "../editor/images";
import { currentPage, useEditor } from "../editor/store";
import { openExportDialog } from "./openExportDialog";
import { ColorField, IconButton, MenuList, NumberField, Section, Select, shared, useDismiss, type Mixed } from "./ui";

const FONT_WEIGHTS = [
  { value: 300, label: "Light" },
  { value: 400, label: "Regular" },
  { value: 500, label: "Medium" },
  { value: 600, label: "Semibold" },
  { value: 700, label: "Bold" },
  { value: 900, label: "Black" },
];

const edit = (ids: readonly NodeId[], patch: NodePatch | ((node: SceneNode) => NodePatch)) =>
  useEditor.getState().edit((page) => patchNodes(page, ids, patch));

/** Reads a property that only some node types have. */
function prop<K extends string>(node: SceneNode, key: K): unknown {
  return (node as unknown as Record<string, unknown>)[key];
}

function sharedProp<V>(nodes: SceneNode[], key: string): V | Mixed {
  return shared(nodes, (n) => prop(n, key)) as V | Mixed;
}

function AlignRow({ count }: { count: number }) {
  return (
    <div className="flex items-center justify-between border-b border-ink-700 px-2.5 py-1.5">
      <IconButton label="Align left" onClick={() => alignSelection("left")}>
        <AlignStartVertical size={14} />
      </IconButton>
      <IconButton label="Align horizontal centres" onClick={() => alignSelection("center")}>
        <AlignCenterVertical size={14} />
      </IconButton>
      <IconButton label="Align right" onClick={() => alignSelection("right")}>
        <AlignEndVertical size={14} />
      </IconButton>
      <IconButton label="Align top" onClick={() => alignSelection("top")}>
        <AlignStartHorizontal size={14} />
      </IconButton>
      <IconButton label="Align vertical centres" onClick={() => alignSelection("middle")}>
        <AlignCenterHorizontal size={14} />
      </IconButton>
      <IconButton label="Align bottom" onClick={() => alignSelection("bottom")}>
        <AlignEndHorizontal size={14} />
      </IconButton>
      <IconButton label="Distribute horizontally" disabled={count < 3} onClick={() => distributeSelection("horizontal")}>
        <AlignHorizontalSpaceAround size={14} />
      </IconButton>
      <IconButton label="Distribute vertically" disabled={count < 3} onClick={() => distributeSelection("vertical")}>
        <AlignVerticalSpaceAround size={14} />
      </IconButton>
    </div>
  );
}

const CORNERS = [
  { index: 0, label: "TL" },
  { index: 1, label: "TR" },
  { index: 3, label: "BL" },
  { index: 2, label: "BR" },
];
const CORNER_NAMES = ["Top-left", "Top-right", "Bottom-right", "Bottom-left"];

/** A frame's or rectangle's four corner radii. */
const radii = (node: SceneNode): CornerRadii => (prop(node, "cornerRadii") as CornerRadii | undefined) ?? [0, 0, 0, 0];

/** The one radius all corners of all selected layers share, or "mixed". */
const mixedRadius = (nodes: SceneNode[]): number | Mixed => shared(nodes.flatMap((n) => radii(n)), (r) => r);

function Geometry({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const resize = (width: number | null, height: number | null) =>
    useEditor.getState().edit((page) =>
      ids.reduce((p, id) => {
        const n = p.nodes[id];
        return n ? resizeNode(p, id, width ?? n.width, height ?? n.height) : p;
      }, page),
    );
  const [perCorner, setPerCorner] = useState(false);
  const hasRadius = nodes.every((n) => n.type === "rectangle" || n.type === "frame");
  const onlyLines = nodes.every((n) => n.type === "line");
  return (
    <Section title="Layout">
      <div className="grid grid-cols-2 gap-2">
        <NumberField label="X" title="X position" value={shared(nodes, (n) => n.x)} onChange={(x) => edit(ids, { x })} />
        <NumberField label="Y" title="Y position" value={shared(nodes, (n) => n.y)} onChange={(y) => edit(ids, { y })} />
        <NumberField label="W" title="Width" min={1} value={shared(nodes, (n) => n.width)} onChange={(w) => resize(w, null)} />
        {!onlyLines && <NumberField label="H" title="Height" min={1} value={shared(nodes, (n) => n.height)} onChange={(h) => resize(null, h)} />}
        <NumberField label={<RotateCw size={11} />} title="Rotation" suffix="°" min={-180} max={180} value={shared(nodes, (n) => n.rotation)} onChange={(rotation) => edit(ids, { rotation })} />
        <NumberField
          label={<Blend size={11} />}
          title="Opacity"
          suffix="%"
          min={0}
          max={100}
          value={mapValue(shared(nodes, (n) => n.opacity), (o) => Math.round(o * 100))}
          onChange={(o) => edit(ids, { opacity: o / 100 })}
        />
        {hasRadius && (
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <NumberField
                label={<Scan size={11} />}
                title="Corner radius"
                min={0}
                value={mixedRadius(nodes)}
                onChange={(r) => edit(ids, { cornerRadii: [r, r, r, r] })}
              />
            </div>
            <IconButton label="Independent corners" active={perCorner} onClick={() => setPerCorner(!perCorner)}>
              <Expand size={14} />
            </IconButton>
          </div>
        )}
        {hasRadius && perCorner &&
          CORNERS.map(({ index, label }) => (
            <NumberField
              key={index}
              label={<span className="text-[9px] font-medium">{label}</span>}
              title={`${CORNER_NAMES[index]} corner radius`}
              min={0}
              value={shared(nodes, (n) => radii(n)[index] ?? 0)}
              onChange={(r) => edit(ids, (n) => ({ cornerRadii: radii(n).map((v, i) => (i === index ? r : v)) as CornerRadii }))}
            />
          ))}
      </div>
    </Section>
  );
}

const ANCHORS = [0, 0.5, 1].flatMap((y) => [0, 0.5, 1].map((x) => ({ x, y })));
const ANCHOR_NAMES = { x: ["left", "centre", "right"], y: ["Top", "Middle", "Bottom"] };

/** A 3×3 picker of a spot in a box: the scale anchor, or where auto layout children sit. */
function DotGrid({ label, value, onChange }: { label: string; value: { x: number | null; y: number | null }; onChange: (spot: { x: number; y: number }) => void }) {
  return (
    <div role="radiogroup" aria-label={label} className="grid grid-cols-3 place-items-center gap-y-1 rounded-md bg-ink-800 px-2 py-2">
      {ANCHORS.map(({ x, y }) => {
        // An axis without a choice of its own (null) lights up the whole row or column.
        const active = (value.x === null || value.x === x) && (value.y === null || value.y === y);
        const name = `${ANCHOR_NAMES.y[y * 2]} ${ANCHOR_NAMES.x[x * 2]}`.toLowerCase();
        return (
          <button
            key={name}
            type="button"
            role="radio"
            aria-checked={active}
            aria-label={`${label} ${name}`}
            data-tip={`${label} ${name}`}
            onClick={() => onChange({ x, y })}
            className="group/anchor flex h-4 w-4 items-center justify-center"
          >
            <span className={`transition-colors duration-100 ${active ? "h-2.5 w-2.5 rounded-[2px] bg-accent" : "h-1 w-1 rounded-full bg-ink-400 group-hover/anchor:bg-ink-100"}`} />
          </button>
        );
      })}
    </div>
  );
}

const ALIGN_STEPS = ["start", "center", "end"] as const;
type Sizing = LayoutSizing | "fill";
type Side = "Top" | "Right" | "Bottom" | "Left";
const SIDES: Side[] = ["Top", "Right", "Bottom", "Left"];
const LIMITS = [
  { key: "minWidth", label: "MIN W", title: "Minimum width" },
  { key: "maxWidth", label: "MAX W", title: "Maximum width" },
  { key: "minHeight", label: "MIN H", title: "Minimum height" },
  { key: "maxHeight", label: "MAX H", title: "Maximum height" },
] as const;

const tiny = (text: string) => <span className="text-[9px] font-medium">{text}</span>;
const setItem = (ids: readonly NodeId[], patch: LayoutItem) => useEditor.getState().edit((page) => setLayoutItem(page, ids, patch));

/**
 * How the selection is sized by auto layout: hugging its own children, filling
 * its parent or keeping a fixed size; out of the flow or in it; and the limits
 * on a size the layout decides. Renders cells for a two-column grid.
 */
function Resizing({ nodes, ids, inAuto }: { nodes: SceneNode[]; ids: NodeId[]; inAuto: boolean }) {
  const [limits, setLimits] = useState(() => nodes.some((n) => LIMITS.some(({ key }) => n.layoutItem?.[key] !== undefined)));
  const canHug = nodes.every((n) => n.type === "frame" && n.layout);
  const absolute = shared(nodes, (n) => n.layoutItem?.absolute === true);
  const sizing = (axis: "Width" | "Height") => {
    const value = shared(nodes, (n): Sizing => {
      if (inAuto && n.layoutItem?.[`fill${axis}`]) return "fill";
      return n.type === "frame" && n.layout ? n.layout[axis === "Width" ? "widthSizing" : "heightSizing"] : "fixed";
    });
    const letter = axis[0];
    const options: { value: Sizing; label: string }[] = [
      { value: "fixed", label: `${letter}: Fixed` },
      ...(canHug ? [{ value: "hug" as const, label: `${letter}: Hug` }] : []),
      ...(inAuto && absolute !== true ? [{ value: "fill" as const, label: `${letter}: Fill` }] : []),
    ];
    const onChange = (next: Sizing) =>
      useEditor.getState().edit((page) => {
        const filled = setLayoutItem(page, ids, { [`fill${axis}`]: next === "fill" });
        return next === "fill" ? filled : setAutoLayout(filled, ids, { [axis === "Width" ? "widthSizing" : "heightSizing"]: next });
      });
    return <Select<Sizing> label={`${axis} sizing`} value={value} options={options} onChange={onChange} />;
  };
  return (
    <>
      {sizing("Width")}
      {sizing("Height")}
      <div className="col-span-2 flex items-center gap-1">
        {inAuto && (
          <IconButton label="Absolute position" active={absolute === true} onClick={() => setItem(ids, { absolute: absolute !== true })}>
            <Pin size={14} />
          </IconButton>
        )}
        <IconButton label="Size limits" active={limits} onClick={() => setLimits(!limits)}>
          <Ruler size={14} />
        </IconButton>
      </div>
      {limits &&
        LIMITS.map(({ key, label, title }) => (
          <NumberField
            key={key}
            label={tiny(label)}
            title={title}
            min={0}
            placeholder="None"
            value={shared(nodes, (n) => n.layoutItem?.[key])}
            onChange={(v) => setItem(ids, { [key]: v })}
            onClear={() => setItem(ids, { [key]: undefined })}
          />
        ))}
    </>
  );
}

/** Auto layout: any selection can be given one; frames that have it show its settings. */
function AutoLayoutSection({ nodes, ids, inAuto }: { nodes: SceneNode[]; ids: NodeId[]; inAuto: boolean }) {
  const layouts = nodes.map((n) => (n.type === "frame" ? n.layout : undefined));
  const active = layouts.every((l): l is AutoLayout => l !== undefined);
  const set = (patch: Partial<AutoLayout> | null) => useEditor.getState().edit((page) => setAutoLayout(page, ids, patch));
  const [perSide, setPerSide] = useState(false);
  if (!active) {
    return (
      <>
        <Section
          title="Auto layout"
          action={
            <IconButton label="Add auto layout" shortcut="Shift+A" onClick={addAutoLayoutSelection}>
              <Plus size={14} strokeWidth={1.75} />
            </IconButton>
          }
        />
        {inAuto && (
          <Section title="Resizing">
            <div className="grid grid-cols-2 gap-2">
              <Resizing nodes={nodes} ids={ids} inAuto />
            </div>
          </Section>
        )}
      </>
    );
  }
  const value = <K extends keyof AutoLayout>(key: K) => shared(layouts, (l) => l[key]) as AutoLayout[K] | Mixed;
  const mode = value("mode");
  const primary = value("primaryAlign");
  const counter = value("counterAlign");
  const wrap = value("wrap");
  const horizontal = mode !== "vertical";
  const step = (align: string | Mixed) => (align === "mixed" ? -1 : align === "space-between" ? null : ALIGN_STEPS.indexOf(align as (typeof ALIGN_STEPS)[number]) / 2);
  const along = step(primary);
  const across = step(counter);
  /** One number for two opposite sides, or "mixed" when they differ. */
  const pair = (a: Side, b: Side) => shared(layouts.flatMap((l) => [l[`padding${a}`], l[`padding${b}`]]), (v) => v);
  return (
    <Section
      title="Auto layout"
      action={
        <IconButton label="Remove auto layout" onClick={() => set(null)}>
          <Minus size={14} strokeWidth={1.75} />
        </IconButton>
      }
    >
      <div className="grid grid-cols-2 gap-2">
        <div className="flex items-center gap-1">
          <IconButton label="Horizontal layout" active={mode === "horizontal"} onClick={() => set({ mode: "horizontal" })}>
            <ArrowRight size={14} />
          </IconButton>
          <IconButton label="Vertical layout" active={mode === "vertical"} onClick={() => set({ mode: "vertical" })}>
            <ArrowDown size={14} />
          </IconButton>
          <IconButton label="Wrap" active={wrap === true} onClick={() => set({ wrap: wrap !== true })}>
            <WrapText size={14} />
          </IconButton>
        </div>
        <Select<"packed" | "space-between">
          label="Spacing mode"
          value={primary === "mixed" ? "mixed" : primary === "space-between" ? "space-between" : "packed"}
          options={[
            { value: "packed", label: "Packed" },
            { value: "space-between", label: "Space between" },
          ]}
          onChange={(spacing) => set({ primaryAlign: spacing === "packed" ? "start" : "space-between" })}
        />
        <div className="flex flex-col gap-2">
          <NumberField label={horizontal ? <MoveHorizontal size={11} /> : <MoveVertical size={11} />} title="Gap" value={value("gap")} onChange={(gap) => set({ gap })} />
          <NumberField label={tiny("PX")} title="Horizontal padding" min={0} value={pair("Left", "Right")} onChange={(v) => set({ paddingLeft: v, paddingRight: v })} />
          <div className="flex items-center gap-1">
            <div className="min-w-0 flex-1">
              <NumberField label={tiny("PY")} title="Vertical padding" min={0} value={pair("Top", "Bottom")} onChange={(v) => set({ paddingTop: v, paddingBottom: v })} />
            </div>
            <IconButton label="Independent padding" active={perSide} onClick={() => setPerSide(!perSide)}>
              <Expand size={14} />
            </IconButton>
          </div>
        </div>
        <div className="self-start">
          <DotGrid
            label="Align"
            value={horizontal ? { x: along, y: across } : { x: across, y: along }}
            onChange={({ x, y }) => {
              const pick = (v: number) => ALIGN_STEPS[v * 2]!;
              // Children spaced between keep that; the grid then only moves them across.
              set({ counterAlign: pick(horizontal ? y : x), ...(primary === "space-between" ? {} : { primaryAlign: pick(horizontal ? x : y) }) });
            }}
          />
        </div>
        {perSide &&
          SIDES.map((side) => (
            <NumberField key={side} label={tiny(`P${side[0]}`)} title={`${side} padding`} min={0} value={value(`padding${side}`)} onChange={(v) => set({ [`padding${side}`]: v })} />
          ))}
        <Resizing nodes={nodes} ids={ids} inAuto={inAuto} />
      </div>
    </Section>
  );
}

const SCALE_PRESETS = [0.25, 0.5, 0.75, 1, 1.5, 2, 3, 4];

/** The side a layer's scale is measured along: its width, or its height when it has none. */
const scaleSide = (node: SceneNode) => (node.width > 0 ? node.width : node.height);

/** Replaces the top of the panel while the scale tool is active: enlarges or shrinks whole layers, strokes, effects and type included. */
function ScalePanel({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const [anchor, setAnchor] = useState({ x: 0, y: 0 });
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  // The factor reads 1x for the sizes the layers had when they were picked up with the tool.
  const key = ids.join(",");
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const base = useMemo(() => new Map(nodes.map((n) => [n.id, scaleSide(n)])), [key]);
  const factorOf = (n: SceneNode) => {
    const start = base.get(n.id);
    return start ? Math.round((scaleSide(n) / start) * 100) / 100 : 1;
  };
  /** Scales each layer by its own factor, so setting a size or a factor twice changes nothing more. */
  const scaleBy = (factor: (node: SceneNode) => number) =>
    useEditor.getState().edit((page) =>
      topLevelSelection(page, ids).reduce((p, id) => {
        const n = p.nodes[id];
        return n ? scaleNode(p, id, factor(n), anchor.x, anchor.y) : p;
      }, page),
    );
  const setFactor = (target: number) => scaleBy((n) => (target * (base.get(n.id) ?? scaleSide(n))) / scaleSide(n));
  const onlyLines = nodes.every((n) => n.type === "line");

  return (
    <Section
      title="Scale"
      action={
        <IconButton label="Close scale" onClick={() => useEditor.getState().setTool("select")}>
          <X size={14} />
        </IconButton>
      }
    >
      {nodes.length === 0 ? (
        <p className="text-ink-400">Select a layer, then drag a handle to scale it.</p>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="W" title="Scale width" min={0.01} value={shared(nodes, (n) => n.width)} onChange={(w) => scaleBy((n) => (n.width > 0 ? w / n.width : 1))} />
          {onlyLines ? <span /> : <NumberField label="H" title="Scale height" min={0.01} value={shared(nodes, (n) => n.height)} onChange={(h) => scaleBy((n) => (n.height > 0 ? h / n.height : 1))} />}
          <div ref={ref} className="relative flex items-start gap-1">
            <div className="min-w-0 flex-1">
              <NumberField label={<Scaling size={11} />} title="Scale factor" suffix="x" min={0.01} max={100} step={0.1} value={shared(nodes, factorOf)} onChange={setFactor} />
            </div>
            <button
              type="button"
              aria-label="Scale presets"
              data-tip="Scale presets"
              aria-haspopup="menu"
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
              className="flex h-7 w-6 shrink-0 items-center justify-center rounded-md bg-ink-800 text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100"
            >
              <ChevronDown size={12} strokeWidth={2} />
            </button>
            {open && (
              <div className="absolute top-full left-0 z-30 mt-1">
                <MenuList onClose={close} items={SCALE_PRESETS.map((preset) => ({ label: `${preset}x`, action: () => setFactor(preset) }))} />
              </div>
            )}
          </div>
          <DotGrid label="Scale from" value={anchor} onChange={setAnchor} />
        </div>
      )}
    </Section>
  );
}

function mapValue<A, B>(value: A | Mixed, fn: (v: A) => B): B | Mixed {
  return value === "mixed" ? "mixed" : fn(value as A);
}

function TypeSpecific({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const type = shared(nodes, (n) => n.type);
  if (type === "frame") {
    const clip = sharedProp<boolean>(nodes, "clipContent");
    return (
      <Section title="Frame">
        <label className="flex h-7 items-center gap-2 text-ink-100">
          <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={clip === true} onChange={(e) => edit(ids, { clipContent: e.target.checked })} />
          Clip content
        </label>
      </Section>
    );
  }
  if (type === "polygon") {
    return (
      <Section title="Polygon">
        <NumberField label="Sides" title="Sides" min={3} max={60} value={sharedProp<number>(nodes, "sides")} onChange={(v) => edit(ids, { sides: Math.round(v) })} />
      </Section>
    );
  }
  if (type === "star") {
    return (
      <Section title="Star">
        <div className="grid grid-cols-2 gap-2">
          <NumberField label="Points" title="Points" min={3} max={60} value={sharedProp<number>(nodes, "pointCount")} onChange={(v) => edit(ids, { pointCount: Math.round(v) })} />
          <NumberField
            label="Ratio"
            title="Inner radius"
            suffix="%"
            min={1}
            max={100}
            value={mapValue(sharedProp<number>(nodes, "innerRatio"), (r) => Math.round(r * 100))}
            onChange={(v) => edit(ids, { innerRatio: v / 100 })}
          />
        </div>
      </Section>
    );
  }
  if (type === "text") return <TextSection nodes={nodes} ids={ids} />;
  return null;
}

function TextSection({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const text = sharedProp<string>(nodes, "text");
  /** A face is fetched before it is applied, so the text is measured with the real letters. */
  const setFace = async (patch: { fontFamily?: string; fontWeight?: number }) => {
    const faces = nodes.flatMap((n) => (n.type === "text" ? [[patch.fontFamily ?? n.fontFamily, patch.fontWeight ?? n.fontWeight] as const] : []));
    await Promise.all(faces.map(([family, weight]) => ensureFont(family, [weight])));
    edit(ids, patch);
  };
  return (
    <Section title="Text">
      {nodes.length === 1 && text !== "mixed" && (
        <textarea
          aria-label="Text content"
          rows={3}
          className="w-full resize-y rounded-md border border-transparent bg-ink-800 px-2 py-1.5 leading-normal text-ink-100 transition-colors duration-100 outline-none hover:border-ink-600 focus:border-accent focus:bg-ink-950"
          value={text}
          onFocus={() => useEditor.getState().begin()}
          onChange={(e) => edit(ids, { text: e.target.value })}
          onBlur={() => useEditor.getState().commit()}
        />
      )}
      <FontPicker value={sharedProp<string>(nodes, "fontFamily")} onChange={(fontFamily) => void setFace({ fontFamily })} />
      <div className="grid grid-cols-2 gap-2">
        <Select label="Font weight" value={sharedProp<number>(nodes, "fontWeight")} options={FONT_WEIGHTS} onChange={(fontWeight) => void setFace({ fontWeight })} />
        <NumberField label="Size" title="Font size" min={1} max={2000} value={sharedProp<number>(nodes, "fontSize")} onChange={(fontSize) => edit(ids, { fontSize })} />
        <NumberField
          label={<MoveVertical size={11} />}
          title="Line height"
          suffix="%"
          min={50}
          max={500}
          value={mapValue(sharedProp<number>(nodes, "lineHeight"), (l) => Math.round(l * 100))}
          onChange={(v) => edit(ids, { lineHeight: v / 100 })}
        />
        <NumberField label={<MoveHorizontal size={11} />} title="Letter spacing" step={0.5} value={sharedProp<number>(nodes, "letterSpacing")} onChange={(letterSpacing) => edit(ids, { letterSpacing })} />
        <Select<TextAlign>
          label="Text alignment"
          value={sharedProp<TextAlign>(nodes, "textAlign")}
          options={[
            { value: "left", label: "Align left" },
            { value: "center", label: "Align centre" },
            { value: "right", label: "Align right" },
          ]}
          onChange={(textAlign) => edit(ids, { textAlign })}
        />
        <Select<TextAutoResize>
          label="Text box sizing"
          value={sharedProp<TextAutoResize>(nodes, "autoResize")}
          options={[
            { value: "auto", label: "Auto width" },
            { value: "height", label: "Auto height" },
            { value: "fixed", label: "Fixed size" },
          ]}
          onChange={(autoResize) => edit(ids, { autoResize })}
        />
      </div>
    </Section>
  );
}

const SCALE_MODES: { value: ImageScaleMode; label: string }[] = [
  { value: "fill", label: "Fill" },
  { value: "fit", label: "Fit" },
  { value: "stretch", label: "Stretch" },
];

/** A fill that is a picture: its thumbnail replaces it on click, and a mode says how it sits in the shape. */
function ImageFillRow({ paint, ids, update, remove }: { paint: ImagePaint; ids: NodeId[]; update: (patch: Partial<ImagePaint>) => void; remove: () => void }) {
  const asset = getAsset(paint.assetId);
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-1.5">
        <button
          type="button"
          aria-label="Replace image"
          data-tip="Replace image"
          onClick={() => void chooseImageForFill(ids, paint.id)}
          className="flex h-7 min-w-0 flex-1 items-center gap-2 rounded-md border border-transparent bg-ink-800 px-1.5 text-left transition-colors duration-100 hover:border-ink-600"
        >
          {asset ? <img src={asset.url} alt="" className="h-4 w-4 shrink-0 rounded-[3px] object-cover ring-1 ring-white/20" /> : <span className="h-4 w-4 shrink-0 rounded-[3px] bg-ink-600" />}
          <span className="min-w-0 truncate text-ink-100">{asset?.name ?? "Missing image"}</span>
        </button>
        <div className="w-16 shrink-0">
          <NumberField label="" title="Image opacity" suffix="%" min={0} max={100} value={Math.round(paint.opacity * 100)} onChange={(o) => update({ opacity: o / 100 })} />
        </div>
        <IconButton label={paint.visible ? "Hide" : "Show"} onClick={() => update({ visible: !paint.visible })}>
          {paint.visible ? <Eye size={13} /> : <EyeOff size={13} />}
        </IconButton>
        <IconButton label="Remove fill" onClick={remove}>
          <Minus size={13} />
        </IconButton>
      </div>
      <Select<ImageScaleMode> label="Image scale mode" value={paint.scaleMode} options={SCALE_MODES} onChange={(scaleMode) => update({ scaleMode })} />
    </div>
  );
}

function PaintList({
  title,
  paints,
  ids,
  onChange,
  defaultColor,
  allowImage = false,
  children,
}: {
  title: string;
  paints: Paint[] | Mixed;
  ids: NodeId[];
  onChange: (paints: Paint[]) => void;
  defaultColor: string;
  /** Fills can be pictures; strokes cannot. */
  allowImage?: boolean;
  children?: React.ReactNode;
}) {
  const list = paints === "mixed" ? [] : paints;
  const update = (id: string, patch: Partial<SolidPaint> | Partial<ImagePaint>) => onChange(list.map((p) => (p.id === id ? ({ ...p, ...patch } as Paint) : p)));
  return (
    <Section
      title={title}
      action={
        <button type="button" aria-label={`Add ${title.toLowerCase()}`} data-tip={`Add ${title.toLowerCase()}`} onClick={() => onChange([...list, solidPaint(defaultColor)])} className="-mr-1 flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
          <Plus size={14} strokeWidth={1.75} />
        </button>
      }
    >
      {paints === "mixed" && <p className="text-ink-400">Mixed — add one to replace them all.</p>}
      {list.map((paint) =>
        paint.type === "image" ? (
          <ImageFillRow key={paint.id} paint={paint} ids={ids} update={(patch) => update(paint.id, patch)} remove={() => onChange(list.filter((p) => p.id !== paint.id))} />
        ) : (
          <div key={paint.id} className="flex items-center gap-1.5">
            <ColorField label={title} value={paint.color} onChange={(color) => update(paint.id, { color })} onPickImage={allowImage ? () => void chooseImageForFill(ids, paint.id) : undefined} />
            <div className="w-16 shrink-0">
              <NumberField label="" title={`${title} opacity`} suffix="%" min={0} max={100} value={Math.round(paint.opacity * 100)} onChange={(o) => update(paint.id, { opacity: o / 100 })} />
            </div>
            <IconButton label={paint.visible ? "Hide" : "Show"} onClick={() => update(paint.id, { visible: !paint.visible })}>
              {paint.visible ? <Eye size={13} /> : <EyeOff size={13} />}
            </IconButton>
            <IconButton label={`Remove ${title.toLowerCase()}`} onClick={() => onChange(list.filter((p) => p.id !== paint.id))}>
              <Minus size={13} />
            </IconButton>
          </div>
        ),
      )}
      {list.length > 0 && children}
    </Section>
  );
}

const EFFECT_LABELS: Record<EffectType, string> = { "drop-shadow": "Drop shadow", "inner-shadow": "Inner shadow", "layer-blur": "Layer blur" };
const EFFECT_OPTIONS = (Object.keys(EFFECT_LABELS) as EffectType[]).map((value) => ({ value, label: EFFECT_LABELS[value] }));

/** The "+" button of the Effects section: choose which effect to add. */
function AddEffectMenu({ onAdd, hasBlur }: { onAdd: (effect: Effect) => void; hasBlur: boolean }) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismiss(open, close);
  return (
    <div ref={ref} className="relative -mr-1">
      <button type="button" aria-label="Add effect" data-tip="Add effect" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((o) => !o)} className="flex h-6 w-6 items-center justify-center rounded-md text-ink-300 transition-colors duration-100 hover:bg-ink-700 hover:text-ink-100">
        <Plus size={14} strokeWidth={1.75} />
      </button>
      {open && (
        <div className="absolute top-full right-0 z-30 mt-1">
          <MenuList
            onClose={close}
            items={[
              { label: EFFECT_LABELS["drop-shadow"], action: () => onAdd(dropShadow()) },
              { label: EFFECT_LABELS["inner-shadow"], action: () => onAdd(innerShadow()) },
              // A layer has one blur; a second would be ignored.
              { label: EFFECT_LABELS["layer-blur"], disabled: hasBlur, action: () => onAdd(layerBlur()) },
            ]}
          />
        </div>
      )}
    </div>
  );
}

function Effects({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const effects = shared(nodes, (n) => n.effects);
  const list = effects === "mixed" ? [] : effects;
  const set = (next: Effect[]) => edit(ids, { effects: next });
  const update = (id: string, patch: Partial<ShadowEffect> & Partial<LayerBlurEffect>) => set(list.map((e) => (e.id === id ? ({ ...e, ...patch } as Effect) : e)));
  const hasBlur = list.some((e) => e.type === "layer-blur");
  return (
    <Section title="Effects" action={<AddEffectMenu hasBlur={hasBlur} onAdd={(effect) => set([...list, effect])} />}>
      {effects === "mixed" && <p className="text-ink-400">Mixed — add one to replace them all.</p>}
      {list.map((effect) => {
        const name = EFFECT_LABELS[effect.type];
        // Another layer blur already exists, so this row can't become one.
        const options = hasBlur && effect.type !== "layer-blur" ? EFFECT_OPTIONS.filter((o) => o.value !== "layer-blur") : EFFECT_OPTIONS;
        return (
          <div key={effect.id} className="flex flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <div className="min-w-0 flex-1">
                <Select label="Effect type" value={effect.type} options={options} onChange={(type) => set(list.map((e) => (e.id === effect.id ? convertEffect(e, type) : e)))} />
              </div>
              <IconButton label={effect.visible ? "Hide" : "Show"} onClick={() => update(effect.id, { visible: !effect.visible })}>
                {effect.visible ? <Eye size={13} /> : <EyeOff size={13} />}
              </IconButton>
              <IconButton label="Remove effect" onClick={() => set(list.filter((e) => e.id !== effect.id))}>
                <Minus size={13} />
              </IconButton>
            </div>
            {effect.type === "layer-blur" ? (
              <NumberField label="Blur" title="Layer blur" min={0} value={effect.blur} onChange={(blur) => update(effect.id, { blur })} />
            ) : (
              <>
                <div className="flex items-center gap-1.5">
                  <ColorField label={name} value={effect.color} onChange={(color) => update(effect.id, { color })} />
                  <div className="w-16 shrink-0">
                    <NumberField label="" title={`${name} opacity`} suffix="%" min={0} max={100} value={Math.round(effect.opacity * 100)} onChange={(o) => update(effect.id, { opacity: o / 100 })} />
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-1.5">
                  <NumberField label="X" title={`${name} X offset`} value={effect.offsetX} onChange={(offsetX) => update(effect.id, { offsetX })} />
                  <NumberField label="Y" title={`${name} Y offset`} value={effect.offsetY} onChange={(offsetY) => update(effect.id, { offsetY })} />
                  <NumberField label="Blur" title={`${name} blur`} min={0} value={effect.blur} onChange={(blur) => update(effect.id, { blur })} />
                  <NumberField label="Spread" title={`${name} spread`} value={effect.spread} onChange={(spread) => update(effect.id, { spread })} />
                </div>
              </>
            )}
          </div>
        );
      })}
    </Section>
  );
}

function PagePanel() {
  const tool = useEditor((s) => s.tool);
  const pageId = useEditor((s) => s.pageId);
  const background = useEditor((s) => currentPage(s).background);
  const editDoc = useEditor((s) => s.editDoc);
  return (
    <>
      <Section title="Page">
        <div className="flex">
        <ColorField
          label="Page background"
          value={background}
          onChange={(color) => {
            // Page settings live on the document, outside per-page transactions.
            if (getPage(useEditor.getState().doc, pageId)?.background === color) return;
            editDoc((doc) => ({ ...doc, pages: doc.pages.map((p) => (p.id === pageId ? { ...p, background: color } : p)) }));
          }}
        />
        </div>
      </Section>
      {(tool === "frame" || tool === "select") && (
        <Section title="Frame presets">
          {(["Desktop", "Tablet", "Mobile"] as const).map((group) => (
            <div key={group} className="flex flex-col">
              <span className="mt-1 mb-0.5 text-[10px] font-semibold tracking-wider text-ink-400 uppercase">{group}</span>
              {FRAME_PRESETS.filter((p) => p.group === group).map((preset) => (
                <button
                  key={preset.name}
                  type="button"
                  onClick={() => insertFramePreset(preset)}
                  className="-mx-1.5 flex h-7 items-center justify-between rounded-md px-1.5 text-ink-100 transition-colors duration-100 hover:bg-ink-700"
                >
                  <span>{preset.name}</span>
                  <span className="text-ink-400 tabular-nums">
                    {preset.width} × {preset.height}
                  </span>
                </button>
              ))}
            </div>
          ))}
        </Section>
      )}
    </>
  );
}

export function PropertiesPanel() {
  const page = useEditor(currentPage);
  const selection = useEditor((s) => s.selection);
  const nodes = selection.map((id) => page.nodes[id]).filter((n): n is SceneNode => n !== undefined);
  const ids = nodes.map((n) => n.id);
  const type = shared(nodes, (n) => n.type);
  const tool = useEditor((s) => s.tool);
  // Every selected layer is placed by an auto layout frame.
  const inAuto =
    nodes.length > 0 &&
    nodes.every((n) => {
      const parent = n.parentId ? page.nodes[n.parentId] : undefined;
      return parent?.type === "frame" && parent.layout !== undefined;
    });
  const showFill = nodes.length > 0 && nodes.every((n) => n.type !== "group" && n.type !== "line");
  const showStroke = nodes.length > 0 && nodes.every((n) => n.type !== "group" && n.type !== "text");

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-black/40 bg-ink-900" data-testid="properties">
      {tool === "scale" && <ScalePanel nodes={nodes} ids={ids} />}
      {nodes.length === 0 ? (
        <PagePanel />
      ) : (
        <>
          <div className="flex h-10 shrink-0 items-center justify-between gap-2 border-b border-ink-700 px-3">
            <span className="truncate text-[12.5px] font-semibold text-ink-100">{nodes.length === 1 ? nodes[0]!.name : `${nodes.length} layers`}</span>
            <span className="shrink-0 rounded bg-ink-800 px-1.5 py-0.5 text-[10px] font-medium tracking-wide text-ink-400 uppercase">
              {type === "mixed" ? "Mixed" : type}
            </span>
          </div>
          <AlignRow count={nodes.length} />
          <Geometry nodes={nodes} ids={ids} />
          <AutoLayoutSection key={ids.join(",")} nodes={nodes} ids={ids} inAuto={inAuto} />
          <TypeSpecific nodes={nodes} ids={ids} />
          {showFill && (
            <PaintList
              title={type === "frame" ? "Background" : "Fill"}
              paints={shared(nodes, (n) => n.fills)}
              ids={ids}
              defaultColor="#d9d9d9"
              // Text is painted with a colour; every other shape can be filled with a picture.
              allowImage={nodes.every((n) => n.type !== "text")}
              onChange={(fills) => edit(ids, { fills })}
            />
          )}
          {showStroke && (
            <PaintList title="Stroke" paints={shared(nodes, (n) => n.strokes)} ids={ids} defaultColor="#000000" onChange={(strokes) => edit(ids, { strokes: strokes.filter((paint): paint is SolidPaint => paint.type === "solid") })}>
              <div className="grid grid-cols-2 gap-2">
                <NumberField label="Width" title="Stroke width" min={0} step={0.5} value={shared(nodes, (n) => n.strokeWidth)} onChange={(strokeWidth) => edit(ids, { strokeWidth })} />
                {nodes.every((n) => n.type === "line" || n.type === "vector") && (
                  <Select<StrokeCap>
                    label="Stroke cap"
                    value={sharedProp<StrokeCap>(nodes, "strokeCap")}
                    options={[
                      { value: "butt", label: "Butt cap" },
                      { value: "round", label: "Round cap" },
                      { value: "square", label: "Square cap" },
                    ]}
                    onChange={(strokeCap) => edit(ids, { strokeCap })}
                  />
                )}
                {type === "vector" && (
                  <Select<StrokeJoin>
                    label="Stroke join"
                    value={sharedProp<StrokeJoin>(nodes, "strokeJoin")}
                    options={[
                      { value: "miter", label: "Miter join" },
                      { value: "round", label: "Round join" },
                      { value: "bevel", label: "Bevel join" },
                    ]}
                    onChange={(strokeJoin) => edit(ids, { strokeJoin })}
                  />
                )}
              </div>
            </PaintList>
          )}
          {nodes.every((n) => n.type !== "group") && <Effects nodes={nodes} ids={ids} />}
          <Section title="Export">
            <button
              type="button"
              onClick={openExportDialog}
              className="flex h-7 items-center justify-center rounded-md bg-ink-700 font-medium text-ink-100 transition-colors duration-100 hover:bg-ink-600"
            >
              Export {nodes.length === 1 ? nodes[0]!.name : `${nodes.length} layers`}…
            </button>
          </Section>
        </>
      )}
    </aside>
  );
}
