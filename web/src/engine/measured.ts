// The "Measured" line of each rule, in words: what the engine measured, with
// every number the rule's advice quotes (tests/consistency.test.ts holds it
// to that). Colours are listed as people read them, one name, one entry
// (names.ts byName), the same view the colour rules read.

import { byName, colourLabel, colourName } from "./names";
import { pieces } from "./pieces";
import { ACROSS_SHOULDERS, volumeWords } from "./shape-rules";
import { type AdviceLine, type Bins, pieceLightness, ratioText } from "./rules";

const two = (v: number) => v.toFixed(2);

/**
 * Each colour's own lightness, the values the value rule reads: one entry
 * per name, every distinct lightness under it ("grey 0.46 and 0.68").
 */
function lightness(bins: Bins): string {
  return byName(bins.palette)
    .map((e) => {
      const ls = [...new Set(bins.palette.filter((s) => s.share > 0 && colourName(s.L, s.C, s.h) === e.name).map((s) => two(s.L)))];
      return `${colourLabel(e)} ${ls.length > 1 ? `${ls.slice(0, -1).join(", ")} and ${ls.at(-1)}` : ls[0]}`;
    })
    .join(", ");
}

export function measuredCopy(line: AdviceLine, bins: Bins): string {
  const named = byName(bins.palette);
  const each = (value: (s: (typeof named)[number]) => number) => named.map((s) => `${colourLabel(s)} ${two(value(s))}`).join(", ");
  switch (line.rule) {
    case "volume": {
      if (!bins.fit) return bins.fitWhy === "arms" ? "Not read: an arm or a hand lies over the upper piece's edges on every row Ratio reads it on." : "Volume was not measured.";
      // The words come from the same function the rule uses (shape-rules.ts volumeWords).
      const w = volumeWords(bins.fit);
      const upper =
        bins.fit.top === null
          ? bins.fitWhy === "arms"
            ? "Upper piece not read: an arm or a hand lies over its edges on every row"
            : "Upper piece not read: its width could not be read on these rows"
          : `Upper piece ${two(bins.fit.top)}× ${ACROSS_SHOULDERS}${bins.fitOneSide ? ", read on one side," : ""} on the rows no arm crosses, ${w.top}`;
      // Garment lines only, never a body measure (T6), and every ratio names its reference (T9, Noor):
      // the lower piece at its knee line, against the span across the shoulders, which is read even when the upper piece is not.
      const legs = bins.fit.legs === null ? "lower piece not read" : `lower piece at the knee line, ${two(bins.fit.legs)}× ${ACROSS_SHOULDERS}, ${w.legs}`;
      return `${upper}; ${legs}.`;
    }
    case "legline": {
      const p = pieces(bins.palette, bins.waist, { top: bins.top, bottom: bins.bottom });
      if (p.shoes < 0 && bins.shoesWhy) return bins.shoesWhy === "cut_off" ? "Not read: the frame cuts the shoes off." : "Not read: the shoes merge with the floor.";
      if (p.lower < 0 || p.shoes < 0) return "Lightness of the lower piece against the shoes.";
      const pl = pieceLightness(bins);
      return `Lightness of the lower piece ${two(pl.lower)}, the shoes ${two(pl.shoes!)}.`;
    }
    case "proportion":
      return bins.proportion === null
        ? "Upper and lower pieces measure as one colour, head to feet."
        : `The break sits at ${two(bins.proportion)} of the height, head to feet; the waist at ${ratioText(bins.waist)}.`;
    case "harmony":
      return `${named.length === 1 ? "1 colour" : `${named.length} colours`} in the outfit: ${named.map(colourLabel).join(", ")}.`;
    case "value": {
      // The pieces' lightness is their measured cores (pieceLightness), the numbers the leg line quotes too (T9, Mara);
      // the list after it is each palette colour's own lightness, labelled by colour, which the range reads.
      const pl = pieceLightness(bins);
      return `Pieces at their measured core: upper ${two(pl.upper)}, lower ${two(pl.lower)}. Colours: ${lightness(bins)}.`;
    }
    case "shares":
      return `Share of the outfit's area: ${each((s) => s.share)}.`;
    case "chroma":
      return `Chroma of each colour: ${each((s) => s.C)}.`;
  }
}
