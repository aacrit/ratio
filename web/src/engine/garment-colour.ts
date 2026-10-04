// What colour a garment is, the way a stylist reads it: from its
// representative well-lit pixels, not an average of everything the camera
// caught (Mara, UX pass 2, 2026-10-04: plum trousers read as chroma 0.02 and
// coral sneakers as 0.05, so a saturated outfit counted as quiet).
//
// Two causes, both fixed here:
// - A plain mean in OKLab mixes shadow, highlight and neighbouring cloth.
//   Shadows carry little chroma, and two hues averaged together cancel in
//   the a/b plane (a black jacket's cool cast against plum trousers' warm
//   red cancelled to grey). A garment's colour is the median of its
//   mid-to-lit lightness core (CORE), its hue the direction of that core's
//   summed a/b, and its chroma the median of each core pixel's chroma
//   projected onto that hue, so a stray hue can only lower it and noise
//   around a grey never adds up to a colour.
// - A coloured light (a blue stage, a cyan gym) tints every garment alike.
//   The photo's neutral cast is the median a/b of the person's near-neutral
//   garment pixels; it is taken off every garment colour before any rule
//   reads it, so a uniform tint cannot create a hue (CAST).
//
// Pure and deterministic: fixed order, sorts with stable ties, sums in
// pixel order, Math.sqrt only (no Math.hypot), as person.ts.

import type { Lab } from "./color";

/** The lightness core a garment's colour is read from, as quantiles of its pixels' lightness: past the deep shadows, short of blown highlights. */
export const CORE: readonly [number, number] = [0.5, 0.95];

/**
 * The neutral cast. Pixels below `poolChroma` form the near-neutral pool; the
 * cast is the pool's median a and b, when the pool holds at least `minPool`
 * of the garment pixels, and it is never longer than `max` (a stronger tint
 * is a colour, not a light).
 */
export const CAST = { poolChroma: 0.04, minPool: 0.2, max: 0.03 } as const;

export interface Cast {
  a: number;
  b: number;
}

export const NO_CAST: Cast = { a: 0, b: 0 };

function median(values: number[]): number {
  if (!values.length) return 0;
  const s = [...values].sort((x, y) => x - y);
  const m = s.length >> 1;
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

const chroma = (l: Lab) => Math.sqrt(l.a * l.a + l.b * l.b);

/** The photo's neutral cast from a set of garment pixels (OKLab). */
export function neutralCast(labs: readonly Lab[]): Cast {
  const pool = labs.filter((l) => chroma(l) < CAST.poolChroma);
  if (!labs.length || pool.length < labs.length * CAST.minPool) return NO_CAST;
  const a = median(pool.map((l) => l.a));
  const b = median(pool.map((l) => l.b));
  const len = Math.sqrt(a * a + b * b);
  if (len <= CAST.max) return { a, b };
  return { a: (a / len) * CAST.max, b: (b / len) * CAST.max };
}

/** A pixel with the photo's cast taken off. */
export const uncast = (l: Lab, cast: Cast): Lab => (cast.a === 0 && cast.b === 0 ? l : { L: l.L, a: l.a - cast.a, b: l.b - cast.b });

/**
 * A garment's colour from its pixels (already uncast): the lightness core's
 * median lightness, the core's hue, and the median chroma along that hue.
 */
export function coreColour(labs: readonly Lab[]): Lab {
  if (!labs.length) return { L: 0, a: 0, b: 0 };
  const ls = labs.map((l) => l.L).sort((x, y) => x - y);
  const lo = ls[Math.floor((ls.length - 1) * CORE[0])];
  const hi = ls[Math.ceil((ls.length - 1) * CORE[1])];
  const core = labs.filter((l) => l.L >= lo && l.L <= hi);
  const L = median(core.map((l) => l.L));
  let sa = 0, sb = 0;
  for (const l of core) {
    sa += l.a;
    sb += l.b;
  }
  const len = Math.sqrt(sa * sa + sb * sb);
  if (len < 1e-12) return { L, a: 0, b: 0 };
  const ca = sa / len, cb = sb / len;
  const C = Math.max(0, median(core.map((l) => l.a * ca + l.b * cb)));
  return { L, a: C * ca, b: C * cb };
}

// ---- Clustering ----------------------------------------------------------------

/** How much more a step in a or b counts than a step in lightness when clustering: pixels split by hue, not only by lightness. */
export const CHROMA_WEIGHT = 2.5;
const PASSES = 8;

const K = CHROMA_WEIGHT;
/** Squared distance in the weighted space. */
const dist2 = (p: Lab, q: Lab) => (p.L - q.L) * (p.L - q.L) + K * K * ((p.a - q.a) * (p.a - q.a) + (p.b - q.b) * (p.b - q.b));
const scaleOf = (key: keyof Lab) => (key === "L" ? 1 : K);

function mean(labs: Lab[]): Lab {
  const n = labs.length || 1;
  let L = 0, a = 0, b = 0;
  for (const l of labs) {
    L += l.L;
    a += l.a;
    b += l.b;
  }
  return { L: L / n, a: a / n, b: b / n };
}

function medianCut(px: readonly { lab: Lab }[], k: number): Lab[] {
  let boxes: { lab: Lab }[][] = [[...px]];
  while (boxes.length < k) {
    // Split the box with the widest (weighted) channel range at that channel's median.
    let best = -1, bestRange = 0, bestKey: keyof Lab = "L";
    boxes.forEach((box, i) => {
      if (box.length < 2) return;
      for (const key of ["L", "a", "b"] as const) {
        let lo = Infinity, hi = -Infinity;
        for (const p of box) { lo = Math.min(lo, p.lab[key]); hi = Math.max(hi, p.lab[key]); }
        const range = (hi - lo) * scaleOf(key);
        if (range > bestRange) { bestRange = range; best = i; bestKey = key; }
      }
    });
    if (best < 0) break;
    const sorted = [...boxes[best]].sort((p, q) => p.lab[bestKey] - q.lab[bestKey]);
    const mid = sorted.length >> 1;
    boxes = [...boxes.slice(0, best), sorted.slice(0, mid), sorted.slice(mid), ...boxes.slice(best + 1)];
  }
  return boxes.map((box) => mean(box.map((p) => p.lab)));
}

function nearest(lab: Lab, centres: Lab[]): number {
  let best = 0, d = Infinity;
  centres.forEach((c, i) => {
    const e = dist2(lab, c);
    if (e < d) { d = e; best = i; }
  });
  return best;
}

/** Clusters pixels into at most k groups (weighted OKLab k-means from a median cut); returns each group's member indices. */
export function cluster(px: readonly { lab: Lab }[], k: number): number[][] {
  if (!px.length) return [];
  let centres = medianCut(px, k);
  let assign = new Uint8Array(px.length);
  for (let pass = 0; pass < PASSES; pass++) {
    assign = Uint8Array.from(px, (p) => nearest(p.lab, centres));
    centres = centres.map((c, i) => {
      const members = px.filter((_, j) => assign[j] === i).map((p) => p.lab);
      return members.length ? mean(members) : c;
    });
  }
  const groups: number[][] = centres.map(() => []);
  assign.forEach((g, j) => groups[g].push(j));
  return groups.filter((g) => g.length > 0);
}

/** A piece holds a colour, not only its shadow, when this share of its pixels form a chromatic cluster. */
export const PIECE_COLOUR_SHARE = 0.25;
/** A cluster whose core reaches this chroma is chromatic, for PIECE_COLOUR_SHARE. */
export const PIECE_CHROMA = 0.04;

/**
 * A garment piece's colour from its pixels (uncast). Dyed cloth in shadow
 * is near black (plum trousers in shade measure as black jacket does), so a
 * piece whose pixels hold a chromatic cluster of PIECE_COLOUR_SHARE or more
 * takes that cluster's core; otherwise the core of all its pixels.
 */
export function pieceColour(labs: readonly Lab[]): Lab {
  if (!labs.length) return { L: 0, a: 0, b: 0 };
  const px = labs.map((lab) => ({ lab }));
  let best: Lab | null = null;
  let bestC = PIECE_CHROMA;
  for (const g of cluster(px, 2)) {
    if (g.length < labs.length * PIECE_COLOUR_SHARE) continue;
    const c = coreColour(g.map((j) => labs[j]));
    const C = chroma(c);
    if (C >= bestC) {
      best = c;
      bestC = C;
    }
  }
  return best ?? coreColour(labs);
}
