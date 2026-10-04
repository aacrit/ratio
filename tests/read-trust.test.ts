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
import { OTHER_MIN, UNSURE_COPY, isolatePerson, othersCopy } from "../web/src/engine/person";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { yoursValues } from "../web/src/rules/model";
import { type Bins, ENGINE_VERSION, readBins, readOutfit } from "../web/src/engine/rules";
import { HONEST, honesty, photoPlan, recolour, refuseAll, refusedCardCopy, refusedCopy, refusedSwatches } from "../web/src/tryon/recolour";
import { isNeutral, shownColour } from "../web/src/engine/constants";
import { pieces } from "../web/src/engine/pieces";

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
    expect(othersCopy(p)).toBe("Someone else is in the photo; Ratio read the one on the left of the photo.");
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
    expect(othersCopy(p)).toBe("Other people are in the photo; Ratio read the one in the middle of the photo.");
    const r = blank();
    person(r, 210, SAND, BURGUNDY);
    person(r, 60, DENIM, FOREST, { pose: false });
    expect(isolatePerson(r.mask, r.pose)).toMatchObject({ others: 1, side: "right" });
  });

  it("goes by thirds of the frame: a person at 0.45 of the width is in the middle, whoever else is there", () => {
    // Noor's photo: she stands just left of centre, with someone to her right.
    const s = blank();
    person(s, 135, SAND, BURGUNDY);
    person(s, 235, DENIM, FOREST, { pose: false });
    const p = isolatePerson(s.mask, s.pose);
    expect(p).toMatchObject({ others: 1, side: "middle" });
    expect(othersCopy(p)).toBe("Someone else is in the photo; Ratio read the one in the middle of the photo.");
  });

  it("names the person by order when someone else shares their third: two people in the middle", () => {
    const s = blank();
    person(s, 120, SAND, BURGUNDY);
    // Touching on the right, also in the middle third.
    person(s, 180, DENIM, FOREST, { pose: false });
    const p = isolatePerson(s.mask, s.pose);
    expect(p).toMatchObject({ others: 1, side: "middle", order: "left", ownThird: false });
    expect(othersCopy(p)).toBe("Someone else is in the photo; Ratio read the one furthest left.");
  });

  it("counts neighbours touching on both sides as two people", () => {
    const s = blank();
    person(s, 150, SAND, BURGUNDY);
    person(s, 70, DENIM, FOREST, { pose: false });
    person(s, 230, DENIM, FOREST, { pose: false });
    // Shoulder to shoulder on both sides: one blob in the mask.
    fill(s, 60, 120, 70, 230, CATEGORY.clothes, SAND);
    const p = isolatePerson(s.mask, s.pose);
    expect(p).toMatchObject({ clipped: true, others: 2, side: "middle", unsure: false });
  });

  it("says plainly when the pose cannot single out the person", () => {
    const s = blank();
    person(s, 150, SAND, BURGUNDY);
    // The pose found someone where the segmenter saw nothing.
    s.pose = s.pose.map((l) => (l.visibility ? { ...l, x: l.x - 0.4 } : l));
    const p = isolatePerson(s.mask, s.pose);
    expect(p.unsure).toBe(true);
    expect(othersCopy(p)).toBe(UNSURE_COPY);
    expect(UNSURE_COPY).toBe("Ratio could not separate the person it read; if others are in the photo, crop to one.");
  });

  it("clips a person who touches someone else to the corridor around the pose", () => {
    const s = blank();
    person(s, 90, SAND, BURGUNDY);
    // A second person shoulder to shoulder: one connected blob in the mask.
    person(s, 160, DENIM, FOREST, { pose: false });
    fill(s, 60, 200, 90, 160, CATEGORY.clothes, SAND);
    const p = isolatePerson(s.mask, s.pose);
    expect(p.clipped).toBe(true);
    expect(p.others).toBe(1);
    expect(p.side).toBe("left");
    // Nothing of the other person's legs (x 135..185, below the hips) beyond the corridor survives.
    for (let y = 220; y < 380; y++) for (let x = 150; x < 185; x++) expect(p.mask.data[y * W + x]).toBe(CATEGORY.background);
    // The read person's own legs do.
    expect(p.mask.data[300 * W + 90]).toBe(CATEGORY.clothes);
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

  it("judges each move on its own: the breeches are painted, the unmeasurable shoes stay on the chalk figure", () => {
    // Napoleon's first look: the lower piece in black and oxblood shoes, on a photo with no measured shoes.
    const { pixels, full, own } = scene(10, 10);
    const black = { kind: "recolour" as const, swatch: 0, piece: "lower" as const, L: 0.2, C: 0, h: 0, title: "", detail: "" };
    const shoes = { kind: "accent" as const, L: 0.36, C: 0.11, h: 25, title: "", detail: "" };
    const tuck = { kind: "break" as const, to: 0.38, title: "Tuck the front", detail: "" };
    const moves = [tuck, black, shoes];
    const plan = photoPlan(pixels, full, own, { left: 0, right: 0 }, bands, swatches, moves);
    expect(plan).toEqual({ paint: [1], refused: [{ i: 2, reason: "no_target" }] });
    expect(refusedCopy(moves, plan)).toBe("The oxblood shoes are shown on the chalk figure only; this photo has no shoes Ratio could measure.");
    expect(refusedCardCopy(moves, plan)).toBe("The oxblood shoes are drawn on the chalk figure only.");
    // A doubtful recolour is refused alone, and names its piece.
    const doubtful = scene(3, 10);
    const half = photoPlan(doubtful.pixels, doubtful.full, doubtful.own, { left: 0, right: 0 }, bands, swatches, [black]);
    expect(half).toEqual({ paint: [], refused: [{ i: 0, reason: "doubtful" }] });
    expect(refusedCopy([black], half)).toBe("The lower piece in black is shown on the chalk figure only; it can't be shown honestly on this photo.");
    expect(refusedCardCopy([black], half)).toBe("Shows the photo as worn; this look is drawn on the chalk figure.");
    // Nothing refused, nothing said; a failed check refuses every colour move, never the tuck.
    const all = photoPlan(pixels, full, own, { left: 0, right: 0 }, bands, swatches, [black]);
    expect(refusedCopy([black], all)).toBeNull();
    expect(refusedCardCopy([black], all)).toBeNull();
    // A check that could not run is no judgement on the photo: a neutral line.
    expect(refuseAll(moves)).toEqual({ paint: [], refused: [{ i: 1, reason: "failed" }, { i: 2, reason: "failed" }] });
    expect(refusedCopy(moves, refuseAll(moves))).toBe("The look is shown on the chalk figure only.");
    for (const t of [refusedCopy(moves, plan), refusedCopy([black], half)]) expect(t).not.toContain("—");
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
    // A dominant colour is never cut to pay for specks (the reviewer's case): 0.88 stays 0.85, a speck may fall to zero.
    const dominant = [0.88, 0.03, 0.03, 0.03, 0.03];
    expect(binShares(dominant)).toEqual([0.85, 0.05, 0.05, 0.05, 0]);
    binShares(dominant).forEach((v, i) => expect(Math.abs(v - dominant[i])).toBeLessThanOrEqual(0.05));
    expect(binShares([])).toEqual([]);
    const next = lcg(7);
    for (let n = 1; n <= 6; n++)
      for (let k = 0; k < 200; k++) {
        const raw = Array.from({ length: n }, () => 0.03 + next());
        const out = binShares(raw);
        expect(sum20(out)).toBe(20);
        expect(out.reduce((t, s) => t + s, 0).toFixed(2)).toBe("1.00");
        const total = raw.reduce((t, s) => t + s, 0);
        out.forEach((v, i) => expect(Math.abs(v - raw[i] / total)).toBeLessThanOrEqual(0.05 + 1e-9));
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
        const shown = numbersIn([measuredCopy(line, bins), line.measured, ...e.edges.map((x) => String(x.value))].join(" "));
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

describe("2b. value reads each colour's own lightness", () => {
  it("keeps the range of a light grey over a dark grey (the merge does not average it away)", () => {
    const grey = (L: number, share: number, y: number) => sw(L, 0, 0, share, y);
    const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.46, C: 0, h: 0 }, bottom: { L: 0.68, C: 0, h: 0 }, palette: [grey(0.46, 0.5, 0.3), grey(0.68, 0.5, 0.7)], fit: null };
    expect(byName(bins.palette)).toHaveLength(1);
    const value = readBins(bins).find((l) => l.rule === "value")!;
    expect(value.measured).toBe("range 0.22");
    expect(measuredCopy(value, bins)).toBe("Upper piece 0.46, lower piece 0.68; lightness of each colour: grey 0.46 and 0.68.");
    const wide: Bins = { ...bins, top: { L: 0.24, C: 0, h: 0 }, palette: [sw(0.24, 0, 0, 0.5, 0.3), grey(0.68, 0.5, 0.7)] };
    expect(readBins(wide).find((l) => l.rule === "value")!.measured).toBe("range 0.44");
  });
});

describe("an accent never repaints a refused piece", () => {
  it("leaves out pixels nearer to a refused move's swatch than to the accent's own", () => {
    // One band of shoe-coloured and lower-piece-coloured pixels: the accent on
    // the shoes passes, the lower piece's recolour was refused.
    const shoe: Rgb = [70, 40, 30], cloth: Rgb = [95, 60, 45];
    const data = new Uint8ClampedArray([...shoe, 255, ...cloth, 255]);
    const pixels = { width: 2, height: 1, data };
    const mask = { width: 2, height: 1, data: Uint8Array.from([CATEGORY.clothes, CATEGORY.clothes]) };
    const swatches: Swatch[] = [{ lab: srgbToOklab(...cloth), share: 0.6, y: 0.7 }, { lab: srgbToOklab(...shoe), share: 0.1, y: 0.95 }];
    const bands = { upper: [0, 0], lower: [0, 0], shoes: [0, 0], other: [0, 0] } as const;
    const accent = { kind: "accent" as const, L: 0.5, C: 0.12, h: 250, title: "", detail: "" };
    const lower = { kind: "recolour" as const, swatch: 0, piece: "lower" as const, L: 0.2, C: 0, h: 0, title: "", detail: "" };
    const moves = [lower, accent];
    const plan = { paint: [1], refused: [{ i: 0, reason: "doubtful" as const }] };
    expect(refusedSwatches(moves, plan, swatches)).toEqual([0]);
    const without = recolour(pixels, mask, { left: 0, right: 1 }, bands, swatches, [accent]);
    expect(Array.from(without.data.slice(4, 7))).not.toEqual(cloth);
    const out = recolour(pixels, mask, { left: 0, right: 1 }, bands, swatches, [accent], refusedSwatches(moves, plan, swatches));
    expect(Array.from(out.data.slice(0, 3))).not.toEqual(shoe);
    expect(Array.from(out.data.slice(4, 7))).toEqual(cloth);
  });
});

describe("neutrals are drawn without chroma", () => {
  it("draws a cream the engine reads as neutral as a grey of its lightness, and a colour as itself", () => {
    const cream = { L: 0.88, C: 0.03, h: 0 };
    expect(isNeutral(cream)).toBe(true);
    expect(shownColour(cream)).toEqual({ L: 0.88, C: 0, h: 0 });
    expect(shownColour({ L: 0.3, C: 0.07, h: 255 })).toEqual({ L: 0.3, C: 0.07, h: 255 });
  });
});

describe("pieces", () => {
  it("never takes a speck the share binning dropped to zero as the shoes", () => {
    const palette = [sw(0.9, 0, 0, 0.85, 0.3), sw(0.3, 0, 0, 0.15, 0.7), sw(0.2, 0.1, 25, 0, 0.95)];
    expect(pieces(palette, 0.38).shoes).toBe(-1);
    expect(pieces([...palette.slice(0, 2), { ...palette[2], share: 0.05 }], 0.38).shoes).toBe(2);
  });
});

describe("5. one name, one entry", () => {
  it("the Rulebook's yours markers read as the rules do: shares, chroma and harmony merged, value each colour's own", () => {
    const palette = [sw(0.46, 0, 0, 0.4, 0.3), sw(0.68, 0, 0, 0.35, 0.7), sw(0.3, 0.07, 255, 0.25, 0.95)];
    const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.46, C: 0, h: 0 }, bottom: { L: 0.68, C: 0, h: 0 }, palette, fit: null };
    const v = yoursValues(bins);
    expect(v.shares.map((s) => s.share)).toEqual([0.75, 0.25]);
    expect(v.chroma).toHaveLength(2);
    expect(v.value).toEqual({ ls: [0.46, 0.68, 0.3], range: 0.38 });
    expect(readBins(bins).find((l) => l.rule === "value")!.measured).toBe("range 0.38");
    expect(readBins(bins).find((l) => l.rule === "shares")!.measured).toBe("0.75 · 0.25");
  });

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

  it("lets the tuck take at most two of three slots while a look without it also helps", () => {
    // A white top untucked over a green lower piece: near-equal halves, so the tuck is in the best looks.
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.9, C: 0, h: 0 }, bottom: { L: 0.6, C: 0.12, h: 160 }, palette: [sw(0.9, 0, 0, 0.6, 0.3), sw(0.6, 0.12, 160, 0.3, 0.7), sw(0.5, 0.12, 30, 0.1, 0.3)], fit: null };
    const looks = suggestLooks(b, readBins(b));
    expect(looks).toHaveLength(3);
    expect(looks.some((l) => l.moves.some((m) => m.kind === "break"))).toBe(true);
    expect(looks.some((l) => l.moves.every((m) => m.kind !== "break"))).toBe(true);
    for (let i = 1; i < looks.length; i++) expect(looks[i - 1].gain).toBeGreaterThanOrEqual(looks[i].gain);
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
