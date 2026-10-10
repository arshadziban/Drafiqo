import { FolderOpen, Link2, Link2Off, TriangleAlert, X } from "lucide-react";
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { useCanvasUi } from "../canvas/uiStore";
import { currentPage, useEditor } from "../editor/store";
import { editHeight, editWidth, effectiveScale, initialRasterSize, proportionsDiffer, selectScale, setAspectLock } from "../export/exportDimensions";
import { renderExport } from "../export/exportDocument";
import { listExportTargets, renderSvg, sourceBounds } from "../export/exportRenderer";
import {
  FORMAT_INFO,
  SCALE_PRESETS,
  isRaster,
  type ExportFormat,
  type ExportRequest,
  type FitMode,
  type PdfMode,
  type RasterSize,
  type ScaleMode,
} from "../export/exportTypes";
import { sanitizeFileName, validateExport } from "../export/exportValidation";
import { platform } from "../storage/platform";
import { ColorField, Select } from "./ui";

const FORMATS: ExportFormat[] = ["png", "jpg", "webp", "svg", "pdf"];
const FOLDER_KEY = "drafiqo.exportFolder";

const describe = (error: unknown) => (error instanceof Error ? error.message : String(error));

function loadFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY);
  } catch {
    return null;
  }
}

function Segmented<T extends string | number>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
}) {
  return (
    <div role="group" aria-label={label} className="flex rounded-md bg-ink-800 p-0.5">
      {options.map((option) => (
        <button
          key={String(option.value)}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`h-6 flex-1 rounded-[5px] px-2 font-medium transition-colors duration-100 ${
            option.value === value ? "bg-ink-600 text-white shadow-sm shadow-black/30" : "text-ink-300 hover:text-ink-100"
          }`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

function Row({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="grid grid-cols-[92px_1fr] items-start gap-3">
      <span className="pt-1.5 text-ink-400">{label}</span>
      <div className="flex min-w-0 flex-col gap-2">{children}</div>
    </div>
  );
}

function PixelField({ label, short, value, onChange }: { label: string; short: string; value: number; onChange: (value: number) => void }) {
  return (
    <label className="flex h-7 min-w-0 flex-1 items-center gap-1.5 rounded-md border border-transparent bg-ink-800 px-2 transition-colors duration-100 focus-within:border-accent focus-within:bg-ink-950 hover:border-ink-600">
      <span className="text-ink-400">{short}</span>
      <input
        aria-label={label}
        inputMode="numeric"
        className="w-full min-w-0 bg-transparent text-ink-100 tabular-nums outline-none"
        value={Number.isFinite(value) ? String(value) : ""}
        onFocus={(e) => e.target.select()}
        onChange={(e) => {
          const text = e.target.value.trim();
          onChange(text === "" || !/^-?\d*\.?\d*$/.test(text) ? Number.NaN : Number(text));
        }}
      />
      <span className="text-ink-400">px</span>
    </label>
  );
}

function Toggle({ label, checked, onChange }: { label: string; checked: boolean; onChange: (checked: boolean) => void }) {
  return (
    <label className="flex h-7 items-center gap-2 text-ink-100">
      <input type="checkbox" className="h-3.5 w-3.5 accent-accent" checked={checked} onChange={(e) => onChange(e.target.checked)} />
      {label}
    </label>
  );
}

function QualitySlider({ value, onChange, disabled }: { value: number; onChange: (value: number) => void; disabled?: boolean }) {
  return (
    <div className={`flex h-7 items-center gap-3 ${disabled ? "opacity-40" : ""}`}>
      <input
        type="range"
        aria-label="Quality"
        min={1}
        max={100}
        disabled={disabled}
        value={Math.round(value * 100)}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="h-1 flex-1 accent-accent"
      />
      <span className="w-9 text-right text-ink-100 tabular-nums">{Math.round(value * 100)}%</span>
    </div>
  );
}

type Status =
  | { kind: "idle" }
  | { kind: "working" }
  | { kind: "done"; message: string; warnings: string[] }
  | { kind: "error"; message: string };

function Dialog({ onClose }: { onClose: () => void }) {
  const page = useEditor(currentPage);
  const selection = useEditor((s) => s.selection);
  const targets = useMemo(() => listExportTargets(page, selection), [page, selection]);

  const [targetKey, setTargetKey] = useState(targets[0]?.key ?? "");
  const target = targets.find((t) => t.key === targetKey) ?? targets[0];
  const bounds = useMemo(() => (target ? sourceBounds(page, target) : { x: 0, y: 0, width: 0, height: 0 }), [page, target]);
  const sourceWidth = bounds.width;
  const sourceHeight = bounds.height;
  const source = useMemo(() => ({ width: sourceWidth, height: sourceHeight }), [sourceWidth, sourceHeight]);

  const [format, setFormat] = useState<ExportFormat>("png");
  const [size, setSize] = useState<RasterSize>(() => initialRasterSize(source));
  const [fit, setFit] = useState<FitMode>("contain");
  const [transparent, setTransparent] = useState(true);
  const [background, setBackground] = useState("#ffffff");
  const [jpgQuality, setJpgQuality] = useState(0.9);
  const [webpQuality, setWebpQuality] = useState(1);
  const [lossless, setLossless] = useState(false);
  const [pdfMode, setPdfMode] = useState<PdfMode>("vector");
  const [customName, setCustomName] = useState<string | null>(null);
  const [folder, setFolder] = useState<string | null>(loadFolder);
  const [status, setStatus] = useState<Status>({ kind: "idle" });

  // A different target has a different source size: presets follow it, Custom keeps what was typed.
  useEffect(() => {
    setSize((current) => (current.scale === "custom" ? current : selectScale(current, source, current.scale)));
  }, [source]);

  const raster = isRaster(format);
  const info = FORMAT_INFO[format];
  const suffix = raster && size.scale !== "custom" && size.scale > 1 ? `@${size.scale}x` : "";
  const fileName = customName ?? `${sanitizeFileName(target?.label ?? "Export")}${suffix}`;
  const mismatch = raster && proportionsDiffer(size, source);
  const outputSize = raster ? { width: size.width, height: size.height } : source;

  const request: ExportRequest | null = target
    ? {
        target,
        format,
        size: outputSize,
        fit: mismatch ? fit : "stretch",
        transparent: format === "jpg" ? false : transparent,
        background,
        quality: format === "webp" ? webpQuality : jpgQuality,
        lossless,
        pdfMode,
        fileName,
      }
    : null;
  const errors = request ? validateExport(request, source) : ["There is nothing on this page to export."];
  const sizeValid = Number.isFinite(outputSize.width) && Number.isFinite(outputSize.height) && outputSize.width >= 1 && outputSize.height >= 1;

  const previewBackground = request && (format === "jpg" || !request.transparent) ? background : null;
  const preview = useMemo(() => {
    if (!target || !sizeValid || source.width <= 0) return null;
    // The preview is drawn at screen size; proportions and fit match the real output.
    const longest = Math.max(outputSize.width, outputSize.height);
    const shrink = Math.min(1, 560 / longest);
    const previewSize = { width: Math.max(1, Math.round(outputSize.width * shrink)), height: Math.max(1, Math.round(outputSize.height * shrink)) };
    const svg = renderSvg(page, target, { size: previewSize, fit: mismatch ? fit : "stretch", background: previewBackground });
    return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  }, [page, target, sizeValid, source.width, outputSize.width, outputSize.height, mismatch, fit, previewBackground]);

  const edit = <T,>(setter: (value: T) => void) => (value: T) => {
    setter(value);
    setStatus({ kind: "idle" });
  };
  const updateSize = (next: RasterSize) => {
    setSize(next);
    setStatus({ kind: "idle" });
  };

  const pickFolder = async (): Promise<string | null> => {
    const picked = await platform.chooseFolder(folder);
    if (picked) {
      setFolder(picked);
      try {
        localStorage.setItem(FOLDER_KEY, picked);
      } catch {
        // Remembering the folder is a convenience only.
      }
    }
    return picked;
  };

  const run = async () => {
    if (!request || errors.length > 0 || status.kind === "working") return;
    try {
      let destination = folder;
      if (platform.canChooseFolder && !destination) {
        destination = await pickFolder();
        if (!destination) return;
      }
      setStatus({ kind: "working" });
      // Let the "Exporting…" state paint before the heavy work starts.
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
      const result = await renderExport(currentPage(useEditor.getState()), request);
      const file = { folder: destination, name: `${fileName.trim()}.${info.extension}`, bytes: result.bytes, mime: info.mime };
      let written = await platform.writeExport({ ...file, overwrite: false });
      if (written.status === "exists") {
        const replace = await platform.confirm(`"${file.name}" already exists in this folder. Replace it?`, { title: "Replace file", okLabel: "Replace" });
        if (!replace) return setStatus({ kind: "idle" });
        written = await platform.writeExport({ ...file, overwrite: true });
      }
      const dimensions = raster ? `${result.width} × ${result.height} px` : `${result.width} × ${result.height}`;
      setStatus({ kind: "done", message: `Exported ${file.name} (${dimensions}) to ${written.location}`, warnings: result.warnings });
    } catch (error) {
      setStatus({ kind: "error", message: describe(error) });
    }
  };

  const scaleOptions: { value: ScaleMode; label: string }[] = [...SCALE_PRESETS.map((s) => ({ value: s as ScaleMode, label: `${s}×` })), { value: "custom", label: "Custom" }];
  const scale = effectiveScale(outputSize, source);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 backdrop-blur-[2px]"
      onPointerDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div role="dialog" aria-modal aria-label="Export" className="flex max-h-[92vh] w-[820px] max-w-[96vw] animate-pop flex-col overflow-hidden rounded-xl bg-ink-900 shadow-popover">
        <header className="flex h-11 shrink-0 items-center justify-between border-b border-ink-700 pr-2 pl-4">
          <h2 className="text-[13px] font-semibold text-ink-100">Export</h2>
          <button type="button" aria-label="Close" onClick={onClose} className="flex h-7 w-7 items-center justify-center rounded-md text-ink-300 hover:bg-ink-700 hover:text-ink-100">
            <X size={15} />
          </button>
        </header>

        <div className="flex min-h-0 flex-1">
          {/* Preview */}
          <div className="flex w-[300px] shrink-0 flex-col border-r border-ink-700 bg-ink-950">
            <div
              className="m-4 flex flex-1 items-center justify-center overflow-hidden rounded-lg p-3"
              style={{
                minHeight: 240,
                backgroundColor: "#2a2c31",
                backgroundImage: "repeating-conic-gradient(#33363c 0% 25%, transparent 0% 50%)",
                backgroundSize: "16px 16px",
              }}
            >
              {preview ? (
                <img src={preview} alt="Export preview" className="max-h-[300px] max-w-full object-contain shadow-lg shadow-black/40" />
              ) : (
                <span className="text-ink-400">No preview</span>
              )}
            </div>
            <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 px-4 pb-4">
              <dt className="text-ink-400">Source</dt>
              <dd className="text-right text-ink-300 tabular-nums">
                {source.width} × {source.height} px
              </dd>
              <dt className="text-ink-400">Output</dt>
              <dd className="text-right font-semibold text-ink-100 tabular-nums" data-testid="export-output">
                {sizeValid ? `${outputSize.width} × ${outputSize.height} ${raster ? "px" : format === "pdf" ? "pt" : "px"}` : "—"}
              </dd>
              {raster && (
                <>
                  <dt className="text-ink-400">Scale</dt>
                  <dd className="text-right text-ink-300 tabular-nums">{scale !== null && sizeValid ? `${scale}×` : "Custom proportions"}</dd>
                </>
              )}
            </dl>
          </div>

          {/* Settings */}
          <div className="flex min-w-0 flex-1 flex-col gap-4 overflow-y-auto p-4">
            <Row label="Export target">
              <Select
                label="Export target"
                value={target?.key ?? ""}
                options={targets.map((t) => ({ value: t.key, label: t.label }))}
                onChange={edit((key: string) => {
                  setTargetKey(key);
                  setCustomName(null);
                })}
              />
            </Row>

            <Row label="Format">
              <Segmented label="Format" value={format} options={FORMATS.map((f) => ({ value: f, label: FORMAT_INFO[f].label }))} onChange={edit(setFormat)} />
            </Row>

            {raster && (
              <>
                <Row label="Scale">
                  <Segmented label="Scale" value={size.scale} options={scaleOptions} onChange={(s) => updateSize(selectScale(size, source, s))} />
                </Row>
                <Row label="Dimensions">
                  <div className="flex items-center gap-1.5">
                    <PixelField label="Export width" short="W" value={size.width} onChange={(w) => updateSize(editWidth(size, source, w))} />
                    <button
                      type="button"
                      aria-label="Lock aspect ratio"
                      data-tip={size.lockAspect ? "Aspect ratio locked" : "Aspect ratio unlocked"}
                      aria-pressed={size.lockAspect}
                      onClick={() => updateSize(setAspectLock(size, source, !size.lockAspect))}
                      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md transition-colors duration-100 ${
                        size.lockAspect ? "bg-accent-soft text-accent-hover" : "text-ink-400 hover:bg-ink-700 hover:text-ink-100"
                      }`}
                    >
                      {size.lockAspect ? <Link2 size={14} /> : <Link2Off size={14} />}
                    </button>
                    <PixelField label="Export height" short="H" value={size.height} onChange={(h) => updateSize(editHeight(size, source, h))} />
                  </div>
                  {size.scale === "custom" && <span className="text-ink-400">Custom size{size.lockAspect ? ", proportions locked to the artwork" : ""}.</span>}
                  {mismatch && (
                    <>
                      <span className="text-ink-300">These proportions differ from the artwork. Choose how it should fit:</span>
                      <Segmented<FitMode>
                        label="Fit"
                        value={fit}
                        options={[
                          { value: "contain", label: "Fit inside" },
                          { value: "cover", label: "Fill and crop" },
                          { value: "stretch", label: "Stretch" },
                        ]}
                        onChange={edit(setFit)}
                      />
                    </>
                  )}
                </Row>
              </>
            )}

            <Row label={`${info.label} settings`}>
              {format === "pdf" && (
                <>
                  <Segmented<PdfMode>
                    label="PDF content"
                    value={pdfMode}
                    options={[
                      { value: "vector", label: "Vector" },
                      { value: "image", label: "Image" },
                    ]}
                    onChange={edit(setPdfMode)}
                  />
                  <span className="text-ink-400">
                    {pdfMode === "vector"
                      ? "Shapes and text stay vector. Text uses standard PDF fonts and drop shadows are left out."
                      : "Embeds a 2× picture of the artwork: exact appearance, but not editable vectors."}
                  </span>
                </>
              )}
              {format !== "jpg" && (
                <Toggle label={format === "pdf" || format === "svg" ? "No background" : "Transparent background"} checked={transparent} onChange={edit(setTransparent)} />
              )}
              {(format === "jpg" || !transparent) && (
                <div className="flex items-center gap-2">
                  <span className="w-20 shrink-0 text-ink-400">Background</span>
                  <ColorField label="Export background" value={background} onChange={edit(setBackground)} />
                </div>
              )}
              {format === "jpg" && (
                <>
                  <QualitySlider value={jpgQuality} onChange={edit(setJpgQuality)} />
                  <span className="text-ink-400">JPG has no transparency; empty areas use the background colour.</span>
                </>
              )}
              {format === "webp" && (
                <>
                  <QualitySlider value={webpQuality} onChange={edit(setWebpQuality)} disabled={lossless} />
                  <Toggle label="Lossless" checked={lossless} onChange={edit(setLossless)} />
                  <span className="text-ink-400">Quality 100% is still lossy compression. Turn on Lossless for pixel-exact output (larger files).</span>
                </>
              )}
            </Row>

            <Row label="Destination">
              <div className="flex items-center gap-1.5">
                <label className="flex h-7 min-w-0 flex-1 items-center rounded-md border border-transparent bg-ink-800 px-2 transition-colors duration-100 focus-within:border-accent focus-within:bg-ink-950 hover:border-ink-600">
                  <input
                    aria-label="File name"
                    className="w-full min-w-0 bg-transparent text-ink-100 outline-none"
                    value={fileName}
                    onChange={(e) => edit(setCustomName)(e.target.value)}
                  />
                </label>
                <span className="flex h-7 shrink-0 items-center rounded-md bg-ink-800 px-2 text-ink-300" data-testid="export-extension">
                  .{info.extension}
                </span>
              </div>
              {platform.canChooseFolder ? (
                <div className="flex items-center gap-1.5">
                  <span className="flex h-7 min-w-0 flex-1 items-center truncate rounded-md bg-ink-800 px-2 text-ink-300" data-tip={folder ?? undefined}>
                    {folder ?? "No folder chosen"}
                  </span>
                  <button type="button" onClick={() => void pickFolder()} className="flex h-7 shrink-0 items-center gap-1.5 rounded-md bg-ink-700 px-2.5 font-medium text-ink-100 hover:bg-ink-600">
                    <FolderOpen size={13} />
                    Choose folder
                  </button>
                </div>
              ) : (
                <span className="text-ink-400">Saved to your browser's download folder.</span>
              )}
            </Row>
          </div>
        </div>

        <footer className="flex min-h-13 shrink-0 items-center gap-3 border-t border-ink-700 px-4 py-2.5">
          <div className="min-w-0 flex-1" role="status" data-testid="export-status">
            {status.kind === "error" ? (
              <p className="flex items-start gap-1.5 whitespace-pre-line text-red-300">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                {status.message}
              </p>
            ) : errors.length > 0 ? (
              <p className="flex items-start gap-1.5 whitespace-pre-line text-amber-300">
                <TriangleAlert size={13} className="mt-0.5 shrink-0" />
                {errors.join("\n")}
              </p>
            ) : status.kind === "done" ? (
              <div className="flex flex-col gap-0.5">
                <p className="break-words text-emerald-300">{status.message}</p>
                {status.warnings.map((w) => (
                  <p key={w} className="text-ink-400">
                    {w}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
          <button type="button" onClick={onClose} className="h-8 shrink-0 rounded-md px-3 font-medium text-ink-300 hover:bg-ink-700 hover:text-ink-100">
            {status.kind === "done" ? "Done" : "Cancel"}
          </button>
          <button
            type="button"
            disabled={errors.length > 0 || status.kind === "working"}
            onClick={() => void run()}
            className="h-8 shrink-0 rounded-md bg-accent px-4 font-semibold text-white transition-colors duration-100 hover:bg-accent-hover disabled:bg-ink-700 disabled:text-ink-400"
          >
            {status.kind === "working" ? "Exporting…" : `Export ${info.label}`}
          </button>
        </footer>
      </div>
    </div>
  );
}

export function ExportDialog() {
  const open = useCanvasUi((s) => s.exportOpen);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") useCanvasUi.setState({ exportOpen: false });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);
  if (!open) return null;
  return <Dialog onClose={() => useCanvasUi.setState({ exportOpen: false })} />;
}
