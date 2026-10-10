import { dropShadow } from "./factory";
import type { Effect, EffectType, ShadowEffect } from "./types";

// Geometry shared by the canvas renderer and the exporter: how far effects
// reach beyond a layer's box, so filters and exported images are never cut off.

export const isShadow = (e: Effect): e is ShadowEffect => e.type !== "layer-blur";

/** The layer blur that is drawn: one per layer, the first visible one. */
export function activeLayerBlur(effects: readonly Effect[]): number {
  const found = effects.find((e) => e.visible && e.type === "layer-blur");
  return found ? found.blur : 0;
}

export interface Outset {
  left: number;
  right: number;
  top: number;
  bottom: number;
}

/**
 * How far visible effects paint past the layer's box on each side. A blur's
 * visible edge reaches about its blur value; shadows add their spread and are
 * moved by their offset. Inner shadows stay inside the layer.
 */
export function effectOutset(effects: readonly Effect[]): Outset {
  const blur = activeLayerBlur(effects);
  const out: Outset = { left: blur, right: blur, top: blur, bottom: blur };
  for (const e of effects) {
    if (!e.visible || e.type !== "drop-shadow") continue;
    const reach = blur + e.blur + Math.max(0, e.spread);
    out.left = Math.max(out.left, reach - e.offsetX);
    out.right = Math.max(out.right, reach + e.offsetX);
    out.top = Math.max(out.top, reach - e.offsetY);
    out.bottom = Math.max(out.bottom, reach + e.offsetY);
  }
  return out;
}

/**
 * Margin added around the layer for the SVG filter region. Generous on purpose:
 * a Gaussian blur has long tails and offsets can point in any direction.
 */
export function filterPad(effects: readonly Effect[]): number {
  const blur = activeLayerBlur(effects);
  let pad = blur * 2;
  for (const e of effects) {
    if (!e.visible || !isShadow(e)) continue;
    pad = Math.max(pad, blur * 2 + e.blur * 2 + Math.abs(e.spread) + Math.max(Math.abs(e.offsetX), Math.abs(e.offsetY)));
  }
  return pad;
}

/** Switches an effect to another type, keeping what carries over (id, blur, visibility, shadow settings). */
export function convertEffect(effect: Effect, type: EffectType): Effect {
  if (effect.type === type) return effect;
  if (type === "layer-blur") return { id: effect.id, type, blur: effect.blur, visible: effect.visible };
  const base = effect.type === "layer-blur" ? { ...dropShadow(), id: effect.id, blur: effect.blur, visible: effect.visible } : effect;
  return { ...base, type };
}
