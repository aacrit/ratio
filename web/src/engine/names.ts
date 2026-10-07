// Plain names for measured colours, so advice can say "navy" and not only
// "255°". A fixed table on the OKLCH wheel, split by lightness where a
// colour has a common dark or light name (navy, burgundy, olive, cream). The
// degrees are always shown beside the name: the name is a courtesy, the
// number is the measurement.

import { isNeutral } from "./constants";

/** Hue families, for telling two suggestions apart: forest green, olive and bottle green are one idea. */
export type Family = "red" | "earth" | "green" | "blue" | "violet" | "neutral";

interface Band {
  from: number;
  to: number;
  dark: string;
  mid: string;
  light: string;
  family: Exclude<Family, "neutral">;
  /** Where the light name starts, when not at the usual 0.72, for colours under lightLowC chroma. */
  lightFrom?: number;
  lightLowC?: number;
}

// Hue bands in OKLCH degrees, chosen against common garment colours.
const BANDS: Band[] = [
  { from: 0, to: 20, dark: "burgundy", mid: "rose red", light: "pink", family: "red" },
  // Coral starts lower than other light names: a coral sits near L 0.65
  // (Mara, 2026-10-04: coral sneakers read as "red"), but only below
  // lightLowC chroma, so a scarlet at the same lightness stays red.
  { from: 20, to: 45, dark: "oxblood", mid: "red", light: "coral", family: "red", lightFrom: 0.62, lightLowC: 0.18 },
  { from: 45, to: 70, dark: "rust", mid: "terracotta", light: "peach", family: "earth" },
  { from: 70, to: 95, dark: "brown", mid: "camel", light: "sand", family: "earth" },
  { from: 95, to: 115, dark: "olive brown", mid: "mustard", light: "cream", family: "earth" },
  { from: 115, to: 140, dark: "olive", mid: "khaki", light: "pale yellow", family: "green" },
  { from: 140, to: 165, dark: "forest green", mid: "green", light: "mint", family: "green" },
  { from: 165, to: 200, dark: "bottle green", mid: "teal", light: "sea green", family: "green" },
  { from: 200, to: 230, dark: "petrol", mid: "steel blue", light: "sky blue", family: "blue" },
  { from: 230, to: 265, dark: "navy", mid: "blue", light: "powder blue", family: "blue" },
  { from: 265, to: 300, dark: "indigo", mid: "violet", light: "lavender", family: "violet" },
  { from: 300, to: 335, dark: "aubergine", mid: "plum", light: "lilac", family: "violet" },
  { from: 335, to: 360, dark: "wine", mid: "magenta", light: "blush", family: "red" },
];

export function colourName(L: number, C: number, h: number): string {
  if (isNeutral({ L, C })) {
    if (L < 0.28) return "black";
    if (L < 0.45) return "charcoal";
    if (L < 0.7) return "grey";
    if (L < 0.9) return "stone";
    return "white";
  }
  const band = BANDS.find((b) => h >= b.from && h < b.to) ?? BANDS[0];
  // Denim-blue and low-chroma blues read as denim, the commonest garment colour.
  if (h >= 230 && h < 265 && C < 0.08 && L >= 0.36 && L < 0.6) return "denim";
  const lightFrom = band.lightFrom !== undefined && C < (band.lightLowC ?? Infinity) ? band.lightFrom : 0.72;
  return L < 0.38 ? band.dark : L > lightFrom ? band.light : band.mid;
}

/** The hue family of a colour: one of five bands of the wheel, or neutral. */
export function familyOf(L: number, C: number, h: number): Family {
  if (isNeutral({ L, C })) return "neutral";
  return (BANDS.find((b) => h >= b.from && h < b.to) ?? BANDS[0]).family;
}

/** "navy (255°)" or "black". A swatch merged by name carries its name. */
export function colourLabel(s: { L: number; C: number; h: number; name?: string }): string {
  const name = s.name ?? colourName(s.L, s.C, s.h);
  return isNeutral(s) ? name : `${name} (${Math.round(s.h)}°)`;
}

const NEUTRAL_NAMES = new Set(["black", "charcoal", "grey", "stone", "white"]);

interface Placed {
  L: number;
  C: number;
  h: number;
  share: number;
  y: number;
}

/**
 * One name, one entry: the palette as people read it. Swatches that share a
 * plain name (a grey in light and a grey in shadow) become one entry with
 * their summed share, the larger one's hue, and the share-weighted lightness
 * and place (chroma is chosen so the entry keeps its name). Largest share
 * first; ties keep the palette's order. Harmony, shares and chroma read this
 * view (the Rulebook says so), and every list of colours on screen and on
 * the card shows it, so the numbers agree. Value reads each swatch's own
 * lightness: merging would average a light grey and a dark grey away.
 */
export function byName<T extends Placed>(palette: readonly T[]): (Placed & { name: string })[] {
  const out: (Placed & { name: string; w: number })[] = [];
  for (const s of palette) {
    // A speck the share binning took to zero is not listed.
    if (s.share <= 0) continue;
    const name = colourName(s.L, s.C, s.h);
    const into = out.find((e) => e.name === name);
    if (!into) {
      out.push({ L: s.L, C: s.C, h: s.h, share: s.share, y: s.y, name, w: s.share });
      continue;
    }
    const total = into.share + s.share;
    if (total > 0) {
      into.L = (into.L * into.share + s.L * s.share) / total;
      into.y = (into.y * into.share + s.y * s.share) / total;
    }
    if (s.share > into.w) { into.h = s.h; into.w = s.share; }
    // A neutral stays neutral and a colour stays a colour at the merged
    // lightness: the lower chroma for a neutral, the higher for a colour.
    into.C = NEUTRAL_NAMES.has(name) ? Math.min(into.C, s.C) : Math.max(into.C, s.C);
    into.share = total;
  }
  const fix = (v: number) => Number(v.toFixed(2));
  return out
    .map(({ w: _w, ...e }, i) => ({ e: { ...e, L: fix(e.L), share: fix(e.share), y: fix(e.y) }, i }))
    .sort((p, q) => q.e.share - p.e.share || p.i - q.i)
    .map((x) => x.e);
}

/**
 * Whether a one-bin change in any colour's lightness would change how the
 * palette is read by name: a colour whose name changes there and then joins
 * or leaves another colour of that name, or crosses the neutral line. The
 * rules that read the palette by name (harmony, shares, chroma) mark their
 * line borderline then, so it is never flipped silently (law 2, T9 review
 * round 1: shoes at 0.38 read as oxblood, at 0.40 as red). `hues`: only
 * colours count, for the rules that read the hues alone (harmony, chroma):
 * two neutrals trading names changes nothing they read.
 */
export function namingBorderline(palette: readonly Placed[], hues = false, step = 0.02): boolean {
  const live = palette.filter((s) => s.share > 0);
  const names = live.map((s) => colourName(s.L, s.C, s.h));
  return live.some((s, i) =>
    [-step, step].some((d) => {
      const L = Number((s.L + d).toFixed(2));
      const n = colourName(L, s.C, s.h);
      if (n === names[i]) return false;
      if (hues && isNeutral(s) && isNeutral({ L, C: s.C })) return false;
      return isNeutral({ L, C: s.C }) !== isNeutral(s) || names.some((x, j) => j !== i && (x === n || x === names[i]));
    }),
  );
}
