// Suggested looks are judged by the rulebook itself, never fix one rule by
// breaking another, are the same every time, and "try it" changes only the
// garment's colour, keeping each pixel's own lightness offset.

import { describe, expect, it } from "vitest";
import { oklabToSrgb, srgbToOklab } from "../web/src/engine/color";
import type { BinnedSwatch } from "../web/src/engine/colour-rules";
import { applyMove, candidateMoves, normalise, pieces, scoreOf, suggestLooks } from "../web/src/engine/looks";
import { colourName } from "../web/src/engine/names";
import type { Swatch } from "../web/src/engine/palette";
import { type Bins, JUDGING_WORDS, readBins } from "../web/src/engine/rules";
import { recolour } from "../web/src/tryon/recolour";

const sw = (L: number, C: number, h: number, share: number, y: number): BinnedSwatch => ({ L, C, h, share, y });

/** The founder's example: a sand tee untucked over a teal-ish lower piece that clashes, white shoes. */
function example(): Bins {
  const palette = [sw(0.8, 0.05, 80, 0.5, 0.3), sw(0.45, 0.1, 150, 0.4, 0.65), sw(0.95, 0, 0, 0.1, 0.95)];
  return { proportion: 0.5, waist: 0.38, top: { L: 0.8, C: 0.05, h: 80 }, bottom: { L: 0.45, C: 0.1, h: 150 }, palette };
}

describe("colour space round trip", () => {
  it("OKLab to sRGB inverts sRGB to OKLab", () => {
    for (const rgb of [[0, 0, 0], [255, 255, 255], [52, 78, 120], [200, 120, 60]] as const) {
      const back = oklabToSrgb(srgbToOklab(rgb[0], rgb[1], rgb[2]));
      back.forEach((v, i) => expect(Math.abs(v - rgb[i])).toBeLessThanOrEqual(1));
    }
  });
});

describe("colour names", () => {
  it("names neutrals by lightness and colours by hue band", () => {
    expect(colourName(0.15, 0, 0)).toBe("black");
    expect(colourName(0.95, 0, 0)).toBe("white");
    expect(colourName(0.3, 0.07, 255)).toBe("navy");
    expect(colourName(0.45, 0.06, 250)).toBe("denim");
  });
});

describe("pieces", () => {
  it("finds the upper piece, the lower piece and the shoes by where they sit", () => {
    expect(pieces(example())).toEqual({ upper: 0, lower: 1, shoes: 2 });
  });
});

describe("suggested looks", () => {
  it("proposes the tuck first for near-equal halves", () => {
    const b = example();
    const moves = candidateMoves(b, readBins(b));
    expect(moves[0]).toMatchObject({ kind: "break", to: 0.38, title: "Tuck the front" });
  });

  it("only returns looks the rulebook reads as better, best first", () => {
    const b = example();
    const before = scoreOf(readBins(b));
    const looks = suggestLooks(b, readBins(b));
    expect(looks.length).toBeGreaterThan(0);
    expect(looks.length).toBeLessThanOrEqual(3);
    for (const look of looks) expect(scoreOf(look.lines)).toBeGreaterThan(before);
    for (let i = 1; i < looks.length; i++) expect(looks[i - 1].gain).toBeGreaterThanOrEqual(looks[i].gain);
  });

  it("never fixes one rule by breaking another", () => {
    const b = example();
    const lines = readBins(b);
    for (const look of suggestLooks(b, lines)) {
      for (const l of look.lines) {
        const was = lines.find((x) => x.rule === l.rule)!;
        if (was.state !== "advice") expect(l.state, `${look.title}: ${l.rule}`).not.toBe("advice");
      }
    }
  });

  it("is deterministic", () => {
    const a = suggestLooks(example(), readBins(example()));
    const b = suggestLooks(example(), readBins(example()));
    expect(b.map((l) => l.id)).toEqual(a.map((l) => l.id));
  });

  it("suggests nothing when every reading is already fine", () => {
    const b: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.8, C: 0, h: 0 }, bottom: { L: 0.25, C: 0, h: 0 }, palette: [sw(0.25, 0, 0, 0.6, 0.65), sw(0.8, 0, 0, 0.3, 0.3), sw(0.5, 0.12, 30, 0.1, 0.95)] };
    const lines = readBins(b);
    if (lines.every((l) => l.state !== "advice")) expect(suggestLooks(b, lines).every((l) => l.gain > 0)).toBe(true);
  });

  it("keeps swatch indices through several moves, and merges only at the end", () => {
    const b = example();
    const tucked = applyMove(b, { kind: "break", to: 0.38, title: "", detail: "" });
    const recoloured = applyMove(tucked, { kind: "recolour", swatch: 1, L: 0.3, C: 0.07, h: 255, title: "", detail: "" });
    expect(recoloured.palette[1]).toMatchObject({ L: 0.3, C: 0.07, h: 255 });
    expect(recoloured.bottom).toEqual({ L: 0.3, C: 0.07, h: 255 });
    expect(normalise(recoloured).palette.reduce((t, s) => t + s.share, 0)).toBeCloseTo(1, 1);
  });

  it("never names the body or judges the person in a look", () => {
    for (const look of suggestLooks(example(), readBins(example()))) {
      const text = [look.title, ...look.moves.map((m) => m.detail), ...look.lines.map((l) => l.text)].join(" ").toLowerCase();
      for (const word of JUDGING_WORDS) expect(text).not.toContain(word);
    }
  });
});

describe("try it: recolour on the photo", () => {
  it("moves only the target garment's pixels and keeps each pixel's lightness offset", () => {
    // Two pixels of one garment (a lit fold and a shadow) and one background pixel.
    const data = new Uint8ClampedArray([180, 90, 60, 255, 120, 60, 40, 255, 10, 200, 10, 255]);
    const pixels = { width: 3, height: 1, data };
    const owner = Int8Array.from([0, 0, -1]);
    const lab = srgbToOklab(150, 75, 50);
    const swatches: Swatch[] = [{ lab, share: 1, y: 0.6 }];
    const out = recolour(pixels, owner, swatches, [{ kind: "recolour", swatch: 0, L: 0.3, C: 0.07, h: 255, title: "", detail: "" }]);
    expect(Array.from(out.data.slice(8))).toEqual([10, 200, 10, 255]);
    const lit = srgbToOklab(out.data[0], out.data[1], out.data[2]);
    const shade = srgbToOklab(out.data[4], out.data[5], out.data[6]);
    const litBefore = srgbToOklab(180, 90, 60), shadeBefore = srgbToOklab(120, 60, 40);
    expect(lit.L - shade.L).toBeCloseTo(litBefore.L - shadeBefore.L, 1);
    expect(Math.atan2(lit.b, lit.a)).toBeLessThan(0);
  });
});
