// The Rulebook page's instruments as data (design/spec.md, Rulebook). Pure:
// no DOM, so the build renders the page from it (render.ts) and the tests
// read it directly. Every edge here is the engine's own constant, and every
// band is found the way the engine finds it, so what a hand finds by
// dragging a handle is what a reading would say.

import { FIT_TOLERANCE, TEMPLATES, fitTemplate } from "../engine/colour-rules";
import { hueGap } from "../engine/color";
import { CONTRAST_EDGES, FIT_LEGS, FIT_TOP, LEG_LINE_EDGE, SATURATED_CHROMA, SHARES_REFERENCE, isNeutral, nearEdge } from "../engine/constants";
import { byName } from "../engine/names";
import { pieces } from "../engine/pieces";
import type { RuleId } from "../engine/rulebook";
import { type Bins, PROPORTION_BANDS, PROPORTION_BIN, type ProportionBand } from "../engine/rules";

/** The order the cards are read in: the proportion hero first, then shape, then colour. */
export const RULE_ORDER: readonly RuleId[] = ["proportion", "volume", "legline", "harmony", "value", "shares", "chroma"];

const NUMBER_WORDS = ["No", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine", "Ten", "Eleven", "Twelve"];
/** The page title counts the rules it shows, in words. */
export const countWord = (n: number): string => NUMBER_WORDS[n] ?? String(n);

// ---- Proportion: the hero instrument ----------------------------------------

/** What each proportion band is called beside the tape, in the live note and to a screen reader (short; the drill names them in full from RULEBOOK). */
export const PROPORTION_LABELS: Record<ProportionBand, string> = {
  "short-top": "short top",
  golden: "section",
  halves: "halves",
  "golden-long": "section, below",
  "long-top": "long top",
};

/** The band edges the engine reads against (every band's start but the first). */
export const PROPORTION_EDGES: readonly number[] = PROPORTION_BANDS.slice(1).map((b) => b.from);

/** The break the handle may reach, and its step (the engine's bin). */
export const PROPORTION_RANGE = { min: 0.1, max: 0.9, step: PROPORTION_BIN } as const;

const snap = (v: number, min: number, max: number, step: number) => {
  const clamped = Math.max(min, Math.min(max, v));
  return Number((Math.round(clamped / step) * step).toFixed(4));
};

export interface ProportionAt {
  /** The break, snapped to the engine's bin. */
  r: number;
  band: ProportionBand;
  label: string;
  /** Within half a bin of an edge: a slightly different photo could read the other side. */
  onEdge: boolean;
}

/** Where a break falls: the engine's band (PROPORTION_BANDS) and its borderline test (nearEdge). */
export function proportionAt(raw: number): ProportionAt {
  const r = snap(raw, PROPORTION_RANGE.min, PROPORTION_RANGE.max, PROPORTION_RANGE.step);
  const band = (PROPORTION_BANDS.find((b) => r >= b.from && r < b.to) ?? PROPORTION_BANDS[PROPORTION_BANDS.length - 1]).id;
  return { r, band, label: PROPORTION_LABELS[band], onEdge: nearEdge(r, PROPORTION_EDGES, PROPORTION_BIN) };
}

/** The ratio pair with thin spaces round the colon (design/BRAND.md). */
export const pairText = (r: number) => `${r.toFixed(2)} : ${(1 - r).toFixed(2)}`;

/** The live line under "Yours" while the break is dragged. */
export function proportionNote(raw: number): string {
  const p = proportionAt(raw);
  return `Drag the line: ${p.r.toFixed(2)}, ${p.label}${p.onEdge ? ", on the edge" : ""}.`;
}

// ---- Scales: one value on one line, its edges, its bands ---------------------

export interface ScaleDef {
  id: string;
  rule: RuleId;
  /** The scale's caption in the instrument. */
  title: string;
  min: number;
  max: number;
  /** The handle's step: the engine's bin for this measurement. */
  step: number;
  edges: readonly number[];
  /** One name per band: edges.length + 1 of them. */
  bands: readonly string[];
  /** The bin the engine's borderline test uses for this value (nearEdge). */
  borderlineBin: number;
  /** The value as shown, e.g. "1.30×" or "ΔL 0.06". */
  format: (v: number) => string;
  /** Where the handle starts with no read: the middle band's middle. */
  start: number;
  /** What the range control is, for a screen reader. */
  label: string;
}

const two = (v: number) => v.toFixed(2);
const mid = (edges: readonly number[], min: number, max: number) => {
  const i = Math.floor(edges.length / 2);
  const lo = i === 0 ? min : edges[i - 1];
  const hi = i < edges.length ? edges[i] : max;
  return (lo + hi) / 2;
};

function scale(d: Omit<ScaleDef, "start">): ScaleDef {
  return { ...d, start: snap(mid(d.edges, d.min, d.max), d.min, d.max, d.step) };
}

export const SCALES: readonly ScaleDef[] = [
  scale({ id: "volume-top", rule: "volume", title: "upper piece, × shoulders", min: 0.9, max: 1.8, step: 0.05, edges: FIT_TOP, bands: ["fitted", "straight", "loose"], borderlineBin: 0.05, format: (v) => `${two(v)}×`, label: "The upper piece's width over the shoulders" }),
  scale({ id: "volume-legs", rule: "volume", title: "both legs at the knee, × shoulders", min: 0.4, max: 1.1, step: 0.05, edges: FIT_LEGS, bands: ["narrow", "straight", "wide"], borderlineBin: 0.05, format: (v) => `${two(v)}×`, label: "Both legs' width at the knee over the shoulders" }),
  scale({ id: "legline", rule: "legline", title: "lightness gap, lower piece to shoes", min: 0, max: 0.5, step: 0.02, edges: [LEG_LINE_EDGE], bands: ["the line runs on", "the line ends at the ankle"], borderlineBin: 0.04, format: (v) => `ΔL ${two(v)}`, label: "The lightness gap between the lower piece and the shoes" }),
  scale({ id: "value", rule: "value", title: "lightness range of the palette", min: 0, max: 1, step: 0.02, edges: CONTRAST_EDGES, bands: ["low", "medium", "high"], borderlineBin: 0.04, format: (v) => `range ${two(v)}`, label: "The lightness range, lightest colour minus darkest" }),
  // Chroma: the one edge RULEBOOK states. Whether a colour is a neutral depends on its lightness too
  // (neutralChromaAt), so the scale draws no fixed neutral band; each of your colours says it itself.
  scale({ id: "chroma", rule: "chroma", title: "chroma of a colour, OKLCH", min: 0, max: 0.25, step: 0.01, edges: [SATURATED_CHROMA], bands: ["muted", "saturated"], borderlineBin: 0.01, format: (v) => two(v), label: "A colour's chroma" }),
];

export const scaleById = (id: string): ScaleDef => {
  const s = SCALES.find((x) => x.id === id);
  if (!s) throw new Error(`no scale ${id}`);
  return s;
};

export interface ScaleAt {
  v: number;
  band: string;
  onEdge: boolean;
}

/** A value's band on a scale: below the first edge is the first band, at or past an edge the next (as the engine reads). */
export function scaleAt(s: ScaleDef, raw: number): ScaleAt {
  const v = snap(raw, s.min, s.max, s.step);
  let i = 0;
  while (i < s.edges.length && v >= s.edges[i] - 1e-9) i++;
  return { v, band: s.bands[i], onEdge: nearEdge(v, s.edges, s.borderlineBin) };
}

export function scaleNote(s: ScaleDef, raw: number): string {
  const a = scaleAt(s, raw);
  return `${s.format(a.v)}, ${a.band}${a.onEdge ? ", on the edge" : ""}`;
}

// ---- Geometry shared by the build and the page --------------------------------

/** The proportion instrument: the tape runs from the crown to the soles at these y (viewBox 320 × 440). */
export const PROP_GEOM = { crown: 22, sole: 420, tapeX: 120, handleEnd: 262 } as const;
export const propY = (r: number) => PROP_GEOM.crown + (PROP_GEOM.sole - PROP_GEOM.crown) * r;

/** A scale's line in a 256-wide instrument. */
export const SCALE_X = { from: 14, to: 242 } as const;
export const scaleX = (s: ScaleDef, v: number) => SCALE_X.from + ((SCALE_X.to - SCALE_X.from) * (Math.max(s.min, Math.min(s.max, v)) - s.min)) / (s.max - s.min);

/** The hue ring: hue 0 at the top, clockwise, as the CSS conic gradient draws it. */
export const RING = { cx: 128, cy: 100, r: 69 } as const;
export function huePoint(h: number, r: number = RING.r): { x: number; y: number } {
  const a = ((h - 90) * Math.PI) / 180;
  return { x: RING.cx + r * Math.cos(a), y: RING.cy + r * Math.sin(a) };
}

/** A sector of the ring as an SVG path, from hue a to hue b clockwise. */
export function sectorPath(a: number, b: number, r: number = RING.r): string {
  const p = huePoint(a, r);
  const q = huePoint(b, r);
  const large = (((b - a) % 360) + 360) % 360 > 180 ? 1 : 0;
  return `M${RING.cx} ${RING.cy} L${p.x.toFixed(1)} ${p.y.toFixed(1)} A${r} ${r} 0 ${large} 1 ${q.x.toFixed(1)} ${q.y.toFixed(1)} Z`;
}

// ---- Yours: the last read's values, for each instrument ----------------------

export interface HarmonyFit {
  name: string;
  gloss: string;
  rot: number;
  sectors: readonly [number, number][];
  fits: boolean;
  hues: { h: number; L: number; C: number; outside: number }[];
}

/** The template the engine names for these hues (the first within tolerance), or the nearest when none fits. */
export function harmonyFit(palette: Bins["palette"]): HarmonyFit | null {
  const chromatic = palette.filter((s) => !isNeutral(s));
  if (chromatic.length === 0) return null;
  let pick: { t: (typeof TEMPLATES)[number]; rot: number; cost: number } | null = null;
  for (const t of TEMPLATES) {
    const f = fitTemplate(chromatic, t);
    if (f.cost <= FIT_TOLERANCE) {
      pick = { t, ...f };
      break;
    }
    if (!pick || f.cost < pick.cost) pick = { t, ...f };
  }
  if (!pick) return null;
  const { t, rot } = pick;
  const outside = (h: number) => Math.min(...t.sectors.map(([off, w]) => Math.max(0, hueGap(h, (rot + off) % 360) - w / 2)));
  return {
    name: t.name,
    gloss: t.gloss,
    rot,
    sectors: t.sectors,
    fits: pick.cost <= FIT_TOLERANCE,
    hues: chromatic.map((s) => ({ h: s.h, L: s.L, C: s.C, outside: Math.round(outside(s.h)) })),
  };
}

export interface YoursValues {
  proportion: number | null;
  volumeTop: number | null;
  volumeLegs: number | null;
  /** The lower piece's and the shoes' lightness, when both were found. */
  legline: { lower: number; shoes: number; gap: number } | null;
  /** Each colour (at least 5% of the area) on the lightness scale, and the range. */
  value: { ls: number[]; range: number } | null;
  shares: { share: number; L: number; C: number; h: number }[];
  /** Each colour's chroma, and whether the engine reads it as a neutral (neutralChromaAt its lightness). */
  chroma: { L: number; C: number; h: number; neutral: boolean }[];
  harmony: HarmonyFit | null;
}

/** Every instrument's marker for a set of bins, measured the way the engine measures it. */
export function yoursValues(b: Bins): YoursValues {
  const p = pieces(b.palette, b.waist, { top: b.top, bottom: b.bottom });
  // As the engine reads them: harmony, shares and chroma over one entry per
  // colour name (names.ts byName); value and the leg line over each colour's
  // own lightness.
  const named = byName(b.palette);
  const ls = b.palette.filter((s) => s.share >= 0.05).map((s) => s.L);
  const fix = (v: number) => Number(v.toFixed(2));
  return {
    proportion: b.proportion,
    volumeTop: b.fit ? b.fit.top : null,
    volumeLegs: b.fit ? b.fit.legs : null,
    legline: p.lower >= 0 && p.shoes >= 0 ? { lower: b.palette[p.lower].L, shoes: b.palette[p.shoes].L, gap: fix(Math.abs(b.palette[p.lower].L - b.palette[p.shoes].L)) } : null,
    value: ls.length ? { ls, range: fix(Math.max(...ls) - Math.min(...ls)) } : null,
    shares: named.map(({ share, L, C, h }) => ({ share, L, C, h })),
    chroma: named.map(({ L, C, h }) => ({ L, C, h, neutral: isNeutral({ L, C }) })),
    harmony: harmonyFit(named),
  };
}

/** Which scales each instrument carries, and the y of each scale's line (viewBox 256 × 200). */
export const SCALE_LAYOUT: Partial<Record<RuleId, readonly { id: string; y: number }[]>> = {
  volume: [
    { id: "volume-top", y: 54 },
    { id: "volume-legs", y: 150 },
  ],
  legline: [{ id: "legline", y: 56 }],
  value: [{ id: "value", y: 56 }],
  chroma: [{ id: "chroma", y: 56 }],
};

export { SHARES_REFERENCE };

/** The lightness strip's ends: the token gradient runs from --scale-lightness-dark (L 0.1) to --scale-lightness-light (L 0.98). */
export const LIGHTNESS_STRIP = { from: 0.1, to: 0.98 } as const;
/** Where a lightness sits on the strip, in the instrument's x (clamped to the strip's ends). */
export const stripX = (L: number) => SCALE_X.from + (SCALE_X.to - SCALE_X.from) * Math.max(0, Math.min(1, (L - LIGHTNESS_STRIP.from) / (LIGHTNESS_STRIP.to - LIGHTNESS_STRIP.from)));

/** A marked value beyond a scale's ends: the marker sits at the end and says so, so the handle and "Yours" never disagree silently. */
export const offScale = (v: number, min: number, max: number): "below" | "above" | null => (v < min - 1e-9 ? "below" : v > max + 1e-9 ? "above" : null);

/**
 * The arrow keys on an instrument: the handle moves the way the arrow points
 * (Noor, 2026-10-04: ArrowDown moved the proportion handle up). On the
 * vertical tape, Down moves the break down the figure (a larger value) and
 * Up moves it up; Right and Left move the value the way they do on every
 * horizontal scale, Right up the value (down the tape), Left down it. On a
 * horizontal scale, Right and Up raise the value, Left and Down lower it.
 * Page keys move five steps; Home and End go to the ends. Returns the steps
 * to move, or "min" / "max", or null for any other key.
 */
export function keyStep(key: string, vertical: boolean): number | "min" | "max" | null {
  switch (key) {
    case "ArrowDown":
      return vertical ? 1 : -1;
    case "ArrowUp":
      return vertical ? -1 : 1;
    case "ArrowRight":
      return 1;
    case "ArrowLeft":
      return -1;
    case "PageDown":
      return vertical ? 5 : -5;
    case "PageUp":
      return vertical ? -5 : 5;
    case "Home":
      return "min";
    case "End":
      return "max";
    default:
      return null;
  }
}

/** A handle is taken only by a press within this many instrument units of it, so a thumb scrolling the page past an instrument never moves it. */
export const HANDLE_HIT = 22;

/** The harmony instrument's example before a read: Matsuda's Y, set where the mock shows it. */
export const HARMONY_EXAMPLE = { id: "Y", rot: 65 } as const;
