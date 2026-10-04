// The rulebook as data: every rule's statement, its maths, its band edges,
// its sources and whether its edges are calibrated yet. The read screen's
// "Rule" lines and the Rulebook page both render from this one object, and
// tests check every rule the engine can produce has an entry here (V1: show
// the method). Band edges here are the same constants the rules use.

import { FIT_TOLERANCE, TEMPLATES } from "./colour-rules";
import { CONTRAST_EDGES, FIT_LEGS, FIT_TOP, LEG_LINE_EDGE, NEUTRAL_CHROMA, SATURATED_CHROMA, SHARE_EDGES, VALUE_GAP_EDGES } from "./constants";

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
  /** False while the edges are first estimates, before the labelled fixtures (risk R1) set them. */
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
    maths: "The break is the row where the upper garment's colour gives way to the lower's (one change point over the garment rows), as a fraction of the figure from the crown (0) to the soles (1), rounded to 0.02.",
    edges: [
      { name: "short top", value: "below 0.30" },
      { name: "composed: a third (0.333) or the golden section (0.382)", value: "0.30 to 0.44" },
      { name: "halves", value: "0.44 to 0.56" },
      { name: "composed from below (0.618, 0.667)", value: "0.56 to 0.70" },
      { name: "long top", value: "0.70 and above" },
    ],
    sources: [EUCLID],
    calibrated: true,
  },
  volume: {
    title: "Volume",
    rule: "One fitted volume against one fuller one keeps a line; two full volumes read as unanchored, two fitted ones as streamlined.",
    maths: "Fabric width (garment pixels across one row, so stance and arms do not count) of the upper piece halfway down the torso, and of both legs at the knee, each against the distance between the shoulders. Rounded to 0.05.",
    edges: [
      { name: "upper piece: fitted / straight / loose", value: `below ${FIT_TOP[0]} / to ${FIT_TOP[1]} / above` },
      { name: "legs: narrow / straight / wide", value: `below ${FIT_LEGS[0]} / to ${FIT_LEGS[1]} / above` },
    ],
    sources: [{ label: "Tailoring convention: balance a full piece with a fitted one" }],
    calibrated: false,
  },
  legline: {
    title: "Leg line",
    rule: "Shoes close in value to the lower piece continue the leg line; shoes in strong contrast end it at the ankle.",
    maths: "The OKLab lightness difference between the lower piece and the shoes.",
    edges: [{ name: "continuous below", value: LEG_LINE_EDGE }],
    sources: [DOW, OKLAB],
    calibrated: false,
  },
  harmony: {
    title: "Harmony",
    rule: "Matsuda's hue templates, fitted on the perceptual OKLCH wheel: a few shapes of hues that sit well together. A palette inside one reads as harmonious.",
    maths: `Each template is rotated in 1° steps: ${TEMPLATES.map((t) => `${t.name} (${t.gloss})`).join(", ")}. Its cost is the area-weighted angle by which the outfit's hues fall outside its sectors. The first template, most specific first, with a cost of ${FIT_TOLERANCE}° or less names the palette.`,
    edges: [
      { name: "a colour counts as a neutral below chroma (rising with lightness to 0.045 at white)", value: NEUTRAL_CHROMA },
      { name: "fit tolerance (area-weighted degrees)", value: FIT_TOLERANCE },
    ],
    sources: [HARMONIZATION, OKLAB],
    calibrated: true,
  },
  value: {
    title: "Value",
    rule: "Lightness carries form before hue does. A darker value below a lighter one grounds a figure; the widest lightness edge draws the eye first.",
    maths: "OKLab lightness of each colour holding at least 5% of the garment area; the range is the widest minus the narrowest. The upper and lower pieces are compared directly.",
    edges: [
      { name: "range: low / medium / high", value: `below ${CONTRAST_EDGES[0]} / to ${CONTRAST_EDGES[1]} / above` },
      { name: "upper and lower read as one tone within", value: VALUE_GAP_EDGES[0] },
      { name: "dark over light becomes advice beyond", value: VALUE_GAP_EDGES[1] },
    ],
    sources: [DOW, OKLAB],
    calibrated: true,
  },
  shares: {
    title: "Colour shares",
    rule: "Colour by area: one dominant, one secondary, one accent, near 0.60 · 0.30 · 0.10. Equal shares compete for the lead.",
    maths: "Each colour's share of the garment area, rounded to 0.05.",
    edges: [
      { name: "one colour reads as a column at", value: SHARE_EDGES.column },
      { name: "two colours compete when within", value: SHARE_EDGES.compete },
      { name: "close to 60-30-10 within (summed difference)", value: SHARE_EDGES.near6030 },
    ],
    sources: [{ label: "Interior design and painting convention, 60-30-10" }, EUCLID],
    calibrated: true,
  },
  chroma: {
    title: "Chroma",
    rule: "One saturated colour among muted ones reads as a single voice. Complements at equal lightness vibrate where they meet (Albers).",
    maths: "OKLCH chroma of each colour. Vibration: two colours at least 150° apart, both of chroma 0.10 or more, within 0.08 of each other in lightness.",
    edges: [{ name: "saturated from chroma", value: SATURATED_CHROMA }],
    sources: [ALBERS, OKLAB],
    calibrated: true,
  },
};
