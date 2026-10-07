// The colour half of the rulebook: four rules over the outfit's palette
// (palette.ts), each a pure function of binned swatches.
//
// 1. Harmony: which of Matsuda's hue templates the palette fits (the colour
//    harmony templates used in colour-harmonization research: Tokumaru et
//    al. 2002, Cohen-Or et al. 2006), adapted from the HSV wheel to the
//    perceptual OKLCH wheel, and the colour that sits furthest outside.
// 2. Value: the lightness range (Notan) and where the weight sits: dark
//    below light reads grounded, dark above light reads top-heavy.
// 3. Shares: area of the dominant, secondary and accent colours against the
//    interior designer's 60-30-10 (a convention of that trade, not a canon),
//    and against the golden split 0.62 : 0.38.
// 4. Chroma: how many voices are saturated, Albers' vibration (complements
//    at equal lightness and high chroma), and the warm and cool balance.

import { hueGap } from "./color";
import { CONTRAST_EDGES, NEUTRAL_CHROMA, SATURATED_CHROMA, SHARES_REFERENCE, SHARE_EDGES, VALUE_GAP_EDGES, VIBRATION, isNeutral, nearEdge } from "./constants";
import { colourName } from "./names";
import type { Garment, Recolour } from "./pieces";
import type { AdviceLine } from "./rules";

export interface BinnedSwatch {
  L: number;
  C: number;
  /** Hue in degrees; 0 for a neutral. */
  h: number;
  share: number;
  /** Where it sits on the figure, head (0) to feet (1). */
  y: number;
}

export { NEUTRAL_CHROMA, SATURATED_CHROMA };

const deg = (h: number) => `${Math.round(h)}°`;
const pct = (v: number) => v.toFixed(2);
/** Each hue once, in palette order: two swatches of one hue at different lightness are one hue here. */
const hueList = (cs: BinnedSwatch[]) => [...new Set(cs.map((c) => deg(c.h)))].join(" ");

/** Where a swatch sits, in words a person uses. */
function place(s: BinnedSwatch, waist: number): string {
  if (s.y > 0.9) return "shoes";
  if (s.y < waist) return "upper piece";
  return "lower piece";
}

/** The garment a swatch's place names, for AdviceLine.recolours. */
export function garmentAt(s: { y: number }, waist: number): Garment {
  return s.y > 0.9 ? "shoes" : s.y < waist ? "upper" : "lower";
}

// ---- 1. Harmony: Matsuda's templates --------------------------------------

interface Template {
  id: string;
  name: string;
  /** What the template means, in a few words. */
  gloss: string;
  /** Sectors as [offset from the template's rotation, width], in degrees. */
  sectors: [number, number][];
}

/** Most specific first: when several fit, the first one names the palette. */
export const TEMPLATES: Template[] = [
  { id: "i", name: "monochromatic", gloss: "one hue in several values", sectors: [[0, 18]] },
  { id: "I", name: "complementary", gloss: "two hues across the wheel", sectors: [[0, 18], [180, 18]] },
  { id: "V", name: "analogous", gloss: "neighbouring hues", sectors: [[0, 93.6]] },
  { id: "L", name: "right-angle", gloss: "a hue and one at a right angle to it", sectors: [[0, 18], [90, 79.2]] },
  { id: "Y", name: "analogous with a complementary accent", gloss: "neighbouring hues and one accent from across the wheel", sectors: [[0, 93.6], [180, 18]] },
  { id: "X", name: "double complementary", gloss: "two neighbourhoods across the wheel", sectors: [[0, 93.6], [180, 93.6]] },
  { id: "T", name: "half-wheel", gloss: "hues within one half of the wheel, a 180° arc anywhere on it", sectors: [[0, 180]] },
];

/** Degrees outside the nearest sector, 0 when inside. */
function outside(h: number, rot: number, t: Template): number {
  let min = Infinity;
  for (const [off, w] of t.sectors) {
    const d = Math.max(0, hueGap(h, (rot + off) % 360) - w / 2);
    if (d < min) min = d;
  }
  return min;
}

/**
 * Degrees outside a template, by (rot − h) mod 360, for whole-degree hues.
 * For an integer hue h and rotation rot, hueGap(h, (rot + off) % 360) is
 * the circular distance between them, which depends only on that
 * difference, so outside(h, rot, t) === outside(0, (rot − h) mod 360, t)
 * exactly: the same integers, the same subtraction of w / 2. The looks
 * re-read many candidates, and this table makes each fit a lookup instead
 * of a recomputation without changing a single value.
 */
const OUTSIDE_TABLES = new Map<string, Float64Array>();
function outsideTable(t: Template): Float64Array {
  let table = OUTSIDE_TABLES.get(t.id);
  if (!table) {
    table = new Float64Array(360);
    for (let d = 0; d < 360; d++) table[d] = outside(0, d, t);
    OUTSIDE_TABLES.set(t.id, table);
  }
  return table;
}

/**
 * Fits already made, by template and the swatches' hues and shares in
 * order. The looks re-read hundreds of candidates that share most of a
 * palette, so the same fit is asked for again and again. A pure function's
 * result, so remembering it never changes a reading. It lasts one reading:
 * suggestLooks empties it first (clearFits), and it is also emptied if it
 * ever grows large.
 */
const FITS = new Map<string, { rot: number; cost: number }>();
const FITS_MAX = 50_000;

/** Empties the fit memo, so it lasts one reading (looks.ts suggestLooks). */
export const clearFits = (): void => FITS.clear();

/** Best rotation of a template for the chromatic swatches: least area-weighted distance outside. */
export function fitTemplate(chromatic: BinnedSwatch[], t: Template): { rot: number; cost: number } {
  let key = t.id;
  for (const c of chromatic) key += `|${c.h}:${c.share}`;
  const known = FITS.get(key);
  if (known) return { rot: known.rot, cost: known.cost };
  const fit = computeFit(chromatic, t);
  if (FITS.size >= FITS_MAX) FITS.clear();
  FITS.set(key, fit);
  return { rot: fit.rot, cost: fit.cost };
}

function computeFit(chromatic: BinnedSwatch[], t: Template): { rot: number; cost: number } {
  // The same arithmetic, in the same order, as a reduce over the swatches:
  // each share over the total, times the degrees outside, summed left to right.
  const total = chromatic.reduce((s, c) => s + c.share, 0) || 1;
  const n = chromatic.length;
  // Each weight is the very division the reduce made, made once.
  const weights = chromatic.map((c) => c.share / total);
  const exact = chromatic.every((c) => Number.isInteger(c.h) && c.h >= 0 && c.h < 360);
  let best = { rot: 0, cost: Infinity };
  if (exact) {
    const table = outsideTable(t);
    const hues = chromatic.map((c) => c.h);
    for (let rot = 0; rot < 360; rot++) {
      let cost = 0;
      for (let k = 0; k < n; k++) {
        const d = rot - hues[k];
        cost = cost + weights[k] * table[d < 0 ? d + 360 : d];
      }
      if (cost < best.cost - 1e-9) best = { rot, cost };
    }
    return best;
  }
  for (let rot = 0; rot < 360; rot++) {
    let cost = 0;
    for (let k = 0; k < n; k++) cost = cost + weights[k] * outside(chromatic[k].h, rot, t);
    if (cost < best.cost - 1e-9) best = { rot, cost };
  }
  return best;
}

/** Area-weighted degrees outside a template that still counts as a fit. */
export const FIT_TOLERANCE = 4;

/** A swatch's recolour, named: the garment where it sits and its plain colour name. */
const recolourOf = (s: BinnedSwatch, waist: number): Recolour => ({ garment: garmentAt(s, waist), colour: colourName(s.L, s.C, s.h) });

/** The harmony line. `shoesKept`: another line keeps the shoes as worn, so the colour named outside the scheme is never the shoes while another piece can be. */
export function harmonyLine(palette: BinnedSwatch[], waist: number, ctx: { shoesKept?: boolean } = {}): AdviceLine {
  const chromatic = palette.filter((s) => !isNeutral(s));
  const base = { rule: "harmony" as const, title: "Harmony", borderline: false };
  if (chromatic.length === 0) {
    return { ...base, measured: "neutrals", state: "golden", text: "Every piece is a neutral, so no hues can clash. The outfit is composed by value alone; the value line below is the one to read." };
  }
  if (chromatic.length === 1) {
    return { ...base, measured: deg(chromatic[0].h), state: "golden", text: `One hue, ${deg(chromatic[0].h)}, with neutrals: the most forgiving scheme there is. Any neutral can join it.` };
  }
  // Borderline: the fit sits within 2° of the tolerance, either side.
  const nearFit = (cost: number) => Math.abs(cost - FIT_TOLERANCE) <= 2;
  for (const t of TEMPLATES) {
    const fit = fitTemplate(chromatic, t);
    if (fit.cost <= FIT_TOLERANCE) {
      // The row shows the plain name ("analogous"); Matsuda's letter stays in the Rulebook's maths (Mara, UX pass 3: clients don't know "V").
      return { ...base, borderline: nearFit(fit.cost), measured: `${t.name} · ${hueList(chromatic)}`, state: "golden", text: `The hues fit the ${t.name} template (${t.gloss}), a classic harmony. Keep any new piece inside it, or neutral.` };
    }
  }
  // Nothing fits: find the colour whose removal lets the rest fit best, and name it.
  const kept = (s: BinnedSwatch) => !!ctx.shoesKept && garmentAt(s, waist) === "shoes";
  const candidates = chromatic.some((s) => !kept(s)) ? chromatic.filter((s) => !kept(s)) : chromatic;
  let worst = candidates[0], bestRest = Infinity;
  for (const c of candidates) {
    const rest = chromatic.filter((x) => x !== c);
    const cost = Math.min(...TEMPLATES.map((t) => fitTemplate(rest, t).cost));
    if (cost < bestRest) { bestRest = cost; worst = c; }
  }
  const closest = Math.min(...TEMPLATES.map((t) => fitTemplate(chromatic, t).cost));
  return {
    ...base,
    borderline: nearFit(closest),
    measured: hueList(chromatic),
    state: "advice",
    recolours: [recolourOf(worst, waist)],
    text: `The hues fit no classic harmony template. The ${place(worst, waist)} at ${deg(worst.h)} sits outside the scheme the others share; a neutral there, or a hue beside one of the others, would settle it.`,
  };
}

// ---- 2. Value structure -----------------------------------------------------

/**
 * The value line. `shoes`: "free" when darker shoes may be suggested on
 * their own; "matched" when the shoes carry the leg line on, so they darken
 * only with the lower piece, as a pair; "none" when no shoes were read or
 * they are the outfit's accent, kept as worn (T6).
 */
export function valueLine(palette: BinnedSwatch[], upperL: number, lowerL: number, ctx: { shoes: "free" | "matched" | "none" } = { shoes: "free" }): AdviceLine {
  const ls = palette.filter((s) => s.share >= 0.05).map((s) => s.L);
  const range = Math.max(...ls) - Math.min(...ls);
  const band = range < CONTRAST_EDGES[0] ? "low" : range < CONTRAST_EDGES[1] ? "medium" : "high";
  const gap = lowerL - upperL;
  // Lightness bins are 0.02 wide; a difference of two bins can move by one.
  const borderline = nearEdge(range, CONTRAST_EDGES, 0.04) || nearEdge(Math.abs(gap), VALUE_GAP_EDGES, 0.04);
  const base = { rule: "value" as const, title: "Value", measured: `range ${pct(range)}`, borderline };
  const key = { low: "a close-valued, quiet outfit that reads as one shape", medium: "a moderate value range, clear without cutting", high: "a strong value range: the edges between light and dark are what the eye sees first" }[band];
  if (Math.abs(gap) <= VALUE_GAP_EDGES[0]) {
    return { ...base, state: "neutral", text: `The upper and lower pieces sit at nearly the same lightness (${pct(upperL)} and ${pct(lowerL)}), so the figure reads as one tonal shape and the eye looks for edges elsewhere. Overall, ${key}.` };
  }
  if (upperL < lowerL) {
    const advice = gap > VALUE_GAP_EDGES[1];
    const fix = {
      free: "a darker lower piece or darker shoes would do it",
      matched: "a darker lower piece and shoes to match would do it",
      none: "a darker lower piece would do it",
    }[ctx.shoes];
    const recolours: Recolour[] = ctx.shoes === "free" ? [{ garment: "lower" }, { garment: "shoes" }] : ctx.shoes === "matched" ? [{ garment: "lower" }, { garment: "shoes", matched: true }] : [{ garment: "lower" }];
    return { ...base, state: advice ? "advice" : "neutral", recolours, text: `Dark over light: the upper piece (lightness ${pct(upperL)}) is darker than the lower (${pct(lowerL)}), so the visual weight sits high. Painters ground a figure with the darker value below; ${fix}. Overall, ${key}.` };
  }
  return { ...base, state: "neutral", text: `Light over dark (${pct(upperL)} above ${pct(lowerL)}): the weight sits low and the figure reads grounded. Overall, ${key}.` };
}

// ---- 3. Shares: 60-30-10 ----------------------------------------------------

/**
 * The shares line. `accent`: the outfit already has an accent, so a column
 * is not told to add one. `shoesKept`: the leg line keeps the shoes (they
 * continue the lower piece), so the accent it offers is not on the shoes.
 */
export function sharesLine(palette: BinnedSwatch[], ctx: { accent: boolean; shoesKept?: boolean } = { accent: false }): AdviceLine {
  const [a = 0, b = 0, c = 0] = palette.map((s) => s.share);
  const measured = [a, b, c].filter((v) => v > 0).map(pct).join(" · ");
  const off = Math.abs(a - SHARES_REFERENCE[0]) + Math.abs(b - SHARES_REFERENCE[1]) + Math.abs(c - SHARES_REFERENCE[2]);
  // Shares are binned to 0.05.
  const borderline = nearEdge(a, [SHARE_EDGES.column], 0.05) || nearEdge(Math.abs(a - b), [SHARE_EDGES.compete], 0.05) || nearEdge(off, [SHARE_EDGES.near6030], 0.05);
  const base = { rule: "shares" as const, title: "Colour shares", measured, borderline };
  if (a >= SHARE_EDGES.column) {
    if (ctx.accent) return { ...base, state: "neutral", text: `One colour covers ${pct(a)} of the outfit. That is a column, calm and long, and the outfit's accent gives the eye a place to rest.` };
    const where = ctx.shoesKept ? "a belt, a bag, a scarf" : "shoes, a belt, a bag";
    return { ...base, state: "neutral", ...(ctx.shoesKept ? {} : { recolours: [{ garment: "shoes" as const }] }), text: `One colour covers ${pct(a)} of the outfit. That is a column, calm and long. If you want a focal point, an accent near 0.10 (${where}) gives the eye a place to rest.` };
  }
  if (Math.abs(a - 0.62) <= 0.04 && c < 0.05) {
    return { ...base, state: "golden", text: `Two colours split the outfit ${pct(a)} : ${pct(b)}, near the golden section. One leads and one answers.` };
  }
  if (b >= 0.2 && a - b <= 0.05) {
    return { ...base, state: "advice", text: `The two largest colours tie (${pct(a)} and ${pct(b)}), so none leads. Let one take the lead, near 0.60, with the other near 0.30 and a small accent near 0.10.` };
  }
  if (Math.abs(a - b) <= SHARE_EDGES.compete && b >= 0.3) {
    return { ...base, state: "advice", text: `The two main colours share the outfit almost equally (${pct(a)} and ${pct(b)}), so they compete for the lead. Let one dominate, near 0.60, with the other near 0.30 and a small accent near 0.10.` };
  }
  if (off <= SHARE_EDGES.near6030) {
    return { ...base, state: "golden", text: `Close to 60-30-10: a dominant colour, a secondary and an accent, the interior designer's rule of thumb for giving a palette one voice.` };
  }
  if (a < 0.4) {
    return { ...base, state: "neutral", text: `No colour leads: the largest holds ${pct(a)} of the outfit, the rest share it in small parts. A calm, mixed palette; one colour near 0.60 would give it a lead.` };
  }
  return { ...base, state: "neutral", text: `A dominant colour at ${pct(a)} with the rest supporting it. The 60-30-10 proportion (0.60 · 0.30 · 0.10) is the reference: a smaller third colour would sharpen it into an accent.` };
}

// ---- 4. Chroma, vibration and temperature ----------------------------------

/** Warm: reds, oranges, yellows on the OKLCH wheel; cool: greens, blues, violets. */
const isWarm = (h: number) => h < 110 || h >= 345;

/** The chroma line. `shoesKept`: another line keeps the shoes as worn, so a vibration with them is settled on the other piece. */
export function chromaLine(palette: BinnedSwatch[], waist: number, ctx: { shoesKept?: boolean } = {}): AdviceLine {
  const chromatic = palette.filter((s) => !isNeutral(s));
  const loud = chromatic.filter((s) => s.C >= SATURATED_CHROMA);
  const warm = chromatic.filter((s) => isWarm(s.h)).reduce((t, s) => t + s.share, 0);
  const cool = chromatic.filter((s) => !isWarm(s.h)).reduce((t, s) => t + s.share, 0);
  const temp = chromatic.length === 0 ? "no temperature (neutrals only)" : warm > cool * 2 ? "warm-led" : cool > warm * 2 ? "cool-led" : "warm and cool in balance";
  // Chroma is binned to 0.01: a colour exactly at the saturation edge could read either way.
  const borderline = chromatic.some((s) => nearEdge(s.C, [SATURATED_CHROMA], 0.01));
  const base = { rule: "chroma" as const, title: "Chroma", measured: `${loud.length} saturated`, borderline };

  for (let i = 0; i < chromatic.length; i++)
    for (let j = i + 1; j < chromatic.length; j++) {
      const p = chromatic[i], q = chromatic[j];
      if (p.C >= VIBRATION.minChroma && q.C >= VIBRATION.minChroma && hueGap(p.h, q.h) >= VIBRATION.minHueGap && Math.abs(p.L - q.L) < VIBRATION.maxLightnessGap) {
        const said = `The ${place(p, waist)} and the ${place(q, waist)} are near-complements at almost the same lightness (the value row shows each). Josef Albers showed such pairs vibrate where they meet.`;
        // Shoes another line keeps (the accent, or shoes carrying the leg line on) are not asked to change: the other piece is (T6).
        const shoeSide = garmentAt(p, waist) === "shoes" ? p : garmentAt(q, waist) === "shoes" ? q : null;
        const other = shoeSide === p ? q : p;
        if (ctx.shoesKept && shoeSide && garmentAt(other, waist) !== "shoes") {
          return { ...base, state: "advice", recolours: [recolourOf(other, waist)], text: `${said} Keep the shoes and separate the ${place(other, waist)} from them by value, clearly lighter or darker, or set a neutral between them. The palette is ${temp}.` };
        }
        return { ...base, state: "advice", recolours: [recolourOf(p, waist), recolourOf(q, waist)], text: `${said} Separate them by value, one clearly lighter, or set a neutral between them. The palette is ${temp}.` };
      }
    }
  if (loud.length >= 2 && Math.max(...loud.map((p) => Math.max(...loud.map((q) => hueGap(p.h, q.h))))) > 60) {
    return { ...base, state: "advice", text: `${loud.length} saturated colours in different hues compete as equals. Keep one at full strength and let the others step down to a muted version of themselves. The palette is ${temp}.` };
  }
  if (loud.length === 1) {
    return { ...base, state: "golden", text: `One saturated colour among quieter ones: a single voice, the way a painter places the brightest note. The palette is ${temp}.` };
  }
  return { ...base, state: "neutral", text: `No colour is at full saturation, so the palette is quiet and value carries the outfit. The palette is ${temp}.` };
}

export type ColourRule = "harmony" | "value" | "shares" | "chroma";
