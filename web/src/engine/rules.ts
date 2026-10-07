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
import { byName, renamingNudges } from "./names";
import { type Recolour, accentOf, pieceOf, pieces } from "./pieces";
import type { RuleId } from "./rulebook";
import { type Fit, legBorderline, legLine, legUnread, shoesContinue, volumeLine, volumeUnread } from "./shape-rules";
import type { OutfitMeasure, ShoesWhy } from "./measure";
import type { Swatch } from "./palette";

export { NEUTRAL_CHROMA };

// 0.10.0 (T6, UX pass 3): every line agrees with the others and names the
// garment; a half-read volume is "unread" (not judged), never "fine"; the
// proportion line's shoe clause follows the leg line; accent shoes are never
// asked to change; harmony's Measured shows the plain name; every look move
// says why.
// 0.11.0 (T9, UX pass 4): a tailor's words. Volume's reference is "across
// the shoulders" (the spec-sheet term), so it holds when the upper piece is
// not read; a piece's lightness is its measured core in every line
// (pieceLightness); the golden section is never shortened to "the section";
// a row that is fine or on the mark ends in a plain verdict; a look's
// reasons name the rule it moves, and no two looks share one.
export const ENGINE_VERSION = "ratio-engine/0.11.0";

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

/**
 * Phrases that make a body part the thing measured (Mara, UX pass 3: "each
 * leg reads narrow, 0.40× the shoulder width"). No line the rulebook, the
 * Measured copy, the verdict or a look can produce contains one
 * (tests/engine.test.ts, tests/advice-agrees.test.ts). Where a line names
 * a place on the figure it names the garment's line: across the shoulders,
 * the knee line, the hem, the shoe.
 *
 * "shoulder line" is listed too (Mara, UX pass 4): to a tailor it is the
 * seam from the neck to the shoulder point, not a width, so no line says it.
 * The reference is "across the shoulders", the garment spec-sheet term
 * (founder, 2026-10-07), which bodyMeasureIn allows.
 */
export const BODY_MEASURE_WORDS = ["shoulder line", "each leg", "your leg", "the legs", "her leg", "his leg", "shoulder width", "your shoulder", "the shoulders", "torso", "at the ankle", "your body", "your waist", "your hips", "the hips", "body shape", "body type"];

/**
 * Body words on their own (review round 1). The garment's lines a tailor
 * drafts by, "knee line" and "hip line", stay allowed, and so do "shoulder
 * points", the pose landmarks the Rulebook names plainly as what it
 * measures between, and "across the shoulders", the spec-sheet measure
 * (bodyMeasureIn). "Figure" is the drawn outline and stays.
 */
export const BODY_PART_PATTERNS: readonly RegExp[] = [
  /\bknees?\b(?! line)/i,
  /\bshoulders?\b(?! points?\b)/i,
  /\bhips?\b(?! line)/i,
  /\bthighs?\b/i,
  /\bchest\b/i,
  /\bbust\b/i,
  /\bneck\b/i,
  /\bbuild\b/i,
];

/** The first body-measure word or body part in a text, or null: the one lint every produced line, Rulebook text and Rules page label passes. */
export function bodyMeasureIn(raw: string): string | null {
  // The one allowed shoulder phrase, and only as a ratio's reference ("0.40× across the shoulders", or "× across the shoulders" in a scale title), is taken out before the lint reads the rest.
  const text = raw.replace(/((?:\d\.\d\d)?×) across the shoulders\b/gi, "$1");
  const lower = text.toLowerCase();
  const word = BODY_MEASURE_WORDS.find((w) => lower.includes(w));
  if (word) return word;
  for (const p of BODY_PART_PATTERNS) {
    const m = text.match(p);
    if (m) return m[0];
  }
  return null;
}

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
  /**
   * The recolours this line's text suggests, as a fix (advice) or as an
   * option a row offers. The verdict never keeps a colour any line
   * recolours (T6). A cut change (a tuck, a shorter or narrower piece) is
   * not a recolour.
   */
  recolours?: Recolour[];
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

/**
 * The lightness of the upper piece, the lower piece and the shoes: the one
 * source every line that quotes a piece's lightness reads (T9, Mara, UX pass
 * 4: the leg line quoted the lower piece's swatch, 0.32, the value line its
 * measured core, 0.26). The pieces are their measured cores (bins.top and
 * bins.bottom): one stable measurement per piece, so a one-bin change moves
 * the number by one bin. The swatch nearest a core could switch near a tie
 * and jump by 0.10 or more (T9 review round 1, law 2). The shoes are their
 * swatch, read from the boxes round the feet, the one measurement of them.
 * Palette swatches stay the source for colour (harmony, shares, chroma).
 */
export function pieceLightness(b: Pick<Bins, "palette" | "waist" | "top" | "bottom">): { upper: number; lower: number; shoes: number | null } {
  const p = pieces(b.palette, b.waist, { top: b.top, bottom: b.bottom });
  return { upper: b.top.L, lower: b.bottom.L, shoes: p.shoes >= 0 ? b.palette[p.shoes].L : null };
}

/** A ratio pair as one unit, thin spaces round the colon (design/BRAND.md). */
export const ratioText = (r: number) => `${r.toFixed(2)} : ${(1 - r).toFixed(2)}`;

/**
 * What the leg line found, for the proportion line's shoe clause: the shoes
 * continue the line, contrast with it, or were not read; and whether that
 * finding sits at the leg line's edge (its borderline).
 */
export interface ShoeLine {
  kind: "continue" | "contrast" | "unread";
  borderline: boolean;
}

function proportionLine(b: Bins, rawBreak: number | null, shoes: ShoeLine): AdviceLine {
  if (b.proportion === null) {
    // The shoe clause follows the leg line, so the two never disagree (Mara,
    // UX pass 3: "Keep the shoes close in value to hold it" over white shoes
    // the leg line said contrast).
    // The clause can flip with the leg line, so it carries the leg line's
    // borderline mark (law 2: never flipped silently).
    // The clause points to the row by its name, which reads the same on the
    // Rules page, where the Leg line card also follows this one (Sam, UX pass 4).
    const clause = {
      continue: " The shoes sit close in value too, so the column runs on to the floor (see Leg line below).",
      contrast: " The shoes contrast with it, so the column stops where the shoes begin (see Leg line below).",
      unread: "",
    }[shoes.kind];
    return {
      rule: "proportion",
      title: "Proportion",
      measured: "one column",
      text: `Top and bottom read as one colour, so the eye runs head to foot without a break.${clause} A single column is the longest line an outfit can draw: keep the column.`,
      state: "neutral",
      borderline: clause !== "" && shoes.borderline,
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
    // Every band names its division in full ("the golden section", never
    // "the section"), and the lower one is counted from the floor (Mara, UX
    // pass 4). No "block": a tailor names the piece.
    "short-top": { text: `The break sits high, near ${r.toFixed(2)} of the height, so the lower piece carries the length. Keep its line unbroken to the shoe and the length holds.`, state: "neutral" },
    golden: { text: `The break sits near ${nearestDivision(r)} of the height. The eye reads a short upper piece over a long lower one, the classic division. Keep the break where it is.`, state: "golden" },
    halves: {
      text: !tuckable(b)
        ? `Near-equal halves read as boxy. The upper piece opens down the front, so it hangs to its hem rather than tucking. ${shorter}`
        : `Near-equal halves read as boxy. If the upper piece tucks, a front tuck moves the break to the waist, about ${tuck}, near the golden section, and shows the rise of what you wear below.`,
      state: "advice",
    },
    // "Keep the lower block narrow" is gone: a width is Volume's to judge (Mara, UX pass 4).
    "golden-long": { text: `The break sits near ${nearestDivision(1 - r)}, counted from the floor: a long upper piece over a short lower one, the second classical division. Keep the break where it is.`, state: "golden" },
    "long-top": {
      text: !tuckable(b)
        ? `The upper piece covers most of the figure, so the break has little to divide. It opens down the front, so a belt would sit under it. ${shorter}`
        : `The upper piece covers most of the figure, so the break has little to divide. Belt it at the waist, about ${tuck}, to give the eye a division near the golden section.`,
      state: "advice",
    },
  };
  // A tuck, a belt or a shorter upper piece changes the cut, never a colour: no recolours.
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
  const p = pieces(bins.palette, bins.waist, { top: bins.top, bottom: bins.bottom });
  const legRead = p.lower >= 0 && p.shoes >= 0;
  // One lightness per piece, in every line that quotes it (pieceLightness).
  const light = pieceLightness(bins);
  // Accent shoes: the outfit's accent is the shoe swatch (and not also a
  // piece). The verdict keeps them, so no line recolours them.
  const accent = accentOf(bins.palette);
  const shoesAccent = accent >= 0 && pieceOf(accent, p) === "shoes";
  const shoeLine: ShoeLine = {
    kind: !legRead ? "unread" : shoesContinue(light.lower, light.shoes!) ? "continue" : "contrast",
    borderline: legRead && legBorderline(Math.abs(light.lower - light.shoes!)),
  };
  // Shoes another line keeps as worn: the accent, or shoes carrying the leg line on.
  const shoesKept = shoesAccent || shoeLine.kind === "continue";
  const lines = [proportionLine(bins, rawBreak, shoeLine)];
  if (bins.fit) lines.push(volumeLine(bins.fit, { oneSide: bins.fitOneSide, front: bins.front, why: bins.fitWhy }));
  else if (bins.fitWhy) lines.push(volumeUnread(bins.fitWhy));
  if (legRead) lines.push(legLine(light.lower, light.shoes!, shoesAccent));
  else if (p.shoes < 0 && bins.shoesWhy) lines.push(legUnread(bins.shoesWhy));
  if (bins.palette.length) {
    // Harmony, shares and chroma read the palette as people name it, one
    // name, one entry; value reads every swatch's own lightness, so a light
    // grey over a dark grey keeps its range.
    const named = byName(bins.palette);
    // A palette whose reading by name a one-bin lightness change would alter marks the lines that read it by name borderline (law 2).
    // A line the palette's reading by name could flip at a one-bin lightness change is borderline (law 2): the rule is re-run on each renaming nudge.
    const nudged = renamingNudges(bins.palette).map(byName);
    const edge = (l: AdviceLine, rerun: (p: typeof named) => AdviceLine): AdviceLine => (!l.borderline && nudged.some((p) => rerun(p).state !== l.state) ? { ...l, borderline: true } : l);
    const harmonyCtx = { shoesKept };
    const sharesCtx = { accent: accent >= 0, shoesKept: shoeLine.kind === "continue" };
    lines.push(
      edge(harmonyLine(named, bins.waist, harmonyCtx), (p) => harmonyLine(p, bins.waist, harmonyCtx)),
      // Darker shoes on their own only for shoes no other line keeps; shoes
      // that carry the leg line on darken with the lower piece, as a pair.
      valueLine(bins.palette, light.upper, light.lower, { shoes: p.shoes < 0 || shoesAccent ? "none" : shoeLine.kind === "continue" ? "matched" : "free" }),
      edge(sharesLine(named, sharesCtx), (p) => sharesLine(p, sharesCtx)),
      edge(chromaLine(named, bins.waist, harmonyCtx), (p) => chromaLine(p, bins.waist, harmonyCtx)),
    );
  }
  return lines;
}

export function readOutfit(m: OutfitMeasure, palette: Swatch[]): OutfitReading {
  const bins = binsOf(m, palette);
  const rawBreak = m.breakRow === null ? null : (m.breakRow - m.top) / (m.bottom - m.top);
  return { engine: ENGINE_VERSION, bins, lines: readBins(bins, rawBreak) };
}
