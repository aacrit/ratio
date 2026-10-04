// The rulebook, version 0.2 (Spark): proportion here, and four colour-theory
// rules in colour-rules.ts (harmony, value, shares, chroma). Colour carries
// as much weight as proportion (founder, 2026-10-03).
// Measurements are rounded to fixed bins first, and every rule is a pure
// function of the bins, so the same photo always gets the same words.
//
// Copy law (V4): advice is about choices (tuck, hem, colour, shoes), never
// about the body or the person. tests/engine.test.ts fails on the judging
// words in JUDGING_WORDS.

import { type Lab, labToLch } from "./color";
import { type BinnedSwatch, NEUTRAL_CHROMA, chromaLine, harmonyLine, sharesLine, valueLine } from "./colour-rules";
import { binShares, isNeutral } from "./constants";
import { byName } from "./names";
import { pieces } from "./pieces";
import type { RuleId } from "./rulebook";
import { type Fit, legLine, legUnread, volumeLine, volumeUnread } from "./shape-rules";
import type { OutfitMeasure, ShoesWhy } from "./measure";
import type { Swatch } from "./palette";

export { NEUTRAL_CHROMA };

export const ENGINE_VERSION = "ratio-engine/0.7.0";

export const GOLDEN = 0.382;
export const PROPORTION_BIN = 0.02;

/** Proportion bands on the break's position from the top of the head (0) to the feet (1). */
// "golden" covers a third (0.333) and the golden section (0.382), the two
// composed divisions; "golden-long" their mirrors from below (0.618, 0.667).
export const PROPORTION_BANDS = [
  { id: "short-top", from: 0, to: 0.3 },
  { id: "golden", from: 0.3, to: 0.44 },
  { id: "halves", from: 0.44, to: 0.56 },
  { id: "golden-long", from: 0.56, to: 0.7 },
  { id: "long-top", from: 0.7, to: 1.01 },
] as const;

/** The nearer of the two composed divisions, named. */
const nearestDivision = (r: number) => (Math.abs(r - 1 / 3) < Math.abs(r - GOLDEN) ? "a third (0.333)" : `the golden section (${GOLDEN})`);
export type ProportionBand = (typeof PROPORTION_BANDS)[number]["id"];

export const JUDGING_WORDS = ["flaw", "flatter", "slim", "fat", "ugly", "unflattering", "hide", "problem area", "beautiful", "attractive", "should be ashamed", "wrong body"];

// golden: the measurement sits near the golden section (the gold accent means
// only this). advice: a change is suggested. neutral: measured, nothing to change.
// unread: the photo did not let Ratio measure it, and the line says why.
export type LineState = "golden" | "advice" | "neutral" | "unread";

export interface AdviceLine {
  rule: RuleId;
  title: string;
  /** The measurement, as shown on screen, e.g. "0.50 : 0.50" (thin spaces). */
  measured: string;
  text: string;
  state: LineState;
  /** True when a measurement sits within half a bin of a band edge. */
  borderline: boolean;
}

export interface Bins {
  proportion: number | null;
  waist: number;
  top: { L: number; C: number; h: number };
  bottom: { L: number; C: number; h: number };
  /** The outfit's palette, largest share first. */
  palette: BinnedSwatch[];
  /** Volume: the upper piece's and each leg's fabric width over the shoulder distance, binned to 0.05; either may be null on its own, and the whole is null when neither was read. */
  fit: Fit | null;
  /** Why the upper piece's width was not read: an arm or a hand lay on its edges on every row. */
  fitWhy?: "arms";
  /** The upper piece's width was read on one side only: borderline. */
  fitOneSide?: true;
  /** Why the shoes were not read: cut off by the frame, or not told apart from the floor. */
  shoesWhy?: ShoesWhy;
  /** The upper piece opens or zips down the front, so it does not tuck. */
  front?: true;
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number, digits = 2) => Number(v.toFixed(digits));

function bandOf<T extends { id: string; from: number; to: number }>(bands: readonly T[], v: number): T["id"] {
  return (bands.find((b) => v >= b.from && v < b.to) ?? bands[bands.length - 1]).id;
}

function borderlineIn(bands: readonly { from: number; to: number }[], raw: number, half: number): boolean {
  return bands.some((b) => b.from > 0 && Math.abs(raw - b.from) < half);
}

/**
 * A colour in bins. Whether it is a neutral is decided on the binned
 * lightness and chroma, the values every rule reads: deciding it on the raw
 * values let a grey at chroma 0.018 keep hue 0 and then read as chromatic
 * once its chroma rounded to 0.02 ("one hue, 0°", Mara, 2026-10-04).
 */
export const binColour = (c: Lab) => {
  const { L, C, h } = labToLch(c);
  const bin = { L: fix(round(L, 0.02)), C: fix(round(C, 0.01)) };
  return { ...bin, h: isNeutral(bin) ? 0 : fix(round(h, 5) % 360, 0) };
};

/** The palette in bins; shares by largest remainder, so they sum to exactly 1.00. */
export function binPalette(palette: Swatch[]): BinnedSwatch[] {
  const shares = binShares(palette.map((s) => s.share));
  return palette.map((s, i) => ({ ...binColour(s.lab), share: shares[i], y: fix(round(s.y, 0.05)) }));
}

export function binsOf(m: OutfitMeasure, palette: Swatch[]): Bins {
  const height = m.bottom - m.top;
  return {
    proportion: m.breakRow === null ? null : fix(round((m.breakRow - m.top) / height, PROPORTION_BIN)),
    waist: fix(round((m.waistRow - m.top) / height, PROPORTION_BIN)),
    top: binColour(m.topColour),
    bottom: binColour(m.bottomColour),
    palette: binPalette(palette),
    fit: m.fit ? { top: m.fit.top === null ? null : fix(round(m.fit.top, 0.05)), legs: m.fit.legs === null ? null : fix(round(m.fit.legs, 0.05)) } : null,
    ...(m.fitWhy && (m.fit === null || m.fit.top === null) ? { fitWhy: m.fitWhy } : {}),
    ...(m.fitOneSide ? { fitOneSide: true as const } : {}),
    ...(m.shoesWhy ? { shoesWhy: m.shoesWhy } : {}),
    ...(m.front ? { front: true as const } : {}),
  };
}

/**
 * Whether a tuck may be offered for this reading: the upper piece does not
 * open down the front. Read's "Show the tuck" control, the looks' tuck move
 * and the proportion advice all ask this one predicate.
 */
export const tuckable = (b: Pick<Bins, "front">): boolean => !b.front;

/** A ratio pair as one unit, thin spaces round the colon (design/BRAND.md). */
export const ratioText = (r: number) => `${r.toFixed(2)} : ${(1 - r).toFixed(2)}`;

function proportionLine(b: Bins, rawBreak: number | null): AdviceLine {
  if (b.proportion === null) {
    return {
      rule: "proportion",
      title: "Proportion",
      measured: "one column",
      text: "Top and bottom read as one colour, so the eye runs head to foot without a break. A single column is the longest line an outfit can draw. Keep the shoes close in value to hold it.",
      state: "neutral",
      borderline: false,
    };
  }
  const r = b.proportion;
  const borderline = rawBreak !== null && borderlineIn(PROPORTION_BANDS, rawBreak, PROPORTION_BIN / 2);
  const id = bandOf(PROPORTION_BANDS, r);
  const measured = ratioText(r);
  const tuck = ratioText(b.waist);
  // An upper piece that opens or zips down the front (a jacket, a hoodie)
  // hangs to its hem and does not tuck (Mara, 2026-10-04: "Try a front tuck"
  // on a zipped jacket). Otherwise the tuck is offered as a condition, never
  // an order: the photo cannot show whether a piece tucks.
  const shorter = `A shorter upper piece, ending near the waist (about ${tuck}), would move the break near the golden section.`;
  const texts: Record<ProportionBand, { text: string; state: LineState }> = {
    "short-top": { text: `The break sits high, near ${r.toFixed(2)}, so the lower block carries the length. Keep the bottom's line unbroken to the shoe and the effect holds.`, state: "neutral" },
    golden: { text: `The break sits near ${nearestDivision(r)}. The eye reads a short upper block over a long lower one, the classic division. Keep it.`, state: "golden" },
    halves: {
      text: !tuckable(b)
        ? `Near-equal halves read as boxy. The upper piece opens down the front, so it hangs to its hem rather than tucking. ${shorter}`
        : `Near-equal halves read as boxy. If the upper piece tucks, a front tuck moves the break to the waist, about ${tuck}, near the golden section, and shows the rise of what you wear below.`,
      state: "advice",
    },
    "golden-long": { text: `The break sits near ${nearestDivision(1 - r)} from below: a long upper piece over a short lower one. It is the second classical division. Keep the lower block narrow.`, state: "golden" },
    "long-top": {
      text: !tuckable(b)
        ? `The upper piece covers most of the figure, so the break has little to divide. It opens down the front, so a belt would sit under it. ${shorter}`
        : `The upper piece covers most of the figure, so the break has little to divide. Belt it at the waist, about ${tuck}, to give the eye a division near the golden section.`,
      state: "advice",
    },
  };
  return { rule: "proportion", title: "Proportion", measured, ...texts[id], borderline };
}

export interface OutfitReading {
  engine: string;
  bins: Bins;
  lines: AdviceLine[];
}

/**
 * Applies the whole rulebook to a set of bins. The read of a photo and every
 * suggested look (looks.ts) go through here, so a suggestion is judged by
 * exactly the rules that judged the outfit.
 */
export function readBins(bins: Bins, rawBreak: number | null = bins.proportion): AdviceLine[] {
  const lines = [proportionLine(bins, rawBreak)];
  if (bins.fit) lines.push(volumeLine(bins.fit, { oneSide: bins.fitOneSide, front: bins.front }));
  else if (bins.fitWhy) lines.push(volumeUnread(bins.fitWhy));
  const p = pieces(bins.palette, bins.waist, { top: bins.top, bottom: bins.bottom });
  if (p.lower >= 0 && p.shoes >= 0) lines.push(legLine(bins.palette[p.lower].L, bins.palette[p.shoes].L));
  else if (p.shoes < 0 && bins.shoesWhy) lines.push(legUnread(bins.shoesWhy));
  if (bins.palette.length) {
    // Harmony, shares and chroma read the palette as people name it, one
    // name, one entry; value reads every swatch's own lightness, so a light
    // grey over a dark grey keeps its range.
    const named = byName(bins.palette);
    lines.push(harmonyLine(named, bins.waist), valueLine(bins.palette, bins.top.L, bins.bottom.L), sharesLine(named), chromaLine(named, bins.waist));
  }
  return lines;
}

export function readOutfit(m: OutfitMeasure, palette: Swatch[]): OutfitReading {
  const bins = binsOf(m, palette);
  const rawBreak = m.breakRow === null ? null : (m.breakRow - m.top) / (m.bottom - m.top);
  return { engine: ENGINE_VERSION, bins, lines: readBins(bins, rawBreak) };
}
