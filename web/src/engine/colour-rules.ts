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
//    interior designer's 60-30-10, and against the golden split 0.62 : 0.38.
// 4. Chroma: how many voices are saturated, Albers' vibration (complements
//    at equal lightness and high chroma), and the warm and cool balance.

import { hueGap } from "./color";
import { CONTRAST_EDGES, NEUTRAL_CHROMA, SATURATED_CHROMA, SHARES_REFERENCE, SHARE_EDGES, VALUE_GAP_EDGES, VIBRATION, isNeutral, nearEdge } from "./constants";
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
  { id: "L", name: "right-angle", gloss: "a hue and one 90° away", sectors: [[0, 18], [90, 79.2]] },
  { id: "Y", name: "analogous with a complementary accent", gloss: "neighbouring hues and one accent from across the wheel", sectors: [[0, 93.6], [180, 18]] },
  { id: "X", name: "double complementary", gloss: "two neighbourhoods across the wheel", sectors: [[0, 93.6], [180, 93.6]] },
  { id: "T", name: "half-wheel", gloss: "all warm or all cool", sectors: [[0, 180]] },
];

/** Degrees outside the nearest sector, 0 when inside. */
function outside(h: number, rot: number, t: Template): number {
  return Math.min(...t.sectors.map(([off, w]) => Math.max(0, hueGap(h, (rot + off) % 360) - w / 2)));
}

/** Best rotation of a template for the chromatic swatches: least area-weighted distance outside. */
export function fitTemplate(chromatic: BinnedSwatch[], t: Template): { rot: number; cost: number } {
  const total = chromatic.reduce((s, c) => s + c.share, 0) || 1;
  let best = { rot: 0, cost: Infinity };
  for (let rot = 0; rot < 360; rot++) {
    const cost = chromatic.reduce((s, c) => s + (c.share / total) * outside(c.h, rot, t), 0);
    if (cost < best.cost - 1e-9) best = { rot, cost };
  }
  return best;
}

/** Area-weighted degrees outside a template that still counts as a fit. */
export const FIT_TOLERANCE = 4;

export function harmonyLine(palette: BinnedSwatch[], waist: number): AdviceLine {
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
      return { ...base, borderline: nearFit(fit.cost), measured: `${t.id} · ${hueList(chromatic)}`, state: "golden", text: `The hues fit the ${t.name} template (${t.gloss}), a classic harmony. Keep any new piece inside it, or neutral.` };
    }
  }
  // Nothing fits: find the colour whose removal lets the rest fit best, and name it.
  let worst = chromatic[0], bestRest = Infinity;
  for (const c of chromatic) {
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
    text: `The hues fit no classic harmony template. The ${place(worst, waist)} at ${deg(worst.h)} sits outside the scheme the others share; a neutral there, or a hue beside one of the others, would settle it.`,
  };
}

// ---- 2. Value structure -----------------------------------------------------

export function valueLine(palette: BinnedSwatch[], upperL: number, lowerL: number): AdviceLine {
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
    return { ...base, state: gap > VALUE_GAP_EDGES[1] ? "advice" : "neutral", text: `Dark over light: the upper piece (lightness ${pct(upperL)}) is darker than the lower (${pct(lowerL)}), so the visual weight sits high. Painters ground a figure with the darker value below; a darker lower piece or darker shoes would do it. Overall, ${key}.` };
  }
  return { ...base, state: "neutral", text: `Light over dark (${pct(upperL)} above ${pct(lowerL)}): the weight sits low and the figure reads grounded. Overall, ${key}.` };
}

// ---- 3. Shares: 60-30-10 ----------------------------------------------------

export function sharesLine(palette: BinnedSwatch[]): AdviceLine {
  const [a = 0, b = 0, c = 0] = palette.map((s) => s.share);
  const measured = [a, b, c].filter((v) => v > 0).map(pct).join(" · ");
  const off = Math.abs(a - SHARES_REFERENCE[0]) + Math.abs(b - SHARES_REFERENCE[1]) + Math.abs(c - SHARES_REFERENCE[2]);
  // Shares are binned to 0.05.
  const borderline = nearEdge(a, [SHARE_EDGES.column], 0.05) || nearEdge(Math.abs(a - b), [SHARE_EDGES.compete], 0.05) || nearEdge(off, [SHARE_EDGES.near6030], 0.05);
  const base = { rule: "shares" as const, title: "Colour shares", measured, borderline };
  if (a >= SHARE_EDGES.column) {
    return { ...base, state: "neutral", text: `One colour covers ${pct(a)} of the outfit. That is a column, calm and long. If you want a focal point, an accent near 0.10 (shoes, a belt, a bag) gives the eye a place to rest.` };
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
    return { ...base, state: "golden", text: `Close to 60-30-10: a dominant colour, a secondary and an accent, the proportion interior designers and painters use to give a palette one voice.` };
  }
  if (a < 0.4) {
    return { ...base, state: "neutral", text: `No colour leads: the largest holds ${pct(a)} of the outfit, the rest share it in small parts. A calm, mixed palette; one colour near 0.60 would give it a lead.` };
  }
  return { ...base, state: "neutral", text: `A dominant colour at ${pct(a)} with the rest supporting it. The 60-30-10 proportion (0.60 · 0.30 · 0.10) is the reference: a smaller third colour would sharpen it into an accent.` };
}

// ---- 4. Chroma, vibration and temperature ----------------------------------

/** Warm: reds, oranges, yellows on the OKLCH wheel; cool: greens, blues, violets. */
const isWarm = (h: number) => h < 110 || h >= 345;

export function chromaLine(palette: BinnedSwatch[], waist: number): AdviceLine {
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
        return { ...base, state: "advice", text: `The ${place(p, waist)} and the ${place(q, waist)} are near-complements at almost the same lightness (${pct(p.L)} and ${pct(q.L)}). Josef Albers showed such pairs vibrate where they meet. Separate them by value, one clearly lighter, or set a neutral between them. The palette is ${temp}.` };
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
