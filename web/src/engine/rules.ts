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
import { type BinnedSwatch, NEUTRAL_CHROMA, type ColourRule, chromaLine, harmonyLine, sharesLine, valueLine } from "./colour-rules";
import type { OutfitMeasure } from "./measure";
import type { Swatch } from "./palette";

export { NEUTRAL_CHROMA };

export const ENGINE_VERSION = "ratio-engine/0.2.1";

export const GOLDEN = 0.382;
export const PROPORTION_BIN = 0.02;

/** Proportion bands on the break's position from the top of the head (0) to the feet (1). */
export const PROPORTION_BANDS = [
  { id: "short-top", from: 0, to: 0.34 },
  { id: "golden", from: 0.34, to: 0.44 },
  { id: "halves", from: 0.44, to: 0.56 },
  { id: "golden-long", from: 0.56, to: 0.66 },
  { id: "long-top", from: 0.66, to: 1.01 },
] as const;
export type ProportionBand = (typeof PROPORTION_BANDS)[number]["id"];

export const JUDGING_WORDS = ["flaw", "flatter", "slim", "fat", "ugly", "unflattering", "hide", "problem area", "beautiful", "attractive", "should be ashamed", "wrong body"];

// golden: the measurement sits near the golden section (the gold accent means
// only this). advice: a change is suggested. neutral: measured, nothing to change.
export type LineState = "golden" | "advice" | "neutral";

export interface AdviceLine {
  rule: "proportion" | ColourRule;
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
}

const round = (v: number, step: number) => Math.round(v / step) * step;
const fix = (v: number, digits = 2) => Number(v.toFixed(digits));

function bandOf<T extends { id: string; from: number; to: number }>(bands: readonly T[], v: number): T["id"] {
  return (bands.find((b) => v >= b.from && v < b.to) ?? bands[bands.length - 1]).id;
}

function borderlineIn(bands: readonly { from: number; to: number }[], raw: number, half: number): boolean {
  return bands.some((b) => b.from > 0 && Math.abs(raw - b.from) < half);
}

const binColour = (c: Lab) => {
  const { L, C, h } = labToLch(c);
  return { L: fix(round(L, 0.02)), C: fix(round(C, 0.01)), h: C < NEUTRAL_CHROMA ? 0 : fix(round(h, 5) % 360, 0) };
};

const binSwatch = (s: Swatch): BinnedSwatch => ({ ...binColour(s.lab), share: fix(round(s.share, 0.05)), y: fix(round(s.y, 0.05)) });

export function binsOf(m: OutfitMeasure, palette: Swatch[]): Bins {
  const height = m.bottom - m.top;
  return {
    proportion: m.breakRow === null ? null : fix(round((m.breakRow - m.top) / height, PROPORTION_BIN)),
    waist: fix(round((m.waistRow - m.top) / height, PROPORTION_BIN)),
    top: binColour(m.topColour),
    bottom: binColour(m.bottomColour),
    palette: palette.map(binSwatch),
  };
}

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
  const texts: Record<ProportionBand, { text: string; state: LineState }> = {
    "short-top": { text: `The break sits high, near ${r.toFixed(2)}, so the lower block carries the length. Keep the bottom's line unbroken to the shoe and the effect holds.`, state: "neutral" },
    golden: { text: `The break sits near the golden section (${GOLDEN}). The eye reads a short upper block over a long lower one, the classic division. Keep it.`, state: "golden" },
    halves: { text: `Near-equal halves read as boxy. A front tuck moves the break to your waist, about ${tuck}, near the golden section, and shows the rise of what you wear below.`, state: "advice" },
    "golden-long": { text: `The break sits near the golden section from below (${(1 - GOLDEN).toFixed(3)}): a long upper piece over a short lower one. It is the second classical division. Keep the lower block narrow.`, state: "golden" },
    "long-top": { text: `The upper piece covers most of the figure, so the break has little to divide. Belt it at the waist, about ${tuck}, to give the eye a division near the golden section.`, state: "advice" },
  };
  return { rule: "proportion", title: "Proportion", measured, ...texts[id], borderline };
}

export interface OutfitReading {
  engine: string;
  bins: Bins;
  lines: AdviceLine[];
}

export function readOutfit(m: OutfitMeasure, palette: Swatch[]): OutfitReading {
  const bins = binsOf(m, palette);
  const rawBreak = m.breakRow === null ? null : (m.breakRow - m.top) / (m.bottom - m.top);
  const lines = [proportionLine(bins, rawBreak)];
  if (bins.palette.length) {
    lines.push(harmonyLine(bins.palette, bins.waist), valueLine(bins.palette, bins.top.L, bins.bottom.L), sharesLine(bins.palette), chromaLine(bins.palette, bins.waist));
  }
  return { engine: ENGINE_VERSION, bins, lines };
}
