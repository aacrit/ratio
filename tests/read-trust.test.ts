// Read trust (T2, from Noor's pass, 2026-10-04): Ratio measures, palettes
// and recolours only the person it read; colour shares sum to 1.00; every
// number an advice line quotes is in its Measured line; one colour name is
// one entry; and the three suggested looks are different ideas.

import { describe, expect, it } from "vitest";
import { srgbToOklab } from "../web/src/engine/color";
import type { BinnedSwatch } from "../web/src/engine/colour-rules";
import { binShares } from "../web/src/engine/constants";
import { ideasOf, suggestLooks } from "../web/src/engine/looks";
import { measuredCopy } from "../web/src/engine/measured";
import { CATEGORY, type Landmark, type Mask, measureOutfit } from "../web/src/engine/measure";
import { byName, colourLabel, colourName, familyOf } from "../web/src/engine/names";
import { extractPalette, type Swatch } from "../web/src/engine/palette";
import { OTHER_MIN, isolatePerson, othersCopy } from "../web/src/engine/person";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { type Bins, ENGINE_VERSION, readBins, readOutfit } from "../web/src/engine/rules";
import { HONEST, NOT_ON_PHOTO, honesty } from "../web/src/tryon/recolour";

type Rgb = [number, number, number];
const W = 300;
const H = 400;

interface Scene {
  mask: Mask;
  pixels: { width: number; height: number; data: Uint8ClampedArray };
  pose: Landmark[];
}

function blank(): Scene {
  const mask: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([240, 240, 240, 255], i * 4);
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  return { mask, pixels: { width: W, height: H, data }, pose };
}

function fill(s: Scene, y0: number, y1: number, x0: number, x1: number, cat: number, rgb: Rgb) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s.mask.data[y * W + x] = cat;
      s.pixels.data.set([...rgb, 255], (y * W + x) * 4);
    }
}

/** A person standing with their body column centred at cx: head, upper piece to the hem, lower piece, shoes. */
function person(s: Scene, cx: number, upper: Rgb, lower: Rgb, opts: { pose?: boolean; shoesGap?: boolean } = {}) {
  fill(s, 10, 50, cx - 15, cx + 15, CATEGORY.faceSkin, [200, 160, 130]);
  fill(s, 50, 200, cx - 35, cx + 35, CATEGORY.clothes, upper);
  fill(s, 200, 380, cx - 25, cx + 25, CATEGORY.clothes, lower);
  // Shoes, optionally cut off from the legs by a one-row shadow.
  fill(s, opts.shoesGap ? 382 : 380, 395, cx - 25, cx + 25, CATEGORY.other, [30, 30, 30]);
  if (opts.pose === false) return;
  const at = (i: number, x: number, y: number) => (s.pose[i] = { x: x / W, y: y / H, visibility: 0.99 });
  at(0, cx, 32);
  at(11, cx - 25, 60);
  at(12, cx + 25, 60);
  at(23, cx - 15, 190);
  at(24, cx + 15, 190);
  at(25, cx - 12, 290);
  at(26, cx + 12, 290);
  at(27, cx - 10, 380);
  at(28, cx + 10, 380);
}

const SAND: Rgb = [214, 196, 160];
const DENIM: Rgb = [52, 78, 120];
const BURGUNDY: Rgb = [110, 30, 45];
const FOREST: Rgb = [40, 90, 50];

/** Every colour name in the palette, as the rules read it. */
const names = (bins: Bins) => byName(bins.palette).map((s) => s.name);

describe("1. the read person only", () => {
  it("keeps another person's pixels out of the measure, the palette and the mask", () => {
    const s = blank();
    person(s, 90, SAND, BURGUNDY);
    // Someone else, apart on the right, in forest green trousers.
    person(s, 230, DENIM, FOREST, { pose: false });
    const p = isolatePerson(s.mask, s.pose);
    expect(p.others).toBe(1);
    expect(p.side).toBe("left");
    expect(p.clipped).toBe(false);
    for (let y = 0; y < H; y++) for (let x = 180; x < W; x++) expect(p.mask.data[y * W + x]).toBe(CATEGORY.background);
    const m = measureOutfit(s.pixels, p.mask, s.pose);
    if (typeof m === "string") throw new Error(m);
    const reading = readOutfit(m, extractPalette(s.pixels, p.mask, m));
    expect(names(reading.bins)).not.toContain(colourName(...lch(FOREST)));
    expect(names(reading.bins)).toContain(colourName(...lch(BURGUNDY)));
    expect(othersCopy(p)).toBe("Other people are in the photo; Ratio read the one on the left.");
  });

  it("without isolation the other person's legs widened the volume reading (the bug it fixes)", () => {
    const s = blank();
    person(s, 90, SAND, BURGUNDY);
    // Two columns apart: close enough for the knee row's reach to count their legs.
    person(s, 162, FOREST, DENIM, { pose: false });
    const raw = measureOutfit(s.pixels, s.mask, s.pose);
    if (typeof raw === "string") throw new Error(raw);
    const p = isolatePerson(s.mask, s.pose);
    const own = measureOutfit(s.pixels, p.mask, s.pose);
    if (typeof own === "string") throw new Error(own);
    // Both legs are 50 px of fabric against 50 px between the shoulders.
    expect(own.fit?.legs).toBeCloseTo(1, 5);
    expect(raw.fit!.legs).toBeGreaterThan(1.4);
    const palette = extractPalette(s.pixels, p.mask, own);
    expect(names(readOutfit(own, palette).bins)).not.toContain(colourName(...lch(FOREST)));
  });

  it("says where the read person stands: in the middle, or on the right", () => {
    const s = blank();
    person(s, 150, SAND, BURGUNDY);
    person(s, 40, DENIM, FOREST, { pose: false });
    person(s, 262, DENIM, FOREST, { pose: false });
    const p = isolatePerson(s.mask, s.pose);
    expect(p).toMatchObject({ others: 2, side: "middle" });
    expect(othersCopy(p)).toBe("Other people are in the photo; Ratio read the one in the middle.");
    const r = blank();
    person(r, 210, SAND, BURGUNDY);
    person(r, 60, DENIM, FOREST, { pose: false });
    expect(isolatePerson(r.mask, r.pose)).toMatchObject({ others: 1, side: "right" });
  });

  it("clips a person who touches someone else to the corridor around the pose", () => {
    const s = blank();
    person(s, 100, SAND, BURGUNDY);
    // A second person shoulder to shoulder: one connected blob in the mask.
    person(s, 170, DENIM, FOREST, { pose: false });
    fill(s, 60, 200, 100, 170, CATEGORY.clothes, SAND);
    const p = isolatePerson(s.mask, s.pose);
    expect(p.clipped).toBe(true);
    expect(p.others).toBe(1);
    expect(p.side).toBe("left");
    // Nothing of the other person's legs (x 145..195, below the hips) survives.
    for (let y = 220; y < 380; y++) for (let x = 160; x < 195; x++) expect(p.mask.data[y * W + x]).toBe(CATEGORY.background);
    // The read person's own legs do.
    expect(p.mask.data[300 * W + 100]).toBe(CATEGORY.clothes);
  });

  it("keeps the person's own pieces cut off by a gap, and ignores specks", () => {
    const s = blank();
    person(s, 150, SAND, BURGUNDY, { shoesGap: true });
    fill(s, 5, 8, 280, 284, CATEGORY.other, [10, 10, 10]);
    const p = isolatePerson(s.mask, s.pose);
    expect(p.others).toBe(0);
    expect(p.side).toBeNull();
    expect(othersCopy(p)).toBeNull();
    expect(p.mask.data[390 * W + 150]).toBe(CATEGORY.other);
    expect(p.mask.data[6 * W + 281]).toBe(CATEGORY.background);
    expect(OTHER_MIN).toBeGreaterThan(0);
  });

  it("is deterministic", () => {
    const make = () => {
      const s = blank();
      person(s, 100, SAND, BURGUNDY);
      person(s, 170, DENIM, FOREST, { pose: false });
      fill(s, 60, 200, 100, 170, CATEGORY.clothes, SAND);
      return isolatePerson(s.mask, s.pose);
    };
    const a = make(), b = make();
    expect(Array.from(b.mask.data)).toEqual(Array.from(a.mask.data));
    expect({ ...b, mask: null }).toEqual({ ...a, mask: null });
  });
});

function lch(rgb: Rgb): [number, number, number] {
  const { L, a, b } = srgbToOklab(...rgb);
  const C = Math.hypot(a, b);
  const h = ((Math.atan2(b, a) * 180) / Math.PI + 360) % 360;
  return [Math.round(L / 0.02) * 0.02, Math.round(C / 0.01) * 0.01, Math.round(h / 5) * 5];
}

describe("2. recolour honesty", () => {
  // One column of lower-piece pixels, rows 0..9, at reading size.
  const scene = (personRows: number, burgundyRows: number) => {
    const w = 1, h = 10;
    const px = new Uint8ClampedArray(w * h * 4);
    const full = { width: w, height: h, data: new Uint8Array(w * h).fill(CATEGORY.clothes) };
    const own = { width: w, height: h, data: new Uint8Array(w * h) };
    for (let y = 0; y < h; y++) {
      px.set([...(y < burgundyRows ? BURGUNDY : DENIM), 255], y * 4);
      if (y >= h - personRows) own.data[y] = CATEGORY.clothes;
    }
    return { pixels: { width: w, height: h, data: px }, full, own };
  };
  const swatches: Swatch[] = [{ lab: srgbToOklab(...BURGUNDY), share: 1, y: 0.6 }];
  const bands = { upper: [0, 0], lower: [0, 9], shoes: [9, 9], other: [0, 9] } as const;
  const look = [{ kind: "recolour" as const, swatch: 0, piece: "lower" as const, L: 0.4, C: 0.08, h: 150, title: "", detail: "" }];

  it("shows a recolour whose cloth is the read person's and covers the piece", () => {
    const { pixels, full, own } = scene(10, 10);
    const h = honesty(pixels, full, own, { left: 0, right: 0 }, bands, swatches, look);
    expect(h.honest).toBe(true);
    expect(h.targets[0]).toMatchObject({ inside: 1, cover: 1 });
  });

  it("refuses a recolour whose cloth is mostly someone else's", () => {
    // Burgundy everywhere, but the read person is only the last 3 rows: 30% inside.
    const { pixels, full, own } = scene(3, 10);
    const h = honesty(pixels, full, own, { left: 0, right: 0 }, bands, swatches, look);
    expect(h.targets[0].inside).toBeCloseTo(0.3, 5);
    expect(h.targets[0].inside).toBeLessThan(HONEST.inside);
    expect(h.honest).toBe(false);
  });

  it("refuses a recolour that would move only a patch of the piece", () => {
    // The read person is all 10 rows, but only 2 are the swatch's colour (the rest denim): 20% cover.
    const { pixels, full, own } = scene(10, 2);
    const h = honesty(pixels, full, own, { left: 0, right: 0 }, bands, swatches, look);
    expect(h.targets[0]).toMatchObject({ inside: 1 });
    expect(h.targets[0].cover).toBeCloseTo(0.2, 5);
    expect(h.honest).toBe(false);
    // At the threshold it shows.
    const at = scene(10, Math.ceil(HONEST.cover * 10));
    expect(honesty(at.pixels, at.full, at.own, { left: 0, right: 0 }, bands, swatches, look).honest).toBe(true);
  });

  it("says so plainly, without an em dash", () => {
    expect(NOT_ON_PHOTO).toBe("This change can't be shown honestly on this photo; the chalk figure shows it.");
    expect(NOT_ON_PHOTO).not.toContain("—");
  });
});

/** A fixed pseudo-random sequence, so the sweeps are the same every run. */
function lcg(seed: number) {
  let x = seed;
  return () => ((x = (x * 1103515245 + 12345) % 2147483648) / 2147483648);
}

const sum20 = (shares: number[]) => shares.reduce((t, s) => t + Math.round(s * 20), 0);

describe("3. colour shares sum to 1.00", () => {
  it("apportions by largest remainder in 0.05 units, every colour at least one unit", () => {
    expect(binShares([0.355, 0.355, 0.29])).toEqual([0.35, 0.35, 0.3]);
    // Rounded one by one these were 0.35 + 0.35 + 0.30 + 0.05 = 1.05.
    expect(binShares([0.34, 0.34, 0.29, 0.03])).toEqual([0.35, 0.35, 0.25, 0.05]);
    expect(binShares([1])).toEqual([1]);
    expect(binShares([])).toEqual([]);
    const next = lcg(7);
    for (let n = 1; n <= 6; n++)
      for (let k = 0; k < 200; k++) {
        const raw = Array.from({ length: n }, () => 0.03 + next());
        const out = binShares(raw);
        expect(sum20(out)).toBe(20);
        expect(out.reduce((t, s) => t + s, 0).toFixed(2)).toBe("1.00");
        expect(Math.min(...out)).toBeGreaterThanOrEqual(0.05);
      }
  });

  it("holds for the read palette and for every look's palette", () => {
    const next = lcg(11);
    for (let k = 0; k < 60; k++) {
      const swatches: Swatch[] = Array.from({ length: 2 + (k % 4) }, (_, i) => ({
        lab: { L: 0.2 + 0.7 * next(), a: 0.2 * next() - 0.1, b: 0.2 * next() - 0.1 },
        share: 0.03 + next(),
        y: [0.3, 0.7, 0.95, 0.5, 0.2][i],
      }));
      const total = swatches.reduce((t, s) => t + s.share, 0);
      swatches.forEach((s) => (s.share /= total));
      const m = { top: 0, bottom: 1000, breakRow: 500, waistRow: 380, left: 0, right: 0, centerX: 0, topColour: swatches[0].lab, bottomColour: swatches[1].lab, fit: null };
      const reading = readOutfit(m, swatches);
      expect(sum20(reading.bins.palette.map((s) => s.share))).toBe(20);
      for (const look of suggestLooks(reading.bins, reading.lines)) expect(sum20(look.bins.palette.map((s) => s.share)), look.title).toBe(20);
    }
  });
});

const sw = (L: number, C: number, h: number, share: number, y: number): BinnedSwatch => ({ L, C, h, share, y });

/** Bins across the rulebook's bands: proportions, palettes of neutrals and colours, both value orders. */
function grid(): Bins[] {
  const colours = [sw(0.9, 0, 0, 0, 0.2), sw(0.5, 0.12, 30, 0, 0.3), sw(0.3, 0.1, 80, 0, 0.7), sw(0.6, 0.12, 160, 0, 0.6), sw(0.4, 0.06, 250, 0, 0.6), sw(0.22, 0, 0, 0, 0.95), sw(0.5, 0.01, 0, 0, 0.4), sw(0.62, 0.15, 210, 0, 0.6)];
  const out: Bins[] = [];
  for (const proportion of [null, 0.2, 0.38, 0.5, 0.6, 0.8])
    for (const top of colours)
      for (const bottom of colours)
        for (const shares of [[0.6, 0.3, 0.1], [0.5, 0.5], [0.4, 0.35, 0.25], [0.9, 0.1], [0.25, 0.25, 0.2, 0.15, 0.15]]) {
          const rest = colours.filter((c) => c !== top && c !== bottom);
          const palette = [top, bottom, ...rest].slice(0, shares.length).map((c, i) => ({ ...c, share: shares[i], y: i === 0 ? 0.3 : i === 1 ? 0.7 : c.y }));
          out.push({ proportion, waist: 0.38, top, bottom, palette, fit: { top: proportion === null ? 1.0 : 1.5, legs: proportion === 0.5 ? 0.9 : 0.5 } });
        }
  return out;
}

const NUMBER = /\d+(?:\.\d+)?/g;
const numbersIn = (text: string) => new Set(text.match(NUMBER) ?? []);

describe("4. advice quotes only numbers the reading shows", () => {
  it("every number in each rule's advice is in its Measured line (or is the rule's own constant)", () => {
    let checked = 0;
    for (const bins of grid())
      for (const line of readBins(bins)) {
        const e = RULEBOOK[line.rule];
        const shown = numbersIn([measuredCopy(line, bins), line.measured, e.rule, e.maths, ...e.edges.map((x) => `${x.name} ${x.value}`)].join(" "));
        for (const n of numbersIn(line.text)) expect(shown.has(n), `${line.rule}: "${n}" in "${line.text}" but not in "${measuredCopy(line, bins)}"`).toBe(true);
        checked++;
      }
    expect(checked).toBeGreaterThan(1000);
  });

  it("labels the upper and lower pieces' lightness in the value line (Noor: 0.28 and 0.22)", () => {
    const bins: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.28, C: 0, h: 0 }, bottom: { L: 0.22, C: 0, h: 0 }, palette: [sw(0.5, 0, 0, 0.6, 0.3), sw(0.9, 0, 0, 0.4, 0.7)], fit: null };
    const value = readBins(bins).find((l) => l.rule === "value")!;
    expect(value.text).toContain("0.28 and 0.22");
    expect(measuredCopy(value, bins)).toBe("Upper piece 0.28, lower piece 0.22; lightness of each colour: grey 0.50, white 0.90.");
  });
});

describe("5. one name, one entry", () => {
  it("merges swatches that share a plain name, summing their shares", () => {
    const palette = [sw(0.5, 0.1, 250, 0.45, 0.7), sw(0.5, 0, 0, 0.2, 0.3), sw(0.62, 0.01, 0, 0.15, 0.4), sw(0.9, 0, 0, 0.2, 0.95)];
    const named = byName(palette);
    expect(named.map((s) => s.name)).toEqual(["blue", "grey", "white"]);
    expect(named[1]).toMatchObject({ name: "grey", share: 0.35 });
    const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.5, C: 0, h: 0 }, bottom: { L: 0.5, C: 0.1, h: 250 }, palette, fit: null };
    const lines = readBins(bins);
    const shares = lines.find((l) => l.rule === "shares")!;
    expect(measuredCopy(shares, bins)).toBe("Share of the outfit's area: blue (250°) 0.45, grey 0.35, white 0.20.");
    for (const l of lines) {
      const text = measuredCopy(l, bins);
      expect(text.match(/\bgrey\b/g)?.length ?? 0, text).toBeLessThanOrEqual(1);
    }
  });

  it("never lists a name twice for any palette in the sweep", () => {
    for (const bins of grid()) {
      const labels = byName(bins.palette).map(colourLabel);
      expect(new Set(labels.map((l) => l.replace(/ \(\d+°\)$/, ""))).size).toBe(labels.length);
    }
  });
});

describe("6. looks that differ", () => {
  it("never offers two looks with the same hue family on the same piece", () => {
    let multi = 0;
    for (const bins of grid().filter((_, i) => i % 5 === 0)) {
      const lines = readBins(bins);
      const looks = suggestLooks(bins, lines);
      if (looks.length > 1) multi++;
      const keys = looks.flatMap((l) => ideasOf(l.moves));
      expect(new Set(keys).size, looks.map((l) => l.title).join(" | ")).toBe(keys.length);
    }
    expect(multi).toBeGreaterThan(20);
  });

  it("puts forest green, olive and bottle green in one family", () => {
    expect(new Set([familyOf(0.3, 0.08, 150), familyOf(0.3, 0.08, 125), familyOf(0.3, 0.08, 180)])).toEqual(new Set(["green"]));
    expect(familyOf(0.3, 0.07, 255)).toBe("blue");
    expect(familyOf(0.5, 0, 0)).toBe("neutral");
  });

  it("is deterministic", () => {
    for (const bins of grid().filter((_, i) => i % 40 === 0)) {
      const a = suggestLooks(bins, readBins(bins)).map((l) => l.id);
      expect(suggestLooks(bins, readBins(bins)).map((l) => l.id)).toEqual(a);
    }
  });
});

describe("7. engine version", () => {
  it("is 0.6.0: shares, the named palette and the person mask change readings", () => {
    expect(ENGINE_VERSION).toBe("ratio-engine/0.6.0");
  });
});
