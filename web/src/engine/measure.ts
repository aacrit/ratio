// Turns what the models saw (pose landmarks and a per-pixel category mask)
// into raw measurements of an outfit. Pure: no models, no DOM. The models'
// numbers come in; plain geometry and colour statistics go out.

import { type Lab, deltaE, srgbToOklab } from "./color";
import type { Pixels } from "./resample";

/** The multiclass selfie segmenter's categories. */
export const CATEGORY = { background: 0, hair: 1, bodySkin: 2, faceSkin: 3, clothes: 4, other: 5 } as const;

export interface Landmark {
  /** Normalized to the image, 0..1. */
  x: number;
  y: number;
  visibility?: number;
}

/** The pose landmarks Ratio reads, by MediaPipe's BlazePose index. */
export const POSE = { nose: 0, lShoulder: 11, rShoulder: 12, lHip: 23, rHip: 24, lKnee: 25, rKnee: 26, lAnkle: 27, rAnkle: 28 } as const;

export interface Mask {
  width: number;
  height: number;
  /** One category per pixel, row-major, same size as the pixels. */
  data: Uint8Array;
}

export interface OutfitMeasure {
  /** Figure extent in pixel rows: top of the head to the lowest point of the feet. */
  top: number;
  bottom: number;
  /** The row where the eye breaks the figure (top garment to bottom garment), or null for one colour column. */
  breakRow: number | null;
  /** Estimated natural-waist row (from shoulder and hip landmarks). */
  waistRow: number;
  /** The body's column in pixels (shoulders and hips) and its centre line, for drawing. Not read by any rule. */
  left: number;
  right: number;
  centerX: number;
  /** Mean colour of the top and bottom garments, OKLab. */
  topColour: Lab;
  bottomColour: Lab;
  /**
   * Volume, as fabric widths (garment pixels counted across one row, so a
   * wide stance or arms held out never reads as width). Null when the row
   * holds too little garment to measure.
   */
  fit: { top: number; legs: number } | null;
}

export type MeasureFailure = "no_figure" | "feet_not_in_frame" | "no_clothes";

const VISIBLE = 0.5;
/**
 * Top and bottom garments closer than this (OKLab) read as one colour
 * column. About two just-noticeable differences: black over plum (0.06 on a
 * real photo) is two pieces; two blacks are one column.
 */
export const ONE_COLUMN_DELTA = 0.04;
/** Where the natural waist sits between the shoulder line and the hip joints. */
export const WAIST_FRACTION = 0.6;

const isPerson = (c: number) => c !== CATEGORY.background;

function median(values: number[]): number {
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function medianLab(rows: Lab[]): Lab {
  return { L: median(rows.map((r) => r.L)), a: median(rows.map((r) => r.a)), b: median(rows.map((r) => r.b)) };
}

/** Garment pixels in row y between x0 and x1: the fabric's width at that height. */
function fabricWidth(mask: Mask, y: number, x0: number, x1: number): number {
  const W = mask.width;
  const row = Math.round(y);
  if (row < 0 || row >= mask.height) return 0;
  let n = 0;
  for (let x = Math.max(0, Math.floor(x0)); x <= Math.min(W - 1, Math.ceil(x1)); x++) {
    const c = mask.data[row * W + x];
    if (c === CATEGORY.clothes || c === CATEGORY.other) n++;
  }
  return n;
}

/** The median fabric width over a few rows around y, so one stray row cannot decide it. */
function fabricAround(mask: Mask, y: number, x0: number, x1: number, span: number): number {
  const ws: number[] = [];
  for (let d = -span; d <= span; d++) ws.push(fabricWidth(mask, y + d, x0, x1));
  return median(ws);
}

export function measureOutfit(pixels: Pixels, mask: Mask, pose: Landmark[]): OutfitMeasure | MeasureFailure {
  if (pose.length < 29) return "no_figure";
  const { width: W, height: H } = mask;
  const px = (l: Landmark) => l.x * W;
  const py = (l: Landmark) => l.y * H;
  const sL = pose[POSE.lShoulder], sR = pose[POSE.rShoulder];
  const hL = pose[POSE.lHip], hR = pose[POSE.rHip];
  const kL = pose[POSE.lKnee], kR = pose[POSE.rKnee];
  const aL = pose[POSE.lAnkle], aR = pose[POSE.rAnkle];
  const seen = (l: Landmark) => (l.visibility ?? 1) >= VISIBLE;
  if (![sL, sR, hL, hR].every(seen)) return "no_figure";
  if (!seen(aL) && !seen(aR)) return "feet_not_in_frame";

  const shoulderY = (py(sL) + py(sR)) / 2;
  const hipY = (py(hL) + py(hR)) / 2;
  const kneeY = (py(kL) + py(kR)) / 2;
  const ankleY = Math.max(py(aL), py(aR));
  const sx0 = Math.min(px(sL), px(sR)), sx1 = Math.max(px(sL), px(sR));
  const hx0 = Math.min(px(hL), px(hR)), hx1 = Math.max(px(hL), px(hR));
  const bodyX0 = Math.max(0, Math.floor(Math.min(sx0, hx0)));
  const bodyX1 = Math.min(W - 1, Math.ceil(Math.max(sx1, hx1)));

  // Figure extent: the first and last rows with any person pixel inside the
  // body's column. The head is above the shoulders; the shoes below the ankles.
  let top = -1;
  for (let y = 0; y < Math.min(H, shoulderY) && top < 0; y++)
    for (let x = bodyX0; x <= bodyX1; x++) if (isPerson(mask.data[y * W + x])) { top = y; break; }
  let bottom = -1;
  for (let y = H - 1; y >= Math.max(0, ankleY) && bottom < 0; y--)
    for (let x = bodyX0; x <= bodyX1; x++) if (isPerson(mask.data[y * W + x])) { bottom = y; break; }
  if (top < 0) return "no_figure";
  if (bottom < 0) bottom = Math.min(H - 1, Math.round(ankleY));
  if (bottom >= H - 1 && !seen(aL) && !seen(aR)) return "feet_not_in_frame";

  // Mean garment colour per row, sampled in the torso column above the hips
  // (shoulders inset 15% each side, clear of the arms) and the hip column
  // below (widened 20% for the legs).
  const insetS = (sx1 - sx0) * 0.15;
  const widenH = (hx1 - hx0) * 0.2;
  const rows: (Lab | null)[] = [];
  const y0 = Math.ceil(shoulderY);
  const y1 = Math.min(H - 1, Math.floor(ankleY));
  for (let y = y0; y <= y1; y++) {
    const [x0, x1] = y < hipY ? [sx0 + insetS, sx1 - insetS] : [hx0 - widenH, hx1 + widenH];
    const a = Math.max(0, Math.floor(x0)), b = Math.min(W - 1, Math.ceil(x1));
    let n = 0, r = 0, g = 0, bl = 0;
    for (let x = a; x <= b; x++) {
      if (mask.data[y * W + x] !== CATEGORY.clothes) continue;
      const i = (y * W + x) * 4;
      r += pixels.data[i]; g += pixels.data[i + 1]; bl += pixels.data[i + 2]; n++;
    }
    rows.push(n >= Math.max(3, (b - a + 1) * 0.25) ? srgbToOklab(r / n, g / n, bl / n) : null);
  }
  // Reference colours from the garment rows that are actually visible: a
  // scoop neck, a bag or an instrument can hide any fixed band. The upper
  // piece is the first 40% of visible rows between shoulders and hips; the
  // lower piece is the middle half of visible rows between hips and ankles.
  const span = (from: number, to: number) =>
    rows.slice(Math.max(0, Math.round(from) - y0), Math.max(0, Math.round(to) - y0) + 1).filter((r): r is Lab => r !== null);
  const upper = span(shoulderY, hipY);
  const lower = span(hipY, ankleY);
  const topRows = upper.slice(0, Math.ceil(upper.length * 0.4));
  const bottomRows = lower.slice(Math.floor(lower.length * 0.25), Math.ceil(lower.length * 0.75));
  if (!topRows.length || !bottomRows.length) return "no_clothes";
  const topColour = medianLab(topRows);
  const bottomColour = medianLab(bottomRows);
  const waistRow = shoulderY + (hipY - shoulderY) * WAIST_FRACTION;

  let breakRow: number | null = null;
  if (deltaE(topColour, bottomColour) >= ONE_COLUMN_DELTA) {
    // One change point: the row that best splits the rows into "top colour"
    // above and "bottom colour" below. Ties go to the higher row.
    const lo = Math.round(shoulderY + (hipY - shoulderY) * 0.2) - y0;
    let best = Infinity;
    const hi = Math.round(kneeY) - y0;
    for (let k = Math.max(1, lo); k <= Math.min(hi, rows.length - 1); k++) {
      let cost = 0;
      for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row) cost += deltaE(row, i < k ? topColour : bottomColour);
      }
      if (cost < best) { best = cost; breakRow = y0 + k; }
    }
  }
  // Volume. The upper piece is read halfway between the shoulders and the
  // hips, within the shoulder span widened a quarter each side; it is
  // compared with the shoulder landmarks' distance. The legs are read at the
  // knee, both legs' fabric summed, against the same shoulder distance: the
  // hip line is often covered by an untucked top, the shoulders never are.
  const shoulderW = sx1 - sx0;
  const rowsAround = Math.max(1, Math.round((hipY - shoulderY) * 0.04));
  // The narrowest of three torso rows: an arm on the hip or held out widens
  // one row, rarely all three (the stylist user-sim caught an arm read as a
  // loose cut on David's Napoleon, 2026-10-04).
  const torsoRow = (f: number) => fabricAround(mask, shoulderY + (hipY - shoulderY) * f, sx0 - shoulderW * 0.25, sx1 + shoulderW * 0.25, rowsAround);
  const topW = Math.min(torsoRow(0.35), torsoRow(0.5), torsoRow(0.65));
  const reach = Math.max(hx1 - hx0, shoulderW) * 1.2;
  const kneeW = fabricAround(mask, kneeY, hx0 - reach, hx1 + reach, rowsAround);
  const fit = shoulderW > 4 && topW > shoulderW * 0.4 && kneeW > 0 ? { top: topW / shoulderW, legs: kneeW / shoulderW } : null;
  return { top, bottom, breakRow, waistRow, left: bodyX0, right: bodyX1, centerX: (px(sL) + px(sR) + px(hL) + px(hR)) / 4, topColour, bottomColour, fit };
}
