// The outfit's palette: every garment and accessory pixel inside the figure,
// clustered in OKLab and weighted by area. Deterministic by construction:
// pixels are visited in a fixed order, the clusters start from a median cut
// (no random seeds), k-means runs a fixed number of passes, and ties break
// by index. The colour-theory rules (rules.ts) read only this palette.

import { type Lab, deltaE, srgbToOklab } from "./color";
import { CATEGORY, type Mask } from "./measure";
import type { Pixels } from "./resample";

export interface Swatch {
  lab: Lab;
  /** Share of the outfit's garment area, 0..1. */
  share: number;
  /** Mean row of the swatch's pixels as a fraction of the figure, head (0) to feet (1). */
  y: number;
}

export const MAX_COLOURS = 5;
/** Swatches closer than this in OKLab are one colour. */
export const MERGE_DELTA = 0.06;
/** Swatches smaller than this share of the garment area are dropped as noise. */
export const MIN_SHARE = 0.03;
const PASSES = 8;

interface Px {
  lab: Lab;
  y: number;
}

function medianCut(px: Px[], k: number): Lab[] {
  let boxes: Px[][] = [px];
  while (boxes.length < k) {
    // Split the box with the widest channel range at that channel's median.
    let best = -1, bestRange = 0, bestKey: keyof Lab = "L";
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const key of ["L", "a", "b"] as const) {
        let lo = Infinity, hi = -Infinity;
        for (const p of box) { lo = Math.min(lo, p.lab[key]); hi = Math.max(hi, p.lab[key]); }
        if (hi - lo > bestRange) { bestRange = hi - lo; best = i; bestKey = key; }
      }
    });
    if (best < 0) break;
    const sorted = [...boxes[best]].sort((p, q) => p.lab[bestKey] - q.lab[bestKey]);
    const mid = sorted.length >> 1;
    boxes = [...boxes.slice(0, best), sorted.slice(0, mid), sorted.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => mean(box.map((p) => p.lab)));
}

function mean(labs: Lab[]): Lab {
  const n = labs.length || 1;
  return { L: labs.reduce((s, l) => s + l.L, 0) / n, a: labs.reduce((s, l) => s + l.a, 0) / n, b: labs.reduce((s, l) => s + l.b, 0) / n };
}

function nearest(lab: Lab, centres: Lab[]): number {
  let best = 0, d = Infinity;
  centres.forEach((c, i) => {
    const e = deltaE(lab, c);
    if (e < d) { d = e; best = i; }
  });
  return best;
}

export interface Figure {
  top: number;
  bottom: number;
  left: number;
  right: number;
}

/** Garment and accessory pixels inside the figure's box, clustered into at most MAX_COLOURS swatches by area. */
export function extractPalette(pixels: Pixels, mask: Mask, fig: Figure): Swatch[] {
  const W = mask.width;
  const pad = (fig.right - fig.left) * 0.35;
  const x0 = Math.max(0, Math.floor(fig.left - pad)), x1 = Math.min(W - 1, Math.ceil(fig.right + pad));
  const y0 = Math.max(0, Math.floor(fig.top)), y1 = Math.min(mask.height - 1, Math.ceil(fig.bottom));
  const h = Math.max(1, fig.bottom - fig.top);
  const px: Px[] = [];
  const cache = new Map<number, Lab>();
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const cat = mask.data[y * W + x];
      if (cat !== CATEGORY.clothes && cat !== CATEGORY.other) continue;
      const i = (y * W + x) * 4;
      const key = (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
      let lab = cache.get(key);
      if (!lab) { lab = srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]); cache.set(key, lab); }
      px.push({ lab, y: (y - fig.top) / h });
    }
  if (!px.length) return [];

  let centres = medianCut(px, MAX_COLOURS);
  let assign = new Uint8Array(px.length);
  for (let pass = 0; pass < PASSES; pass++) {
    assign = Uint8Array.from(px, (p) => nearest(p.lab, centres));
    centres = centres.map((c, i) => {
      const members = px.filter((_, j) => assign[j] === i).map((p) => p.lab);
      return members.length ? mean(members) : c;
    });
  }

  let swatches: Swatch[] = centres.map((lab, i) => {
    let n = 0, ys = 0;
    for (let j = 0; j < px.length; j++) if (assign[j] === i) { n++; ys += px[j].y; }
    return { lab, share: n / px.length, y: n ? ys / n : 0 };
  });
  // Merge near-identical swatches (largest first), then drop specks.
  swatches.sort((p, q) => q.share - p.share);
  const merged: Swatch[] = [];
  for (const s of swatches) {
    const into = merged.find((m) => deltaE(m.lab, s.lab) < MERGE_DELTA);
    if (!into) { merged.push({ ...s }); continue; }
    const total = into.share + s.share;
    into.lab = { L: (into.lab.L * into.share + s.lab.L * s.share) / total, a: (into.lab.a * into.share + s.lab.a * s.share) / total, b: (into.lab.b * into.share + s.lab.b * s.share) / total };
    into.y = (into.y * into.share + s.y * s.share) / total;
    into.share = total;
  }
  swatches = merged.filter((s) => s.share >= MIN_SHARE);
  const kept = swatches.reduce((t, s) => t + s.share, 0) || 1;
  return swatches.map((s) => ({ ...s, share: s.share / kept })).sort((p, q) => q.share - p.share);
}


/**
 * Which swatch each pixel belongs to (-1 for none): the same box, the same
 * categories and the same nearest-colour rule as extractPalette, so "try it"
 * recolours exactly the pixels the palette was measured from.
 */
export function assignPixels(pixels: Pixels, mask: Mask, fig: Figure, swatches: Swatch[]): Int8Array {
  const W = mask.width;
  const out = new Int8Array(W * mask.height).fill(-1);
  if (!swatches.length) return out;
  const pad = (fig.right - fig.left) * 0.35;
  const x0 = Math.max(0, Math.floor(fig.left - pad)), x1 = Math.min(W - 1, Math.ceil(fig.right + pad));
  const y0 = Math.max(0, Math.floor(fig.top)), y1 = Math.min(mask.height - 1, Math.ceil(fig.bottom));
  const centres = swatches.map((s) => s.lab);
  for (let y = y0; y <= y1; y++)
    for (let x = x0; x <= x1; x++) {
      const cat = mask.data[y * W + x];
      if (cat !== CATEGORY.clothes && cat !== CATEGORY.other) continue;
      const i = (y * W + x) * 4;
      const lab = srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      // A pixel far from every swatch (a dropped speck) is left as it is.
      const k = nearest(lab, centres);
      out[y * W + x] = deltaE(lab, centres[k]) < 0.2 ? k : -1;
    }
  return out;
}
