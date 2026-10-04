// Plain names for measured colours, so advice can say "navy" and not only
// "255°". A fixed table on the OKLCH wheel, split by lightness where a
// colour has a common dark or light name (navy, burgundy, olive, cream). The
// degrees are always shown beside the name: the name is a courtesy, the
// number is the measurement.

import { isNeutral } from "./constants";

interface Band {
  from: number;
  to: number;
  dark: string;
  mid: string;
  light: string;
}

// Hue bands in OKLCH degrees, chosen against common garment colours.
const BANDS: Band[] = [
  { from: 0, to: 20, dark: "burgundy", mid: "rose red", light: "pink" },
  { from: 20, to: 45, dark: "oxblood", mid: "red", light: "coral" },
  { from: 45, to: 70, dark: "rust", mid: "terracotta", light: "peach" },
  { from: 70, to: 95, dark: "brown", mid: "camel", light: "sand" },
  { from: 95, to: 115, dark: "olive brown", mid: "mustard", light: "cream" },
  { from: 115, to: 140, dark: "olive", mid: "khaki", light: "pale yellow" },
  { from: 140, to: 165, dark: "forest green", mid: "green", light: "mint" },
  { from: 165, to: 200, dark: "bottle green", mid: "teal", light: "sea green" },
  { from: 200, to: 230, dark: "petrol", mid: "steel blue", light: "sky blue" },
  { from: 230, to: 265, dark: "navy", mid: "blue", light: "powder blue" },
  { from: 265, to: 300, dark: "indigo", mid: "violet", light: "lavender" },
  { from: 300, to: 335, dark: "aubergine", mid: "plum", light: "lilac" },
  { from: 335, to: 360, dark: "wine", mid: "magenta", light: "blush" },
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
  return L < 0.38 ? band.dark : L > 0.72 ? band.light : band.mid;
}

/** "navy (255°)" or "black". */
export function colourLabel(s: { L: number; C: number; h: number }): string {
  const name = colourName(s.L, s.C, s.h);
  return isNeutral(s) ? name : `${name} (${Math.round(s.h)}°)`;
}
