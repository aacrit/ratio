// The rulebook as data: every rule's statement, its maths, its band edges,
// its sources and whether its edges are calibrated yet. The read screen's
// "Rule" lines and the Rulebook page both render from this one object, and
// tests check every rule the engine can produce has an entry here (V1: show
// the method). Band edges here are the same constants the rules use.

import { FIT_TOLERANCE, TEMPLATES } from "./colour-rules";
import { CONTRAST_EDGES, FIT_LEGS, FIT_TOP, LEG_LINE_EDGE, NEUTRAL_CHROMA, neutralChromaAt, SATURATED_CHROMA, SHARES_REFERENCE, SHARE_EDGES, VALUE_GAP_EDGES, VIBRATION } from "./constants";

export interface Source {
  label: string;
  url?: string;
}

export interface RuleEntry {
  title: string;
  /** The rule in one or two plain sentences: what the read screen shows as "Rule". */
  rule: string;
  /** How it is measured, for the Rulebook page. */
  maths: string;
  /** Band edges, in the units the maths names. */
  edges: { name: string; value: number | string }[];
  sources: Source[];
  /**
   * True only when the edges were set against labelled photos (docs/RISKS.md
   * R1). Every edge today was set by hand, so every entry is false, and Read
   * says "first estimate" beside the advice of each (Mara, 2026-10-04).
   */
  calibrated: boolean;
}

export type RuleId = "proportion" | "volume" | "legline" | "harmony" | "value" | "shares" | "chroma";

const EUCLID: Source = { label: "Euclid, Elements VI, Definition 3 (extreme and mean ratio)", url: "https://mathcs.clarku.edu/~djoyce/elements/bookVI/defVI3.html" };
const OKLAB: Source = { label: "Björn Ottosson, A perceptual color space for image processing (OKLab, 2020)", url: "https://bottosson.github.io/posts/oklab/" };
const HARMONIZATION: Source = { label: "Cohen-Or, Sorkine, Gal, Leyvand, Xu, Color Harmonization (SIGGRAPH 2006), after Matsuda's hue templates", url: "https://igl.ethz.ch/projects/color-harmonization/" };
const ALBERS: Source = { label: "Josef Albers, Interaction of Color (1963)", url: "https://www.albersfoundation.org/" };
const DOW: Source = { label: "Arthur Wesley Dow, Composition (1899): notan, the arrangement of light and dark", url: "https://www.gutenberg.org/ebooks/search/?query=wesley+dow+composition" };

export const RULEBOOK: Record<RuleId, RuleEntry> = {
  proportion: {
    title: "Proportion",
    rule: "A break near a third (0.333) or the golden section (0.382) of the height reads as composed; near-equal halves read as boxy.",
    maths: "The break is the hem of the outer upper piece: the row where its colour, read on the two flanks of the figure (never the middle, where a zip, an open front or a t-shirt shows), gives way to the lower piece's. It is one change point searched from halfway between the shoulder points and the hip line down to the knee line, so a colour change inside the upper piece is not a break. As a fraction of the figure from the crown (0) to the soles (1), rounded to 0.02.",
    edges: [
      { name: "short top", value: "below 0.30" },
      { name: "composed: a third (0.333) or the golden section (0.382)", value: "0.30 to 0.44" },
      { name: "halves", value: "0.44 to 0.56" },
      { name: "composed, counted from the floor: the golden section or a third (0.618 or 0.667 from the crown)", value: "0.56 to 0.70" },
      { name: "long top", value: "0.70 and above" },
      { name: "the composed divisions: a third and the golden section", value: "0.333 and 0.382" },
    ],
    sources: [EUCLID],
    calibrated: false,
  },
  volume: {
    title: "Volume",
    rule: "One fitted volume against one fuller one keeps a line; two full volumes read as unanchored, two fitted ones as streamlined.",
    maths: "Both widths are held against one reference, which the reading calls across the shoulders, the garment spec sheet's term: plainly, the straight span between the two shoulder points the pose model marks, the points the upper piece hangs from. It is a distance in the photo, not a measurement of the garment's seams. It comes from the pose, not the cloth, so it is read even when the upper piece's own width is not. The upper piece's width is the run of fabric through the figure's centre line, on the middle half of the rows between the shoulder points and the hip line that no arm or hand crosses (the pose's elbows and wrists); when every row is crossed, its width is not read. The lower piece's width is the run of fabric at the knee line, taken on each side on its own (a skirt that spans both sides counts half to each). Both rounded to 0.05. One function turns these numbers into the words. When only one of the two is read, that one is said and the balance is not judged.",
    edges: [
      { name: "upper piece: fitted / straight / loose", value: `below ${FIT_TOP[0]} / to ${FIT_TOP[1]} / above` },
      { name: "lower piece at the knee line: narrow / straight / wide", value: `below ${FIT_LEGS[0]} / to ${FIT_LEGS[1]} / above` },
    ],
    sources: [{ label: "Tailoring convention: balance a full piece with a fitted one" }],
    calibrated: false,
  },
  legline: {
    title: "Leg line",
    rule: "Shoes close in value to the lower piece continue the leg line; shoes in strong contrast stop it where they begin, a point of their own.",
    maths: "The OKLab lightness difference between the lower piece and the shoes. The shoes are read from a box round each foot (the pose's ankle, heel and toe), the same shoes the palette and \"try it\" use; when the frame cuts them off or they merge with the floor, the line says so instead of guessing.",
    edges: [{ name: "continuous below", value: LEG_LINE_EDGE }],
    sources: [DOW, OKLAB],
    calibrated: false,
  },
  harmony: {
    title: "Harmony",
    rule: "Matsuda's hue templates, fitted on the perceptual OKLCH wheel: a few shapes of hues that sit well together. A palette inside one reads as harmonious.",
    maths: `Each template is rotated in 1° steps: ${TEMPLATES.map((t) => `${t.name} (${t.gloss})`).join(", ")}. Its cost is the area-weighted angle by which the outfit's hues fall outside its sectors. The first template, most specific first, with a cost of ${FIT_TOLERANCE}° or less names the palette. Colours with the same plain name count as one, at the hue of the larger and their summed area. Each colour is its garment's well-lit pixels, with the photo's colour cast taken off, so a coloured light cannot make a hue.`,
    edges: [
      { name: `a colour counts as a neutral at or below chroma (rising with lightness to ${neutralChromaAt(1).toFixed(3)} at white)`, value: NEUTRAL_CHROMA },
      { name: "fit tolerance (area-weighted degrees)", value: FIT_TOLERANCE },
    ],
    sources: [HARMONIZATION, OKLAB],
    calibrated: false,
  },
  value: {
    title: "Value",
    rule: "Lightness carries form before hue does. A darker value below a lighter one grounds a figure; the widest lightness edge draws the eye first.",
    maths: "OKLab lightness of each measured colour holding at least 5% of the garment area, each on its own even when two share a plain name (a light grey and a dark grey keep their range); the range is the widest minus the narrowest. The upper and lower pieces are compared directly, each at its own colour's lightness: the same number the palette, the leg line and the Measured list show.",
    edges: [
      { name: "range: low / medium / high", value: `below ${CONTRAST_EDGES[0]} / to ${CONTRAST_EDGES[1]} / above` },
      { name: "upper and lower read as one tone within", value: VALUE_GAP_EDGES[0] },
      { name: "dark over light becomes advice beyond", value: VALUE_GAP_EDGES[1] },
    ],
    sources: [DOW, OKLAB],
    calibrated: false,
  },
  shares: {
    title: "Colour shares",
    rule: `Colour by area: one dominant, one secondary, one accent, near ${SHARES_REFERENCE.map((s) => s.toFixed(2)).join(" · ")}. Equal shares compete for the lead.`,
    maths: "Each colour's share of the garment area, in 0.05 units shared out by largest remainder so the shares always sum to 1.00. Colours with the same plain name (two greys) count as one.",
    edges: [
      { name: "one colour reads as a column at", value: SHARE_EDGES.column },
      { name: "two colours compete when within", value: SHARE_EDGES.compete },
      { name: "close to 60-30-10 within (summed difference)", value: SHARE_EDGES.near6030 },
      { name: "the reference proportion", value: "0.60 · 0.30 · 0.10 (60-30-10)" },
    ],
    sources: [{ label: "Interior design convention, 60-30-10 (a rule of thumb of that trade, not a classical canon)" }],
    calibrated: false,
  },
  chroma: {
    title: "Chroma",
    rule: "One saturated colour among muted ones reads as a single voice. Complements at equal lightness vibrate where they meet (Albers).",
    maths: `OKLCH chroma of each colour, read from its garment's well-lit pixels (the median of the lightness core from the middle to near the top, its hue the core's, its chroma the median along that hue) with the photo's colour cast taken off; a colour at or below the neutral line (chroma ${NEUTRAL_CHROMA}, rising with lightness to ${neutralChromaAt(1).toFixed(3)} at white) counts as a neutral and is not read here; colours with the same plain name count as one, at the higher chroma and their area-weighted lightness. Vibration: two colours at least ${VIBRATION.minHueGap}° apart, both of chroma ${VIBRATION.minChroma.toFixed(2)} or more, within ${VIBRATION.maxLightnessGap} of each other in lightness.`,
    edges: [{ name: "saturated from chroma", value: SATURATED_CHROMA }],
    sources: [ALBERS, OKLAB],
    calibrated: false,
  },
};
