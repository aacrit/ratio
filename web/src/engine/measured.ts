// The "Measured" line of each rule, in words: what the engine measured, with
// every number the rule's advice quotes (tests/consistency.test.ts holds it
// to that). Colours are listed as people read them, one name, one entry
// (names.ts byName), the same view the colour rules read.

import { byName, colourLabel } from "./names";
import { pieces } from "./pieces";
import { type AdviceLine, type Bins, ratioText } from "./rules";

const two = (v: number) => v.toFixed(2);

export function measuredCopy(line: AdviceLine, bins: Bins): string {
  const named = byName(bins.palette);
  const each = (value: (s: (typeof named)[number]) => number) => named.map((s) => `${colourLabel(s)} ${two(value(s))}`).join(", ");
  switch (line.rule) {
    case "volume":
      return bins.fit ? `Upper piece ${two(bins.fit.top)}× the shoulder width at mid-torso; both legs ${two(bins.fit.legs)}× at the knee.` : "Volume was not measured.";
    case "legline": {
      const p = pieces(bins.palette, bins.waist, { top: bins.top, bottom: bins.bottom });
      if (p.lower < 0 || p.shoes < 0) return "Lightness of the lower piece against the shoes.";
      return `Lightness of the lower piece ${two(bins.palette[p.lower].L)}, the shoes ${two(bins.palette[p.shoes].L)}.`;
    }
    case "proportion":
      return bins.proportion === null
        ? "Upper and lower pieces measure as one colour, head to feet."
        : `The break sits at ${two(bins.proportion)} of the height, head to feet; the waist at ${ratioText(bins.waist)}.`;
    case "harmony":
      return `${named.length === 1 ? "1 colour" : `${named.length} colours`} in the outfit: ${named.map(colourLabel).join(", ")}.`;
    case "value":
      return `Upper piece ${two(bins.top.L)}, lower piece ${two(bins.bottom.L)}; lightness of each colour: ${each((s) => s.L)}.`;
    case "shares":
      return `Share of the outfit's area: ${each((s) => s.share)}.`;
    case "chroma":
      return `Chroma of each colour: ${each((s) => s.C)}.`;
  }
}
