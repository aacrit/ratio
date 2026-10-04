// Turns what the models saw (pose landmarks and a per-pixel category mask)
// into raw measurements of an outfit. Pure: no models, no DOM. The models'
// numbers come in; plain geometry and colour statistics go out.
//
// Engine 0.7.0 (UX pass 2, 2026-10-04: Mara and Noor on two real photos):
// - Garment colours are each piece's well-lit core with the photo's
//   neutral cast taken off (garment-colour.ts), never a mean of shadow,
//   highlight and neighbouring cloth.
// - The break is the outer upper piece's hem: row colours are read on each
//   flank of the body column (a zip, an open front or a t-shirt under a
//   hoodie shows in the middle, or on one side, never on both), each
//   candidate break is scored against the colour of the rows above it, so a
//   crop top's high hem is found as readily as a long coat's, and a hem is
//   where both flanks change.
// - The upper piece's width is read on rows where no arm or hand lies on
//   the edge it would widen (the pose's elbows and wrists); with one clean
//   edge it is read on that side and marked borderline; when no row is
//   clean, volume is not read and the read says why. Each leg is read on
//   its own at its knee, and the legs are said even when the upper piece
//   is not read.
// - The shoes are read from boxes round each foot (ankle, heel, toe), the
//   one shoe detection the leg line, the palette and "try it" share.

import { type Lab, deltaE, hueGap, srgbToOklab } from "./color";
import { type Cast, neutralCast, pieceColour, uncast } from "./garment-colour";
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
export const POSE = {
  nose: 0,
  lShoulder: 11,
  rShoulder: 12,
  lElbow: 13,
  rElbow: 14,
  lWrist: 15,
  rWrist: 16,
  lHip: 23,
  rHip: 24,
  lKnee: 25,
  rKnee: 26,
  lAnkle: 27,
  rAnkle: 28,
  lHeel: 29,
  rHeel: 30,
  lToe: 31,
  rToe: 32,
} as const;

export interface Mask {
  width: number;
  height: number;
  /** One category per pixel, row-major, same size as the pixels. */
  data: Uint8Array;
}

/** A box round one foot where the shoe is read, in pixels (inclusive). */
export interface FootBox {
  x0: number;
  x1: number;
  y0: number;
  y1: number;
}

/** Why the shoes were not read: the frame cuts them off, or the segmenter could not tell them from the floor. */
export type ShoesWhy = "cut_off" | "floor";

export interface OutfitMeasure {
  /** Figure extent in pixel rows: top of the head to the lowest point of the feet. */
  top: number;
  bottom: number;
  /** The row of the outer upper piece's hem (top garment to bottom garment), or null for one colour column. */
  breakRow: number | null;
  /** Estimated natural-waist row (from shoulder and hip landmarks). */
  waistRow: number;
  /** The body's column in pixels (shoulders and hips) and its centre line, for drawing. Not read by any rule. */
  left: number;
  right: number;
  centerX: number;
  /** The colour of the upper and lower garments: each one's well-lit core, cast removed (OKLab). */
  topColour: Lab;
  bottomColour: Lab;
  /**
   * Volume: the upper piece's fabric width on rows no arm spoils, and each
   * leg's at its knee, over the shoulder distance. Either may be null on its
   * own; null when neither was read.
   */
  fit: { top: number | null; legs: number | null } | null;
  /** Why the upper piece's width was not read: an arm or a hand lay on its edges on every row. */
  fitWhy?: "arms";
  /** The upper piece's width was read from one clean edge only (doubled about the centre line): borderline. */
  fitOneSide?: true;
  /** The photo's neutral cast, taken off every garment colour. */
  cast?: Cast;
  /** The backdrop's colour round the person (OKLab a, b), when it is a strongly coloured light or wall (LIGHT_CHROMA or more). */
  light?: Cast;
  /** Where the shoes were read; empty when they were not. */
  feet?: FootBox[];
  /** Why the shoes were not read, when they were not. */
  shoesWhy?: ShoesWhy;
  /** True when the upper piece opens or zips down the front (a vertical line or panel in the middle, not on the flanks). */
  front?: boolean;
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
/** A break needs at least this share of the shoulders-to-hips distance of upper piece above it (the collar's rows are not a garment). */
export const BREAK_MIN_ROWS = 0.15;
/**
 * The distance a hem is read in: hue and chroma count 2.5 times, lightness
 * half. Light falling off a dark jacket changes lightness row by row; a hem
 * changes the cloth (black jacket over plum, p1 of UX pass 2).
 */
export function hemDistance(p: Lab, q: Lab): number {
  const dL = (p.L - q.L) * 0.5, da = (p.a - q.a) * 2.5, db = (p.b - q.b) * 2.5;
  return Math.sqrt(dL * dL + da * da + db * db);
}
/** A hem is an edge: the rows within this share of the figure's height above and below it must differ. */
export const EDGE_WINDOW = 0.03;
/** Row colours above the hips are read on each flank of the body column, between these shares of its width in from the edge. */
export const FLANK: readonly [number, number] = [0.05, 0.35];
/** The torso rows the upper piece's width may be read on (fractions of shoulders to hips). */
export const TORSO_ROWS: readonly [number, number] = [0.25, 0.75];
/** The upper piece's widths, row to row, may spread (quartile to quartile) by at most this share of their median. */
export const WIDTH_SPREAD = 0.25;
/** An arm's half-width, as a share of the shoulder distance. */
export const ARM_HALF = 0.12;
/** At least this share of the torso rows must be clear of the arms for the width to be read. */
export const MIN_CLEAR = 0.15;
/**
 * A front opening: on the rows whose flanks are one even colour (spread
 * under `delta`), a narrow line (at most `line` of the width) within `half`
 * of the centre that differs from the flanks by more than `delta`, running
 * on through at least `rows` of the upper piece's height (drifting at most
 * `drift` of the width, hidden for at most `gap` of the figure's height). Stripes, checks and prints have uneven flanks and
 * are never read as an opening.
 */
export const FRONT = { delta: 0.1, rows: 0.6, half: 0.2, line: 0.08, drift: 0.03, gap: 0.04 } as const;
/** How near a cloth's hue must sit to a coloured backdrop's to count as its light. */
export const LIGHT_HUE = 30;
/** A backdrop at least this chromatic (OKLCH chroma) is a coloured light or wall: its hue on the cloth is the light's. */
export const LIGHT_CHROMA = 0.08;
/** The shoe box starts this far from the ankle to the sole: above it, a trouser hem often bunches over the shoe. */
export const SHOE_FROM = 0.4;

const isPerson = (c: number) => c !== CATEGORY.background;
const isGarment = (c: number) => c === CATEGORY.clothes || c === CATEGORY.other;

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/** A row's colour: each channel's mean after trimming ROW_TRIM of its values from each end. */
export const ROW_TRIM = 0.2;
function trimmedLab(px: Lab[]): Lab {
  const t = (vs: number[]) => {
    const s = [...vs].sort((a, b) => a - b);
    const cut = Math.floor(s.length * ROW_TRIM);
    const kept = s.length - 2 * cut > 0 ? s.slice(cut, s.length - cut) : s;
    let sum = 0;
    for (const v of kept) sum += v;
    return sum / kept.length;
  };
  return { L: t(px.map((p) => p.L)), a: t(px.map((p) => p.a)), b: t(px.map((p) => p.b)) };
}

function medianLab(rows: Lab[]): Lab {
  return { L: median(rows.map((r) => r.L)), a: median(rows.map((r) => r.a)), b: median(rows.map((r) => r.b)) };
}


/** The contiguous run of garment pixels in a row through x (or the nearest garment pixel within `slack`), or null. */
export function runAt(mask: Mask, y: number, x: number, slack: number): { x0: number; x1: number } | null {
  const W = mask.width;
  const row = Math.round(y);
  if (row < 0 || row >= mask.height) return null;
  const at = (i: number) => i >= 0 && i < W && isGarment(mask.data[row * W + i]);
  let c = Math.round(x);
  if (!at(c)) {
    let found = -1;
    for (let d = 1; d <= slack && found < 0; d++) {
      if (at(c - d)) found = c - d;
      else if (at(c + d)) found = c + d;
    }
    if (found < 0) return null;
    c = found;
  }
  let x0 = c, x1 = c;
  while (at(x0 - 1)) x0--;
  while (at(x1 + 1)) x1++;
  return { x0, x1 };
}

type P = { x: number; y: number };

/** Where a segment crosses row y, or null when it does not span it. */
function crossAt(a: P, b: P, y: number): number | null {
  const lo = Math.min(a.y, b.y), hi = Math.max(a.y, b.y);
  if (y < lo || y > hi) return null;
  if (hi - lo < 1e-9) return (a.x + b.x) / 2;
  return a.x + ((b.x - a.x) * (y - a.y)) / (b.y - a.y);
}

export function measureOutfit(pixels: Pixels, mask: Mask, pose: Landmark[]): OutfitMeasure | MeasureFailure {
  if (pose.length < 29) return "no_figure";
  const { width: W, height: H } = mask;
  const px = (l: Landmark) => l.x * W;
  const py = (l: Landmark) => l.y * H;
  const pt = (i: number): P => ({ x: px(pose[i]), y: py(pose[i]) });
  const sL = pose[POSE.lShoulder], sR = pose[POSE.rShoulder];
  const hL = pose[POSE.lHip], hR = pose[POSE.rHip];
  const kL = pose[POSE.lKnee], kR = pose[POSE.rKnee];
  const aL = pose[POSE.lAnkle], aR = pose[POSE.rAnkle];
  const seen = (l: Landmark | undefined) => !!l && (l.visibility ?? 1) >= VISIBLE;
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
  const torso = hipY - shoulderY;
  const shoulderW = sx1 - sx0;

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

  // Pixels in OKLab, converted once per distinct colour.
  const cache = new Map<number, Lab>();
  const labAt = (x: number, y: number): Lab => {
    const i = (y * W + x) * 4;
    const key = (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
    let lab = cache.get(key);
    if (!lab) {
      lab = srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
      cache.set(key, lab);
    }
    return lab;
  };

  // The photo's neutral cast, from the person's garment pixels in the
  // figure's box: the upper garments (above the hips) and the lower must agree.
  const pad = (bodyX1 - bodyX0) * 0.35;
  const bx0 = Math.max(0, Math.floor(bodyX0 - pad)), bx1 = Math.min(W - 1, Math.ceil(bodyX1 + pad));
  const upperPx: Lab[] = [], lowerPx: Lab[] = [];
  for (let y = Math.max(0, top); y <= Math.min(H - 1, bottom); y++)
    for (let x = bx0; x <= bx1; x++) if (isGarment(mask.data[y * W + x])) (y < hipY ? upperPx : lowerPx).push(labAt(x, y));
  const cast = neutralCast(upperPx, lowerPx);
  // The backdrop round the person: a coloured stage or wall tints the cloth
  // that faces it (palette.ts drops a swatch of that hue that is not a piece).
  const bgA: number[] = [], bgB: number[] = [];
  for (let y = Math.max(0, top); y <= Math.min(H - 1, bottom); y++)
    for (let x = bx0; x <= bx1; x++)
      if (mask.data[y * W + x] === CATEGORY.background) {
        const l = labAt(x, y);
        bgA.push(l.a);
        bgB.push(l.b);
      }
  const bg = { a: median(bgA), b: median(bgB) };
  const light = bgA.length && Math.sqrt(bg.a * bg.a + bg.b * bg.b) >= LIGHT_CHROMA ? bg : undefined;
  // A coloured backdrop lights the cloth facing it (a blue stage on a black
  // hoodie's shoulders). While such pixels are the smaller part of the
  // person's garments, they are left out of every row and piece colour, so
  // the light can neither make a hem nor colour a piece.
  const lightH = light ? (Math.atan2(light.b, light.a) * 180) / Math.PI : 0;
  const isLit = (l: Lab) => !!light && Math.sqrt(l.a * l.a + l.b * l.b) >= 0.04 && hueGap((Math.atan2(l.b, l.a) * 180) / Math.PI, lightH) <= LIGHT_HUE;
  const dropLit = !!light && [...upperPx, ...lowerPx].filter(isLit).length < (upperPx.length + lowerPx.length) / 2;
  const lab = (x: number, y: number) => uncast(labAt(x, y), cast);

  // The body column at a row: the flank lines from the shoulders to the
  // hips, then the hips' column for the legs.
  const column = (y: number): [number, number] => {
    const t = Math.max(0, Math.min(1, (y - shoulderY) / (torso || 1)));
    return [sx0 + (hx0 - sx0) * t, sx1 + (hx1 - sx1) * t];
  };
  const centreAt = (y: number) => {
    const [l, r] = column(y);
    return (l + r) / 2;
  };

  // Per-row garment colour, on each flank of the body column separately
  // (FLANK of its width in from each edge above the hips): the outer layer,
  // never the middle, where a zip, an open front or a t-shirt under a
  // hoodie shows. Below the hips, the hips' column widened 20% for the legs,
  // as one. Each row's colour is its pixels' well-lit core (coreColour), so
  // a stripe reads as its lighter cloth on every row instead of flipping
  // between its colours (a per-channel median read a false hem at 0.32 in
  // navy and white stripes, review round 3), and a stray thread cannot move it.
  const widenH = (hx1 - hx0) * 0.2;
  const y0 = Math.ceil(shoulderY);
  const y1 = Math.min(H - 1, Math.floor(ankleY));
  const take = (y: number, a: number, b: number, out: Lab[]) => {
    for (let x = Math.max(0, Math.floor(a)); x <= Math.min(W - 1, Math.ceil(b)); x++) {
      if (mask.data[y * W + x] !== CATEGORY.clothes) continue;
      const l = lab(x, y);
      if (!dropLit || !isLit(l)) out.push(l);
    }
  };
  const sidePx: [Lab[], Lab[]][] = [];
  for (let y = y0; y <= y1; y++) {
    const left: Lab[] = [], right: Lab[] = [];
    if (y < hipY) {
      const [l, r] = column(y);
      const w = r - l;
      take(y, l + w * FLANK[0], l + w * FLANK[1], left);
      take(y, r - w * FLANK[1], r - w * FLANK[0], right);
      const enough = Math.max(2, w * (FLANK[1] - FLANK[0]) * 0.25);
      sidePx.push([left.length >= enough ? left : [], right.length >= enough ? right : []]);
    } else {
      take(y, hx0 - widenH, hx1 + widenH, left);
      const ok = left.length >= Math.max(3, (hx1 - hx0 + 2 * widenH) * 0.25);
      sidePx.push([ok ? left : [], ok ? left : []]);
    }
  }
  const rowPx: Lab[][] = sidePx.map(([l, r]) => (l === r ? l : [...l, ...r]));
  const rows: (Lab | null)[] = rowPx.map((p) => (p.length ? medianLab(p) : null));
  // Each flank's rows twice over. Where a hem may be is decided on rows that
  // blend a pattern: above the hips the narrow flank bands catch vertical
  // stripes in a phase that shifts as the figure tapers, so a per-channel
  // median flips between the stripes' colours and draws false hems (navy
  // and white stripes read 0.32, review round 3); their trimmed mean
  // (trimmedLab) blends them. Below the hips the leg column is wide and its
  // median is the cloth's own colour. The median rows (the cloth's own
  // colour, so a fold or a seam cannot drag it) place the hem.
  const sideRows: (Lab | null)[][] = [0, 1].map((k) => sidePx.map((p, i) => (p[k].length ? (y0 + i < hipY ? trimmedLab(p[k]) : medianLab(p[k])) : null)));
  const sideMedians: (Lab | null)[][] = [0, 1].map((k) => sidePx.map((p) => (p[k].length ? medianLab(p[k]) : null)));
  const idx = (y: number) => Math.round(y) - y0;
  const rowsIn = (from: number, to: number) => rows.slice(Math.max(0, idx(from)), Math.max(0, idx(to)) + 1).filter((r): r is Lab => r !== null);

  // The lower piece's reference: the middle half of the rows from the hips
  // to the ankles.
  const lower = rowsIn(hipY, ankleY);
  const bottomRows = lower.slice(Math.floor(lower.length * 0.25), Math.ceil(lower.length * 0.75));
  if (!rows.some((r) => r !== null) || !bottomRows.length) return "no_clothes";
  const bottomR = medianLab(bottomRows);
  const waistRow = shoulderY + torso * WAIST_FRACTION;

  // The break: one change point, the row that best splits each flank's rows
  // into "the colour of that flank's rows above it" and "the lower piece's
  // colour", searched from BREAK_MIN_ROWS below the shoulders to the knee.
  // Each candidate's upper colour is the median of the rows above it, so a
  // crop top's hem high on the figure is found as readily as a coat's. A
  // break is a hem only when both flanks change there: a t-shirt showing on
  // one side of an open hoodie (p2 of UX pass 2) is not a hem. When either
  // flank's upper colour at the best split sits within ONE_COLUMN_DELTA of
  // the lower piece's, the outfit is one column. Ties go to the higher row.
  const first = rows.findIndex((r) => r !== null);
  const lo = Math.max(first + 1, idx(shoulderY + torso * BREAK_MIN_ROWS));
  const hi = Math.min(idx(kneeY), rows.length - 1);
  const sides = sideMedians.map((sr) => {
    const errBottom = sr.map((r) => (r ? hemDistance(r, bottomR) : 0));
    const tail: number[] = new Array(sr.length + 1).fill(0);
    for (let i = sr.length - 1; i >= 0; i--) tail[i] = tail[i + 1] + errBottom[i];
    return { sr, tail };
  });
  // A hem is an edge: on both flanks the rows just above a candidate and
  // the rows just below it must differ by ONE_COLUMN_DELTA, so the light
  // falling off a dark jacket's shoulders (p1) is never a hem, however the
  // costs fall.
  const win = Math.max(3, Math.round((bottom - top) * EDGE_WINDOW));
  // The nearest `win` rows with a colour on each side of k (skin between a
  // crop top and its trousers has none, and is stepped over).
  const near = (sr: (Lab | null)[], k: number, step: 1 | -1) => {
    const out: Lab[] = [];
    for (let i = step > 0 ? k : k - 1; i >= 0 && i < sr.length && out.length < win; i += step) {
      const r = sr[i];
      if (r) out.push(r);
    }
    return out;
  };
  const edgeAt = (k: number) =>
    sideRows.every((sr) => {
      const up = near(sr, k, -1), down = near(sr, k, 1);
      return up.length > 0 && down.length > 0 && hemDistance(medianLab(up), medianLab(down)) >= ONE_COLUMN_DELTA;
    });
  let breakRow: number | null = null;
  let refs: Lab[] = [];
  let best = Infinity;
  for (let k = lo; k <= hi; k++) {
    if (!edgeAt(k)) continue;
    let cost = 0;
    const ks: Lab[] = [];
    for (const { sr, tail } of sides) {
      const above = sr.slice(first, k).filter((r): r is Lab => r !== null);
      if (!above.length) continue;
      const ref = medianLab(above);
      ks.push(ref);
      cost += tail[k];
      for (const r of above) cost += hemDistance(r, ref);
    }
    if (ks.length && cost < best - 1e-12) {
      best = cost;
      breakRow = y0 + k;
      refs = ks;
    }
  }
  if (breakRow !== null && (refs.length < 2 || refs.some((r) => hemDistance(r, bottomR) < ONE_COLUMN_DELTA))) breakRow = null;
  const topR = breakRow !== null ? medianLab(rowsIn(shoulderY, breakRow - 1)) : medianLab(rows.filter((r): r is Lab => r !== null));

  // The garments' colours: the well-lit core of every edge pixel of the
  // upper piece (from the shoulders to its hem), and of the lower piece's
  // middle rows.
  const hem = breakRow ?? hipY;
  const topPx = rowPx.slice(Math.max(0, first), Math.max(0, idx(hem))).flat();
  const lowerFrom = Math.max(hem, hipY);
  const lowerRows = rowPx.slice(Math.max(0, idx(lowerFrom)), Math.max(0, idx(ankleY)) + 1).filter((r) => r.length);
  const bottomPx = lowerRows.slice(Math.floor(lowerRows.length * 0.25), Math.ceil(lowerRows.length * 0.75)).flat();
  const topColour = topPx.length ? pieceColour(topPx) : topR;
  const bottomColour = bottomPx.length ? pieceColour(bottomPx) : bottomR;

  // A front opening (FRONT): a narrow line down the middle of the upper
  // piece, in contrast with even flanks, continuous from row to row.
  let front = false;
  {
    const fy0 = y0 + Math.max(0, first);
    const fy1 = Math.floor(Math.min(hem, hipY)) - 1;
    // For each row: the narrow contrasting runs' centres, relative to the width.
    const lines: { y: number; at: number[] }[] = [];
    for (let y = fy0; y <= fy1; y++) {
      const ref = rows[idx(y)];
      const edges = rowPx[idx(y)];
      if (!ref || !edges?.length) continue;
      // Flanks one even cloth: the 90th percentile of their spread, read as a
      // hem is (shading counts half, a change of cloth in full), under FRONT.delta.
      const spread = edges.map((l) => hemDistance(l, ref)).sort((a, b) => a - b);
      if (spread[Math.floor((spread.length - 1) * 0.9)] >= FRONT.delta) continue;
      // The body column from the pose: a neighbour's sleeve touching the run
      // must not move the centre the line is looked for round.
      const [cl, cr] = column(y);
      const w = cr - cl, c = (cl + cr) / 2;
      const found: number[] = [];
      let startX = -1;
      const x0 = Math.max(0, Math.floor(c - w * FRONT.half)), x1 = Math.min(W - 1, Math.ceil(c + w * FRONT.half));
      for (let x = x0; x <= x1 + 1; x++) {
        const marked = x <= x1 && (mask.data[y * W + x] === CATEGORY.clothes ? deltaE(lab(x, y), ref) > FRONT.delta : mask.data[y * W + x] !== CATEGORY.other);
        if (marked && startX < 0) startX = x;
        if (!marked && startX >= 0) {
          // A line whose colour also shows in the flanks is a pattern (a pinstripe), not an opening.
          const narrow = x - startX <= Math.max(3, w * FRONT.line) && startX > x0 && x <= x1;
          const lineLab = narrow && mask.data[y * W + startX] === CATEGORY.clothes ? lab(startX, y) : null;
          const inFlanks = lineLab ? edges.filter((l) => deltaE(l, lineLab) < FRONT.delta).length > edges.length * 0.03 : false;
          if (narrow && !inFlanks) found.push((startX + x - 1) / 2 / w - c / w);
          startX = -1;
        }
      }
      lines.push({ y, at: found });
    }
    // The longest chain of lines down the rows: each within FRONT.drift (per
    // row apart) of a line at most `gap` rows above it, so a hand or a fold
    // may hide it for a while. A front opening runs through FRONT.rows of
    // the upper piece's height, and shows on at least a third of its rows.
    const gap = Math.max(3, Math.round((bottom - top) * FRONT.gap));
    const nodes: { y: number; at: number; len: number; from: number }[] = [];
    let best = { len: 0, span: 0 };
    for (const row of lines)
      for (const at of row.at) {
        let link: (typeof nodes)[number] | null = null;
        for (const n of nodes) if (row.y - n.y <= gap && row.y > n.y && Math.abs(n.at - at) <= FRONT.drift * (1 + (row.y - n.y) / 4) && (!link || n.len > link.len)) link = n;
        const node = { y: row.y, at, len: (link?.len ?? 0) + 1, from: link?.from ?? row.y };
        nodes.push(node);
        if (node.len > best.len) best = { len: node.len, span: row.y - node.from + 1 };
      }
    const height = Math.max(1, fy1 - fy0 + 1);
    front = lines.length >= 4 && best.span >= height * FRONT.rows && best.len >= lines.length / 3;
  }

  // Volume. The upper piece: on each torso row, the run of garment pixels
  // through the body's centre, over the shoulder distance. A row counts only
  // when no arm (shoulder to elbow to wrist, and the hand past the wrist)
  // crosses that run: an arm against the side or a hand in a pocket widens
  // the run with a sleeve, not the cut (Mara, 2026-10-04).
  const arms: [P, P][] = [];
  for (const [s, e, w] of [[POSE.lShoulder, POSE.lElbow, POSE.lWrist], [POSE.rShoulder, POSE.rElbow, POSE.rWrist]] as const) {
    if (!seen(pose[e])) continue;
    arms.push([pt(s), pt(e)]);
    if (!seen(pose[w])) continue;
    const el = pt(e), wr = pt(w);
    arms.push([el, wr], [wr, { x: wr.x + (wr.x - el.x) * 0.35, y: wr.y + (wr.y - el.y) * 0.35 }]);
  }
  const armHalf = shoulderW * ARM_HALF;
  // An arm spoils only the edge on its side: an arm whose line (the pose's
  // shoulder, elbow, wrist and hand) crosses the row anywhere from 1 armHalf
  // outside an edge to the centre line spoils that edge (an arm hanging
  // clear of the side by a small gap leaves the edge clean). A sleeve against
  // the side widens the run by its own width (the landmark sits near its
  // middle), and an arm inside the run means the run's edge beyond it is
  // not the torso's (a neighbour's sleeve, a bag, the hand in a pocket:
  // p1 of UX pass 2). With both edges clean the width is the
  // run; with one, twice its distance from the centre line (borderline).
  const both: number[] = [];
  const oneSide: number[] = [];
  let candidates = 0;
  let spoiled = 0;
  for (let y = Math.ceil(shoulderY + torso * TORSO_ROWS[0]); y <= Math.floor(shoulderY + torso * TORSO_ROWS[1]); y++) {
    candidates++;
    const run = runAt(mask, y, centreAt(y), Math.max(2, Math.round(shoulderW * 0.15)));
    if (!run) continue;
    const xs = arms.map(([a, b]) => crossAt(a, b, y)).filter((x): x is number => x !== null);
    const c = centreAt(y);
    const leftBad = xs.some((x) => x >= run.x0 - armHalf && x <= c);
    const rightBad = xs.some((x) => x >= c && x <= run.x1 + armHalf);
    if (leftBad || rightBad) spoiled++;
    if (!leftBad && !rightBad) both.push(run.x1 - run.x0 + 1);
    else if (!leftBad) oneSide.push(2 * Math.abs(centreAt(y) - run.x0) + 1);
    else if (!rightBad) oneSide.push(2 * Math.abs(run.x1 - centreAt(y)) + 1);
  }
  const need = Math.max(3, candidates * MIN_CLEAR);
  // Widths that disagree from row to row (a quartile spread past WIDTH_SPREAD
  // of their median) are not one garment's cut: a hand in a pocket or a
  // neighbour's sleeve is in some of them (p1 of UX pass 2). Not read.
  const steady = (ws: number[]) => {
    const s = [...ws].sort((a, b) => a - b);
    const q = (f: number) => s[Math.min(s.length - 1, Math.floor((s.length - 1) * f))];
    return q(0.75) - q(0.25) <= median(ws) * WIDTH_SPREAD;
  };
  const pick = both.length >= need ? both : both.length + oneSide.length >= need ? [...both, ...oneSide] : null;
  const topW = pick && steady(pick) ? median(pick) : null;
  const fitOneSide = topW !== null && both.length < need;
  // Each leg at its own knee: the run of garment pixels through the knee,
  // the median over a few rows. When both knees fall in one run (a skirt, a
  // dress, legs together), each leg is half of it.
  const span = Math.max(1, Math.round(torso * 0.04));
  const legRuns = [kL, kR].filter(seen).map((k) => {
    const rs: { x0: number; x1: number }[] = [];
    for (let d = -span; d <= span; d++) {
      const r = runAt(mask, py(k) + d, px(k), Math.max(2, Math.round(shoulderW * 0.1)));
      if (r) rs.push(r);
    }
    return rs.length > span ? { x0: median(rs.map((r) => r.x0)), x1: median(rs.map((r) => r.x1)) } : null;
  });
  let legW: number | null = null;
  if (legRuns.length && legRuns.every((r) => r !== null)) {
    const rs = legRuns as { x0: number; x1: number }[];
    // The two knees' runs overlap when one piece of fabric holds both (each knee is read on its own rows).
    const joint = rs.length === 2 && rs[0].x0 <= rs[1].x1 && rs[1].x0 <= rs[0].x1;
    legW = joint ? (Math.max(rs[0].x1, rs[1].x1) - Math.min(rs[0].x0, rs[1].x0) + 1) / 2 : rs.reduce((t, r) => t + (r.x1 - r.x0 + 1), 0) / rs.length;
  }
  const fitTop = shoulderW > 4 && topW !== null && topW > shoulderW * 0.4 ? topW / shoulderW : null;
  const fitLegs = shoulderW > 4 && legW !== null && legW > 0 ? legW / shoulderW : null;
  const fit = fitTop !== null || fitLegs !== null ? { top: fitTop, legs: fitLegs } : null;
  // Said only when an arm really spoiled the rows that would have been read.
  const fitWhy = fitTop === null && spoiled > 0 && spoiled >= candidates - need ? ("arms" as const) : undefined;

  // The shoes: a box round each visible foot, from SHOE_FROM of the way from the ankle
  // to the figure's lowest row, as wide as the foot's landmarks (ankle,
  // heel, toe) padded by a tenth of the shoulder distance.
  const footPad = Math.max(2, shoulderW * 0.1);
  const feet: FootBox[] = [];
  for (const [a, h, t] of [[POSE.lAnkle, POSE.lHeel, POSE.lToe], [POSE.rAnkle, POSE.rHeel, POSE.rToe]] as const) {
    if (!seen(pose[a])) continue;
    const xs = [a, h, t].filter((i) => seen(pose[i])).map((i) => px(pose[i]));
    const ys = [a, h, t].filter((i) => seen(pose[i])).map((i) => py(pose[i]));
    const ay = py(pose[a]);
    const footBottom = Math.max(bottom, ...ys);
    feet.push({
      x0: Math.max(0, Math.floor(Math.min(...xs) - footPad)),
      x1: Math.min(W - 1, Math.ceil(Math.max(...xs) + footPad)),
      y0: Math.max(0, Math.round(ay + (footBottom - ay) * SHOE_FROM)),
      y1: Math.min(H - 1, Math.round(footBottom)),
    });
  }
  let shoePx = 0;
  for (const f of feet) for (let y = f.y0; y <= f.y1; y++) for (let x = f.x0; x <= f.x1; x++) if (isGarment(mask.data[y * W + x])) shoePx++;
  // A figure that runs to the frame's foot has its shoes cut off: whatever
  // lies in the boxes then may be a trouser leg, so the shoes are not read.
  // With one ankle out of sight the visible foot is read.
  const cutOff = bottom >= H - 2 || (!seen(aL) && !seen(aR));
  const shoesRead = !cutOff && shoePx >= Math.max(6, shoulderW * shoulderW * 0.01);
  const shoesWhy = shoesRead ? undefined : cutOff ? ("cut_off" as const) : ("floor" as const);

  return {
    top,
    bottom,
    breakRow,
    waistRow,
    left: bodyX0,
    right: bodyX1,
    centerX: (px(sL) + px(sR) + px(hL) + px(hR)) / 4,
    topColour,
    bottomColour,
    fit,
    ...(fitWhy ? { fitWhy } : {}),
    ...(fitOneSide && fitTop !== null ? { fitOneSide: true as const } : {}),
    cast,
    ...(light ? { light } : {}),
    feet: shoesRead ? feet : [],
    ...(shoesWhy ? { shoesWhy } : {}),
    ...(front ? { front } : {}),
  };
}
