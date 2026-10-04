// The outfit's palette: every garment and accessory pixel inside the figure,
// clustered and weighted by area. Deterministic by construction: pixels are
// visited in a fixed order, the clusters start from a median cut (no random
// seeds), k-means runs a fixed number of passes, and ties break by index.
// The colour-theory rules (rules.ts) read only this palette.
//
// Engine 0.7.0 (UX pass 2): the clusters are found in OKLab with the a and b
// axes weighted by CHROMA_WEIGHT, so pixels split by hue and not only by
// lightness (plain OKLab split a black jacket and plum trousers into
// lightness slices, each a mix of both, and the mix read as grey). Each
// swatch's colour is its members' well-lit core (garment-colour.ts), with
// the photo's neutral cast taken off. The shoes are their own swatch, read
// from the boxes round the feet (measure.ts), so white sneakers under a
// white t-shirt are still shoes; no other swatch is placed at the feet.

import { type Lab, deltaE, hueGap, srgbToOklab } from "./color";
import { type Cast, NO_CAST, cluster, coreColour, uncast } from "./garment-colour";

export { CHROMA_WEIGHT, cluster } from "./garment-colour";
import { CATEGORY, type FootBox, LIGHT_HUE, type Mask } from "./measure";
import { SHOES_Y } from "./pieces";
import type { Pixels } from "./resample";

export interface Swatch {
  lab: Lab;
  /** Share of the outfit's garment area, 0..1. */
  share: number;
  /** Mean row of the swatch's pixels as a fraction of the figure, head (0) to feet (1). The shoes sit at SHOES_Y or below; nothing else does. */
  y: number;
}

export const MAX_COLOURS = 5;
/** Swatches closer than this in OKLab are one colour. */
export const MERGE_DELTA = 0.06;
/** Swatches smaller than this share of the garment area are dropped as noise (never the shoes). */
export const MIN_SHARE = 0.03;
/** Every swatch but the shoes sits at or above this place on the figure, so its binned place stays clear of SHOES_Y. */
export const BODY_Y_MAX = 0.85;

interface Px {
  lab: Lab;
  y: number;
}

const hueOf = (c: { a: number; b: number }) => {
  const h = (Math.atan2(c.b, c.a) * 180) / Math.PI;
  return h < 0 ? h + 360 : h;
};

/** Body pixels this close to the background (a share of the body's width) are not read for colour. */
export const RIM = 0.08;

/**
 * Chessboard distance from each pixel to the nearest background pixel,
 * capped at `cap + 1` (two passes, fixed order). The frame's edge counts as
 * background.
 */
export function rimDistance(mask: Mask, cap: number): Uint16Array {
  const { width: W, height: H, data } = mask;
  const d = new Uint16Array(W * H);
  const big = cap + 1;
  for (let i = 0; i < W * H; i++) d[i] = data[i] === CATEGORY.background ? 0 : big;
  const at = (x: number, y: number) => (x < 0 || y < 0 || x >= W || y >= H ? 0 : d[y * W + x]);
  for (let y = 0; y < H; y++)
    for (let x = 0; x < W; x++) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x - 1, y) + 1, at(x - 1, y - 1) + 1, at(x, y - 1) + 1, at(x + 1, y - 1) + 1);
    }
  for (let y = H - 1; y >= 0; y--)
    for (let x = W - 1; x >= 0; x--) {
      const i = y * W + x;
      if (!d[i]) continue;
      d[i] = Math.min(d[i], at(x + 1, y) + 1, at(x + 1, y + 1) + 1, at(x, y + 1) + 1, at(x - 1, y + 1) + 1);
    }
  return d;
}

export interface Figure {
  top: number;
  bottom: number;
  left: number;
  right: number;
  /** The photo's neutral cast (measure.ts); none when absent. */
  cast?: Cast;
  /** The boxes round the feet where the shoes are read (measure.ts). */
  feet?: FootBox[];
  /** The break and the waist (measure.ts): the palette's upper and lower regions split at the break, or the waist for one column. */
  breakRow?: number | null;
  waistRow?: number;
  /** A strongly coloured backdrop (measure.ts), and the pieces' measured colours: a swatch in the backdrop's hue that is neither piece is its light on the cloth. */
  light?: Cast;
  topColour?: Lab;
  bottomColour?: Lab;
}

/** Colours per region (upper, lower) before merging. */
export const REGION_COLOURS = 3;
/**
 * Cloth in shade: a cluster whose core is below `colour` chroma but whose
 * pixels' mean a/b reaches `tint`, within `hue` degrees of a lighter, chromatic
 * (`colour` or more) cluster of its region, is that cloth in shadow. Two
 * neutral clusters of a region within `neutralL` in lightness are one cloth.
 */
export const SHADE = { colour: 0.04, tint: 0.008, hue: 30, neutralL: 0.12 } as const;



/**
 * The shoes' colour from their pixels: of two clusters, the one with more
 * pixels in the upper half of the foot boxes (the shoe's upper; the sole,
 * its shadow and a glossy floor sit in the lower half), its well-lit core.
 * White sneakers with grey soles are white; coral ones with white soles coral.
 */
export function shoeColour(px: (Px & { upper: boolean })[]): Lab {
  const groups = cluster(px, 2);
  const upperCount = (g: number[]) => g.reduce((t, j) => t + (px[j].upper ? 1 : 0), 0);
  let pick = groups[0] ?? [];
  for (const g of groups) if (upperCount(g) > upperCount(pick)) pick = g;
  return coreColour(pick.map((j) => px[j].lab));
}

/** Garment and accessory pixels inside the figure's box, clustered into at most MAX_COLOURS swatches by area, plus the shoes. */
export function extractPalette(pixels: Pixels, mask: Mask, fig: Figure): Swatch[] {
  const W = mask.width;
  const pad = (fig.right - fig.left) * 0.35;
  const x0 = Math.max(0, Math.floor(fig.left - pad)), x1 = Math.min(W - 1, Math.ceil(fig.right + pad));
  const y0 = Math.max(0, Math.floor(fig.top)), y1 = Math.min(mask.height - 1, Math.ceil(fig.bottom));
  const h = Math.max(1, fig.bottom - fig.top);
  const cast = fig.cast ?? NO_CAST;
  const feet = fig.feet ?? [];
  const garment = (x: number, y: number) => {
    const cat = mask.data[y * W + x];
    return cat === CATEGORY.clothes || cat === CATEGORY.other;
  };
  const rim = rimDistance(mask, Math.max(1, Math.round((fig.right - fig.left) * RIM)));
  const rimCut = Math.max(1, Math.round((fig.right - fig.left) * RIM));
  const inFeet = (x: number, y: number) => feet.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y1);
  const body: Px[] = [];
  const shoes: (Px & { upper: boolean })[] = [];
  const cache = new Map<number, Lab>();
  // Shoe pixels may lie outside the body's box (feet apart): the boxes are read whole.
  const fx0 = Math.min(x0, ...feet.map((f) => f.x0)), fx1 = Math.max(x1, ...feet.map((f) => f.x1));
  for (let y = y0; y <= y1; y++)
    for (let x = fx0; x <= fx1; x++) {
      const foot = inFeet(x, y);
      if (!foot && (x < x0 || x > x1)) continue;
      if (!garment(x, y)) continue;
      // A body pixel near the silhouette mixes the cloth with what lies
      // behind it, or catches the backdrop's light (a blue stage rim-lit a
      // black hoodie into a blue swatch, p2 of UX pass 2): only pixels
      // farther than RIM of the body's width from the background are read.
      // The shoes are small and read whole.
      if (!foot && rim[y * W + x] <= rimCut) continue;
      const i = (y * W + x) * 4;
      const key = (pixels.data[i] << 16) | (pixels.data[i + 1] << 8) | pixels.data[i + 2];
      let lab = cache.get(key);
      if (!lab) { lab = uncast(srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]), cast); cache.set(key, lab); }
      if (foot) shoes.push({ lab, y: (y - fig.top) / h, upper: feet.some((f) => x >= f.x0 && x <= f.x1 && y >= f.y0 && y <= f.y0 + (f.y1 - f.y0) * 0.5) });
      else body.push({ lab, y: (y - fig.top) / h });
    }
  const total = body.length + shoes.length;
  if (!total) return [];

  // Piece first: the upper region (to the break) and the lower region are
  // clustered apart, so a dark cluster below the break is the lower piece in
  // shade, never a mix with a dark jacket above it. In each region a dark,
  // near-neutral cluster that carries a colour's tint is that colour's cloth
  // in shadow and joins it (plum trousers in shade measure near black; Mara
  // saw plum).
  const split = ((fig.breakRow ?? fig.waistRow ?? (fig.top + fig.bottom) / 2) - fig.top) / h;
  let swatches: Swatch[] = [];
  for (const region of [body.filter((p) => p.y < split), body.filter((p) => p.y >= split)]) {
    const groups = cluster(region, REGION_COLOURS).map((g) => {
      const labs = g.map((j) => region[j].lab);
      let sa = 0, sb = 0, ys = 0;
      for (const j of g) {
        sa += region[j].lab.a;
        sb += region[j].lab.b;
        ys += region[j].y;
      }
      return { members: g.length, ys, lab: coreColour(labs), tint: { a: sa / g.length, b: sb / g.length } };
    });
    const chromaOf = (c: { a: number; b: number }) => Math.sqrt(c.a * c.a + c.b * c.b);
    for (const g of groups) {
      if (!g.members || chromaOf(g.lab) >= SHADE.colour || chromaOf(g.tint) < SHADE.tint) continue;
      // The most chromatic lighter cluster of the same hue in this region.
      let into: (typeof groups)[number] | null = null;
      for (const c of groups)
        if (c !== g && c.members && chromaOf(c.lab) >= SHADE.colour && c.lab.L > g.lab.L && hueGap(hueOf(c.lab), hueOf(g.tint)) <= SHADE.hue && (!into || chromaOf(c.lab) > chromaOf(into.lab))) into = c;
      if (!into) continue;
      into.members += g.members;
      into.ys += g.ys;
      g.members = 0;
    }
    // Two neutral clusters of one region within SHADE.neutralL of each other
    // are one cloth lit and in shade (a black jacket read as black and
    // charcoal): they join, at the larger one's colour.
    const live = () => groups.filter((g) => g.members).sort((p, q) => q.members - p.members);
    for (const g of live())
      for (const c of live()) {
        if (c === g || !g.members || !c.members || c.members > g.members) continue;
        if (chromaOf(g.lab) < SHADE.colour && chromaOf(c.lab) < SHADE.colour && Math.abs(g.lab.L - c.lab.L) < SHADE.neutralL) {
          g.members += c.members;
          g.ys += c.ys;
          c.members = 0;
        }
      }
    for (const g of groups) if (g.members) swatches.push({ lab: g.lab, share: g.members / total, y: Math.min(BODY_Y_MAX, g.ys / g.members) });
  }
  // Merge near-identical swatches (largest first), then drop specks.
  swatches.sort((p, q) => q.share - p.share);
  const merged: Swatch[] = [];
  for (const s of swatches) {
    const into = merged.find((m) => deltaE(m.lab, s.lab) < MERGE_DELTA);
    if (!into) { merged.push({ ...s }); continue; }
    const sum = into.share + s.share;
    into.lab = { L: (into.lab.L * into.share + s.lab.L * s.share) / sum, a: (into.lab.a * into.share + s.lab.a * s.share) / sum, b: (into.lab.b * into.share + s.lab.b * s.share) / sum };
    into.y = (into.y * into.share + s.y * s.share) / sum;
    into.share = sum;
  }
  swatches = merged.filter((s) => s.share >= MIN_SHARE).slice(0, MAX_COLOURS);
  // A coloured stage or wall lights the cloth that faces it (the blue stage
  // on p2's black hoodie): a swatch in the backdrop's hue that is neither
  // the upper nor the lower piece's colour is that light, not a garment.
  const light = fig.light;
  if (light) {
    const lightH = hueOf(light);
    const pieceOf = (c: Lab | undefined) => (c ? swatches.reduce((best, s, i) => (deltaE(s.lab, c) < deltaE(swatches[best].lab, c) ? i : best), 0) : -1);
    const keep = new Set([pieceOf(fig.topColour), pieceOf(fig.bottomColour)]);
    swatches = swatches.filter((s, i) => keep.has(i) || Math.sqrt(s.lab.a * s.lab.a + s.lab.b * s.lab.b) < 0.04 || hueGap(hueOf(s.lab), lightH) > LIGHT_HUE);
  }
  if (shoes.length) {
    let ys = 0;
    for (const p of shoes) ys += p.y;
    swatches.push({ lab: shoeColour(shoes), share: shoes.length / total, y: Math.max(SHOES_Y, ys / shoes.length) });
  }
  const kept = swatches.reduce((t, s) => t + s.share, 0) || 1;
  return swatches.map((s) => ({ ...s, share: s.share / kept })).sort((p, q) => q.share - p.share);
}
