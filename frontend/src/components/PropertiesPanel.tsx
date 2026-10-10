import {
  AlignCenterHorizontal,
  AlignCenterVertical,
  AlignEndHorizontal,
  AlignEndVertical,
  AlignHorizontalSpaceAround,
  AlignStartHorizontal,
  AlignStartVertical,
  AlignVerticalSpaceAround,
  Blend,
  Eye,
  EyeOff,
  Minus,
  MoveHorizontal,
  MoveVertical,
  Plus,
  RotateCw,
  Scan,
} from "lucide-react";
import { useCallback, useState } from "react";
import { fontStack } from "../canvas/renderNode";
import { convertEffect } from "../document/effects";
import { dropShadow, innerShadow, layerBlur, solidPaint } from "../document/factory";
import { getPage } from "../document/tree";
import { getAsset } from "../document/assets";
import type { Effect, EffectType, ImagePaint, ImageScaleMode, LayerBlurEffect, NodeId, Paint, SceneNode, ShadowEffect, SolidPaint, StrokeCap, StrokeJoin, TextAlign, TextAutoResize } from "../document/types";
import { FRAME_PRESETS, alignSelection, distributeSelection, insertFramePreset } from "../editor/actions";
import { patchNodes, resizeNode, type NodePatch } from "../editor/commands";
import { chooseImageForFill } from "../editor/images";
import { currentPage, useEditor } from "../editor/store";
import { openExportDialog } from "./openExportDialog";
import { ColorField, IconButton, MenuList, NumberField, Section, Select, shared, useDismiss, type Mixed } from "./ui";

const FONT_FAMILIES = ["Arial", "Helvetica", "Verdana", "Trebuchet MS", "Georgia", "Times New Roman", "Courier New", "Menlo", "Segoe UI", "system-ui"];
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

function Geometry({ nodes, ids }: { nodes: SceneNode[]; ids: NodeId[] }) {
  const resize = (width: number | null, height: number | null) =>
    useEditor.getState().edit((page) =>
      ids.reduce((p, id) => {
        const n = p.nodes[id];
        return n ? resizeNode(p, id, width ?? n.width, height ?? n.height) : p;
      }, page),
    );
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
          <NumberField label={<Scan size={11} />} title="Corner radius" min={0} value={sharedProp<number>(nodes, "cornerRadius")} onChange={(cornerRadius) => edit(ids, { cornerRadius })} />
        )}
      </div>
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
      <Select
        label="Font family"
        value={sharedProp<string>(nodes, "fontFamily")}
        options={FONT_FAMILIES.map((f) => ({ value: f, label: f, fontFamily: fontStack(f) }))}
        onChange={(fontFamily) => edit(ids, { fontFamily })}
      />
      <div className="grid grid-cols-2 gap-2">
        <Select label="Font weight" value={sharedProp<number>(nodes, "fontWeight")} options={FONT_WEIGHTS} onChange={(fontWeight) => edit(ids, { fontWeight })} />
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
  const showFill = nodes.length > 0 && nodes.every((n) => n.type !== "group" && n.type !== "line");
  const showStroke = nodes.length > 0 && nodes.every((n) => n.type !== "group" && n.type !== "text");

  return (
    <aside className="flex w-64 shrink-0 flex-col overflow-y-auto border-l border-black/40 bg-ink-900" data-testid="properties">
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
            <p className="text-ink-400">PNG, JPG and WebP at 1×–4× or a custom size, plus SVG and PDF.</p>
          </Section>
        </>
      )}
    </aside>
  );
}
