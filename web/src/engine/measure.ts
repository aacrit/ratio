// Turns what the models saw (pose landmarks and a per-pixel category mask)
// into raw measurements of an outfit. Pure: no models, no DOM. The models'
// numbers come in; plain geometry and colour statistics go out.
//
// Engine 0.7.0 (UX pass 2, 2026-10-04: Mara and Noor on two real photos):
// - Garment colours are each piece's well-lit core with the photo's
//   neutral cast taken off (garment-colour.ts), never a mean of shadow,
//   highlight and neighbouring cloth.
// - The break is the outer upper piece's hem: it is read on the flanks of
//   the body column (a zip, an open front or a t-shirt under a hoodie shows
//   in the middle, never on both flanks) and searched only from the middle
//   of the torso down, so a colour change inside the upper piece is not a
//   break.
// - The upper piece's width is read only on rows no arm or hand crosses
//   (the pose's elbows and wrists); when every row is crossed, volume is not
//   read and the read says why. Each leg is read on its own at its knee.
// - The shoes are read from boxes round each foot (ankle, heel, toe), the
//   one shoe detection the leg line, the palette and "try it" share.

import { type Lab, deltaE, srgbToOklab } from "./color";
import { type Cast, NO_CAST, neutralCast, pieceColour, uncast } from "./garment-colour";
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
   * Volume: the upper piece's fabric width on rows no arm crosses, and each
   * leg's at its knee, over the shoulder distance. Null when not read.
   */
  fit: { top: number; legs: number } | null;
  /** Why volume was not read: every torso row is crossed by an arm or a hand. */
  fitWhy?: "arms";
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
/** The break is searched from here down (a fraction of shoulders to hips): above it, a change is inside the upper piece. */
export const BREAK_FROM = 0.5;
/** The upper piece's reference colour is read between these fractions of shoulders to hips, on the flanks. */
export const TOP_REF: readonly [number, number] = [0.3, 0.5];
/** The torso rows the upper piece's width may be read on (fractions of shoulders to hips). */
export const TORSO_ROWS: readonly [number, number] = [0.25, 0.75];
/** An arm's half-width, as a share of the shoulder distance. */
export const ARM_HALF = 0.12;
/** At least this share of the torso rows must be clear of the arms for the width to be read. */
export const MIN_CLEAR = 0.15;
/** A front opening: a middle column in contrast with the flanks on at least this share of the upper piece's rows. */
export const FRONT = { delta: 0.1, rows: 0.6, half: 0.2 } as const;
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

function medianLab(rows: Lab[]): Lab {
  return { L: median(rows.map((r) => r.L)), a: median(rows.map((r) => r.a)), b: median(rows.map((r) => r.b)) };
}

function meanLab(labs: Lab[]): Lab {
  let L = 0, a = 0, b = 0;
  for (const l of labs) {
    L += l.L;
    a += l.a;
    b += l.b;
  }
  const n = labs.length || 1;
  return { L: L / n, a: a / n, b: b / n };
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

  // The photo's neutral cast, from the person's garment pixels in the figure's box.
  const pad = (bodyX1 - bodyX0) * 0.35;
  const bx0 = Math.max(0, Math.floor(bodyX0 - pad)), bx1 = Math.min(W - 1, Math.ceil(bodyX1 + pad));
  const all: Lab[] = [];
  for (let y = Math.max(0, top); y <= Math.min(H - 1, bottom); y++)
    for (let x = bx0; x <= bx1; x++) if (isGarment(mask.data[y * W + x])) all.push(labAt(x, y));
  const cast = all.length ? neutralCast(all) : NO_CAST;
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

  // Per-row garment colour. Above the hips, the two flanks of the body
  // column (5% to 35% in from each edge): the outer layer, never the middle,
  // where a zip, an open front or a t-shirt under a hoodie shows. Below the
  // hips, the hips' column widened 20% for the legs.
  const widenH = (hx1 - hx0) * 0.2;
  const y0 = Math.ceil(shoulderY);
  const y1 = Math.min(H - 1, Math.floor(ankleY));
  const rowPixels = (y: number): Lab[] => {
    const out: Lab[] = [];
    const take = (a: number, b: number) => {
      for (let x = Math.max(0, Math.floor(a)); x <= Math.min(W - 1, Math.ceil(b)); x++) if (mask.data[y * W + x] === CATEGORY.clothes) out.push(lab(x, y));
    };
    if (y < hipY) {
      const [l, r] = column(y);
      const w = r - l;
      take(l + w * 0.05, l + w * 0.35);
      take(r - w * 0.35, r - w * 0.05);
      return out.length >= Math.max(3, w * 0.6 * 0.25) ? out : [];
    }
    take(hx0 - widenH, hx1 + widenH);
    return out.length >= Math.max(3, (hx1 - hx0 + 2 * widenH) * 0.25) ? out : [];
  };
  const rowPx: Lab[][] = [];
  for (let y = y0; y <= y1; y++) rowPx.push(rowPixels(y));
  const rows: (Lab | null)[] = rowPx.map((p) => (p.length ? meanLab(p) : null));
  const idx = (y: number) => Math.round(y) - y0;
  const rowsIn = (from: number, to: number) => rows.slice(Math.max(0, idx(from)), Math.max(0, idx(to)) + 1).filter((r): r is Lab => r !== null);

  // Reference colours: the upper piece on the flanks between TOP_REF of the
  // torso; the lower piece over the middle half of the rows from hips to ankles.
  const topRef = rowsIn(shoulderY + torso * TOP_REF[0], shoulderY + torso * TOP_REF[1]);
  const lower = rowsIn(hipY, ankleY);
  const bottomRows = lower.slice(Math.floor(lower.length * 0.25), Math.ceil(lower.length * 0.75));
  if (!topRef.length || !bottomRows.length) return "no_clothes";
  const topR = medianLab(topRef);
  const bottomR = medianLab(bottomRows);
  const waistRow = shoulderY + torso * WAIST_FRACTION;

  let breakRow: number | null = null;
  if (deltaE(topR, bottomR) >= ONE_COLUMN_DELTA) {
    // One change point: the row that best splits the rows from the upper
    // reference down into "upper colour" above and "lower colour" below,
    // searched from the middle of the torso to the knee. Ties go to the higher row.
    const from = Math.max(0, idx(shoulderY + torso * TOP_REF[0]));
    const lo = Math.max(1, idx(shoulderY + torso * BREAK_FROM));
    const hi = Math.min(idx(kneeY), rows.length - 1);
    let best = Infinity;
    for (let k = lo; k <= hi; k++) {
      let cost = 0;
      for (let i = from; i < rows.length; i++) {
        const row = rows[i];
        if (row) cost += deltaE(row, i < k ? topR : bottomR);
      }
      if (cost < best) { best = cost; breakRow = y0 + k; }
    }
  }

  // The garments' colours: the well-lit core of every flank pixel of the
  // upper piece (from the upper reference to its hem), and of the lower
  // piece's middle rows.
  const hem = breakRow ?? hipY;
  const topPx = rowPx.slice(Math.max(0, idx(shoulderY + torso * TOP_REF[0])), Math.max(0, idx(hem))).flat();
  const lowerFrom = Math.max(hem, hipY);
  const lowerRows = rowPx.slice(Math.max(0, idx(lowerFrom)), Math.max(0, idx(ankleY)) + 1).filter((r) => r.length);
  const bottomPx = lowerRows.slice(Math.floor(lowerRows.length * 0.25), Math.ceil(lowerRows.length * 0.75)).flat();
  const topColour = topPx.length ? pieceColour(topPx) : topR;
  const bottomColour = bottomPx.length ? pieceColour(bottomPx) : bottomR;

  // A front opening: in the upper piece's rows (from the upper reference to
  // the hem, or the hips), a column within FRONT.half of the width either
  // side of the centre that differs from that row's flanks on most rows.
  let front = false;
  {
    const fy0 = Math.ceil(shoulderY + torso * TOP_REF[0]);
    const fy1 = Math.floor(Math.min(hem, hipY));
    const buckets = new Map<number, number>();
    let n = 0;
    for (let y = fy0; y <= fy1; y++) {
      const ref = rows[idx(y)];
      if (!ref) continue;
      n++;
      const [l, r] = column(y);
      const w = r - l, c = centreAt(y);
      const marked = new Set<number>();
      for (let x = Math.max(0, Math.floor(c - w * FRONT.half)); x <= Math.min(W - 1, Math.ceil(c + w * FRONT.half)); x++) {
        const cat = mask.data[y * W + x];
        const contrast = cat === CATEGORY.clothes ? deltaE(lab(x, y), ref) > FRONT.delta : cat !== CATEGORY.other;
        if (contrast) marked.add(Math.round(((x - c) / (w || 1)) * 40));
      }
      // A line one or two pixels wide may fall between buckets: count a bucket's neighbours.
      const near = new Set<number>();
      for (const b of marked) for (const d of [-1, 0, 1]) near.add(b + d);
      for (const b of near) buckets.set(b, (buckets.get(b) ?? 0) + 1);
    }
    for (const count of buckets.values()) if (n >= 4 && count >= n * FRONT.rows) front = true;
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
  const clear: number[] = [];
  let candidates = 0;
  for (let y = Math.ceil(shoulderY + torso * TORSO_ROWS[0]); y <= Math.floor(shoulderY + torso * TORSO_ROWS[1]); y++) {
    candidates++;
    const run = runAt(mask, y, centreAt(y), Math.max(2, Math.round(shoulderW * 0.15)));
    if (!run) continue;
    const crossed = arms.some(([a, b]) => {
      const x = crossAt(a, b, y);
      return x !== null && x >= run.x0 - armHalf && x <= run.x1 + armHalf;
    });
    if (!crossed) clear.push(run.x1 - run.x0 + 1);
  }
  const topW = clear.length >= Math.max(3, candidates * MIN_CLEAR) ? median(clear) : null;
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
  const fit = shoulderW > 4 && topW !== null && topW > shoulderW * 0.4 && legW !== null && legW > 0 ? { top: topW / shoulderW, legs: legW / shoulderW } : null;
  const fitWhy = !fit && topW === null && shoulderW > 4 && candidates > 0 ? ("arms" as const) : undefined;

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
  const cutOff = bottom >= H - 2 || !seen(aL) || !seen(aR);
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
    cast,
    ...(light ? { light } : {}),
    feet: shoesRead ? feet : [],
    ...(shoesWhy ? { shoesWhy } : {}),
    ...(front ? { front } : {}),
  };
}
