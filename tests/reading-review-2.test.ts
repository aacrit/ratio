// T4 review, round 2 (2026-10-04): the reviewer's engine probes as tests.
// Each fails on the first T4 commit (8f9ca2f) and passes now. Synthetic
// figures as in the other engine tests: a painted mask, its pixels, pose
// landmarks.

import { describe, expect, it } from "vitest";
import { labToLch, oklabToSrgb, srgbToOklab } from "../web/src/engine/color";
import { neutralCast, uncast } from "../web/src/engine/garment-colour";
import { CATEGORY, type Landmark, type Mask, measureOutfit } from "../web/src/engine/measure";
import { extractPalette } from "../web/src/engine/palette";
import { type Bins, JUDGING_WORDS, type AdviceLine, readBins, readOutfit } from "../web/src/engine/rules";
import { isNeutral, neutralChromaAt } from "../web/src/engine/constants";
import { candidateMoves, accentOf } from "../web/src/engine/looks";
import { colourName } from "../web/src/engine/names";
import { changeWords, leadSentence, verdictOf } from "../web/src/engine/verdict";
import { measuredCopy } from "../web/src/engine/measured";
import { volumeLine } from "../web/src/engine/shape-rules";
import { recolour } from "../web/src/tryon/recolour";
import type { Swatch } from "../web/src/engine/palette";

const W = 200;
const H = 400;
type Rgb = [number, number, number];
const lch = (L: number, C: number, h: number): Rgb => oklabToSrgb({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });

interface Scene {
  mask: Mask;
  pixels: { width: number; height: number; data: Uint8ClampedArray };
  pose: Landmark[];
  at: (i: number, x: number, y: number) => void;
}

function scene(): Scene {
  const mask: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
  const data = new Uint8ClampedArray(W * H * 4).fill(240);
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const at = (i: number, x: number, y: number) => (pose[i] = { x: x / W, y: y / H, visibility: 0.99 });
  at(0, 100, 32);
  at(11, 75, 60);
  at(12, 125, 60);
  at(23, 85, 190);
  at(24, 115, 190);
  at(25, 85, 290);
  at(26, 115, 290);
  at(27, 85, 372);
  at(28, 115, 372);
  at(29, 85, 384);
  at(30, 115, 384);
  at(31, 85, 392);
  at(32, 115, 392);
  return { mask, pixels: { width: W, height: H, data }, pose, at };
}

function fill(s: Scene, y0: number, y1: number, x0: number, x1: number, cat: number, rgb: Rgb | ((x: number, y: number) => Rgb)) {
  for (let y = y0; y < y1; y++)
    for (let x = Math.max(0, x0); x < Math.min(W, x1); x++) {
      s.mask.data[y * W + x] = cat;
      s.pixels.data.set([...(typeof rgb === "function" ? rgb(x, y) : rgb), 255], (y * W + x) * 4);
    }
}

/** Head, an upper piece to `hem` (skin to `skinTo`), trousers, shoes. */
function figure(o: { upper: Rgb | ((x: number, y: number) => Rgb); lower: Rgb; shoes: Rgb; hem?: number; skinTo?: number }): Scene {
  const s = scene();
  const hem = o.hem ?? 200;
  const skinTo = o.skinTo ?? hem;
  fill(s, 10, 50, 85, 115, CATEGORY.faceSkin, [200, 160, 130]);
  fill(s, 50, hem, 70, 130, CATEGORY.clothes, o.upper);
  if (skinTo > hem) fill(s, hem, skinTo, 72, 128, CATEGORY.bodySkin, [200, 160, 130]);
  fill(s, skinTo, 225, 72, 128, CATEGORY.clothes, o.lower);
  fill(s, 225, 376, 75, 95, CATEGORY.clothes, o.lower);
  fill(s, 225, 376, 105, 125, CATEGORY.clothes, o.lower);
  fill(s, 376, 396, 72, 98, CATEGORY.other, o.shoes);
  fill(s, 376, 396, 102, 128, CATEGORY.other, o.shoes);
  return s;
}

function read(s: Scene) {
  const m = measureOutfit(s.pixels, s.mask, s.pose);
  if (typeof m === "string") throw new Error(m);
  const palette = extractPalette(s.pixels, s.mask, m);
  return { m, palette, reading: readOutfit(m, palette) };
}

const WHITE: Rgb = [230, 230, 225];
const NAVYISH: Rgb = [40, 40, 60];

describe("1. the break can land high", () => {
  it("a crop top over a bare midriff reads as a short top, near its true 0.23", () => {
    const { m, reading } = read(figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40], hem: 100, skinTo: 150 }));
    expect(m.breakRow).toBe(100);
    expect(reading.bins.proportion).toBeCloseTo(0.24, 2);
    expect(reading.lines[0].state).toBe("neutral");
    expect(reading.lines[0].text).toMatch(/break sits high/);
  });

  it("a white top ending at 0.26 over navy has a break, not one column", () => {
    const { m, reading } = read(figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40], hem: 110 }));
    expect(m.breakRow).toBe(110);
    expect(reading.bins.proportion).toBeCloseTo(0.26, 2);
  });

  it("4px navy and white stripes over navy trousers: the hem is the top's, near 0.49, never a stripe's phase (round 3)", () => {
    const navy = lch(0.3, 0.06, 255), white = lch(0.92, 0, 0);
    for (const p of [2, 3, 4, 6, 8, 12]) {
      const { reading } = read(figure({ upper: (x) => (x % (2 * p) < p ? navy : white), lower: navy, shoes: [30, 30, 30] }));
      expect(reading.bins.proportion, `${p}px`).toBeGreaterThanOrEqual(0.44);
      expect(reading.bins.proportion, `${p}px`).toBeLessThanOrEqual(0.52);
    }
  });

  it("hems at 0.29 and 0.39 are read where they are", () => {
    expect(read(figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40], hem: 120 })).m.breakRow).toBe(120);
    expect(read(figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40], hem: 160 })).m.breakRow).toBe(160);
  });

  it("a t-shirt showing on one side of an open hoodie is not a hem (p2 must not read 0.28 again)", () => {
    const hoodie = lch(0.22, 0.004, 0);
    // The t-shirt shows on the right flank only, from the collar to row 120; the hoodie's hem is at 230.
    const s = figure({ upper: (x, y) => (x >= 100 && x < 125 && y < 120 ? WHITE : hoodie), lower: lch(0.55, 0, 0), shoes: WHITE, hem: 230 });
    // The trouser legs start at row 225 in this fixture, under the hoodie's last rows.
    const brk = read(s).m.breakRow!;
    expect(brk).toBeGreaterThanOrEqual(225);
    expect(brk).toBeLessThanOrEqual(230);
  });

  it("light falling off a dark jacket's shoulders is not a hem", () => {
    // A black jacket lit at the shoulders (L 0.32) darkening to L 0.18, over plum trousers.
    const s = figure({ upper: (_x, y) => lch(Math.max(0.18, 0.32 - (y - 50) * 0.003), 0.008, 250), lower: lch(0.3, 0.07, 345), shoes: lch(0.65, 0.14, 35) });
    expect(read(s).m.breakRow).toBe(200);
  });
});

describe("2. patterns are not an opening", () => {
  const navy = lch(0.3, 0.06, 255), white = lch(0.92, 0, 0), red = lch(0.5, 0.15, 25);
  let seed = 12345;
  const rnd = () => ((seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff);
  const front = (upper: (x: number, y: number) => Rgb) => read(figure({ upper, lower: lch(0.3, 0.05, 250), shoes: [30, 30, 30] })).m.front ?? false;

  it("stripes, pinstripe, gingham, tartan, a print, heather, a side light and Breton stripes read no opening", () => {
    const cases: [string, (x: number, y: number) => Rgb][] = [
      ["plain", () => lch(0.6, 0.05, 80)],
      ["vertical stripes", (x) => (x % 8 < 4 ? navy : white)],
      ["pinstripe", (x) => (x % 6 === 0 ? white : navy)],
      ["gingham", (x, y) => ((Math.floor(x / 6) + Math.floor(y / 6)) % 2 ? navy : white)],
      ["tartan", (x, y) => (x % 10 < 2 || y % 10 < 2 ? red : navy)],
      ["print", () => (rnd() < 0.3 ? red : navy)],
      ["heather", () => lch(0.5 + (rnd() - 0.5) * 0.12, 0.01, 0)],
      ["side light", (x) => lch(0.7 - 0.35 * ((x - 70) / 60), 0.03, 60)],
      ["breton", (_x, y) => (y % 8 < 4 ? navy : white)],
    ];
    for (const [name, upper] of cases) expect(front(upper), name).toBe(false);
  });

  it("a zip or a placket down the front is an opening", () => {
    const jacket = lch(0.22, 0.004, 0);
    expect(front((x) => (x === 100 ? [200, 200, 200] : jacket))).toBe(true);
    expect(front((x) => (x >= 99 && x <= 101 ? lch(0.8, 0, 0) : navy))).toBe(true);
  });
});

describe("3. removing a cast never invents a hue", () => {
  it("sage on sage with black shoes: the shoes stay neutral, the sage stays sage", () => {
    const { reading } = read(figure({ upper: lch(0.6, 0.035, 140), lower: lch(0.5, 0.035, 140), shoes: lch(0.2, 0, 0) }));
    const shoes = reading.bins.palette.find((p) => p.y >= 0.9)!;
    expect(isNeutral(shoes)).toBe(true);
    expect(reading.bins.palette.filter((p) => !isNeutral(p)).every((p) => p.h >= 120 && p.h <= 160)).toBe(true);
  });

  it("denim on denim with white shoes: the shoes stay neutral, the denim stays blue", () => {
    const { reading } = read(figure({ upper: lch(0.4, 0.035, 255), lower: lch(0.33, 0.035, 255), shoes: lch(0.95, 0, 0) }));
    expect(isNeutral(reading.bins.palette.find((p) => p.y >= 0.9)!)).toBe(true);
    expect(reading.bins.palette.filter((p) => !isNeutral(p)).every((p) => p.h >= 230 && p.h <= 280)).toBe(true);
  });

  it("uncast never raises chroma and never touches a pixel at or under the neutral line", () => {
    const cast = { a: 0.02, b: 0 };
    for (const p of [{ L: 0.2, a: 0, b: 0 }, { L: 0.5, a: -0.03, b: 0.01 }, { L: 0.6, a: 0.05, b: 0.02 }, { L: 0.9, a: 0.01, b: 0.01 }]) {
      const u = uncast(p, cast);
      expect(labToLch(u).C, JSON.stringify(p)).toBeLessThanOrEqual(labToLch(p).C + 1e-12);
      if (labToLch(p).C <= neutralChromaAt(p.L)) expect(u).toEqual(p);
    }
  });

  it("a cast is accepted only when the upper and lower garments agree on it", () => {
    const warm = Array.from({ length: 50 }, () => ({ L: 0.5, a: 0.015, b: 0.005 }));
    const cool = Array.from({ length: 50 }, () => ({ L: 0.5, a: -0.01, b: -0.015 }));
    expect(neutralCast(warm, warm).a).toBeCloseTo(0.015, 6);
    expect(neutralCast(warm, cool)).toEqual({ a: 0, b: 0 });
  });
});

/** The reviewer's arm probe: a tapered torso, arms hanging `g` px from its edges (or fused, or in pockets). */
function withArms(g: number, opts: { pockets?: boolean; fuseLeft?: boolean } = {}): Scene {
  const s = scene();
  fill(s, 10, 50, 85, 115, CATEGORY.faceSkin, [200, 160, 130]);
  for (let y = 50; y < 200; y++) {
    const t = (y - 50) / 150;
    fill(s, y, y + 1, Math.round(70 + 6 * t), Math.round(130 - 6 * t), CATEGORY.clothes, [50, 50, 50]);
  }
  fill(s, 200, 225, 72, 128, CATEGORY.clothes, [90, 90, 90]);
  fill(s, 225, 376, 75, 95, CATEGORY.clothes, [90, 90, 90]);
  fill(s, 225, 376, 105, 125, CATEGORY.clothes, [90, 90, 90]);
  fill(s, 376, 396, 72, 98, CATEGORY.other, [20, 20, 20]);
  fill(s, 376, 396, 102, 128, CATEGORY.other, [20, 20, 20]);
  for (const side of ["L", "R"] as const) {
    const sign = side === "L" ? -1 : 1;
    const edgeAt = (y: number) => (side === "L" ? 70 + 6 * Math.min(1, (y - 50) / 150) : 130 - 6 * Math.min(1, (y - 50) / 150));
    const cx = (y: number) => edgeAt(y) + sign * (g + 6);
    for (let y = 55; y < 215; y++) fill(s, y, y + 1, Math.round(cx(y) - 6), Math.round(cx(y) + 6), CATEGORY.clothes, [50, 50, 50]);
    s.at(side === "L" ? 13 : 14, cx(130), 130);
    s.at(side === "L" ? 15 : 16, opts.pockets ? edgeAt(195) - sign * 4 : cx(200), 200);
  }
  if (opts.fuseLeft) for (let y = 55; y < 215; y++) { const e = 70 + 6 * Math.min(1, (y - 50) / 150); fill(s, y, y + 1, Math.round(e - 10), Math.round(e) + 1, CATEGORY.clothes, [50, 50, 50]); }
  return s;
}

describe("4. volume reads where it can, says what it can't", () => {
  it("arms hanging clear of the sides leave the upper piece to be read on both edges", () => {
    for (const g of [8, 15, 25]) {
      const { m } = read(withArms(g));
      expect(m.fit?.top, String(g)).toBeGreaterThan(1.0);
      expect(m.fit?.top, String(g)).toBeLessThan(1.15);
      expect(m.fitOneSide, String(g)).toBeUndefined();
    }
  });

  it("one arm fused to the side, the other clear: read on the clear side and marked borderline", () => {
    const { m, reading } = read(withArms(10, { fuseLeft: true }));
    expect(m.fit?.top).toBeGreaterThan(1.0);
    expect(m.fit?.top).toBeLessThan(1.15);
    expect(m.fitOneSide).toBe(true);
    const line = reading.lines.find((l) => l.rule === "volume")!;
    expect(line.borderline).toBe(true);
    expect(line.text).toMatch(/read on one side only/);
  });

  it("hands in pockets: the upper piece is not read, the legs line still prints", () => {
    const { m, reading } = read(withArms(0, { pockets: true }));
    expect(m.fit?.top).toBeNull();
    expect(m.fit?.legs).toBeCloseTo(0.4, 5);
    expect(m.fitWhy).toBe("arms");
    const line = reading.lines.find((l) => l.rule === "volume")!;
    expect(line.measured).toBe("not read · 0.40×");
    expect(line.text).toMatch(/^Each leg reads narrow/);
    // Balance advice needs both values.
    expect(line.state).not.toBe("advice");
  });

  it("'arms' is said only when an arm really spoiled the rows: a bare torso with arms away is not 'arms'", () => {
    const s = scene();
    fill(s, 10, 50, 85, 115, CATEGORY.faceSkin, [200, 160, 130]);
    fill(s, 50, 200, 70, 130, CATEGORY.bodySkin, [200, 160, 130]);
    fill(s, 200, 225, 72, 128, CATEGORY.clothes, [90, 90, 90]);
    fill(s, 225, 376, 75, 95, CATEGORY.clothes, [90, 90, 90]);
    fill(s, 225, 376, 105, 125, CATEGORY.clothes, [90, 90, 90]);
    fill(s, 376, 396, 72, 98, CATEGORY.other, [20, 20, 20]);
    fill(s, 376, 396, 102, 128, CATEGORY.other, [20, 20, 20]);
    const m = measureOutfit(s.pixels, s.mask, s.pose);
    if (typeof m === "string") throw new Error(m);
    expect(m.fit?.top ?? null).toBeNull();
    expect(m.fitWhy).toBeUndefined();
    // Round 3: neither the volume line nor its Measured copy blames an arm that is not there.
    const reading = readOutfit(m, extractPalette(s.pixels, s.mask, m));
    const line = reading.lines.find((l) => l.rule === "volume")!;
    expect(line.measured).toBe("not read · 0.40×");
    expect(line.text).not.toMatch(/arm|hand/);
    expect(line.text).toMatch(/could not be read on these rows/);
    expect(measuredCopy(line, reading.bins)).not.toMatch(/arm|hand/);
  });

  it("a bandeau over a bare midriff with no arms in the pose: the reason never names an arm", () => {
    const s = figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40], hem: 75, skinTo: 200 });
    const { m, reading } = read(s);
    expect(m.fitWhy).toBeUndefined();
    const line = reading.lines.find((l) => l.rule === "volume")!;
    expect(line.text).not.toMatch(/arm|hand/);
    expect(measuredCopy(line, reading.bins)).not.toMatch(/arm|hand/);
  });

  it("arms hanging 0.04 and 0.08 of the shoulder width clear of the sides still read (round 3)", () => {
    expect(read(withArms(2)).m.fit?.top).toBeCloseTo(1.06, 1);
    expect(read(withArms(4)).m.fit?.top).toBeCloseTo(1.08, 1);
    expect(read(withArms(2)).m.fitOneSide).toBeUndefined();
  });

  it("the volume advice offers the tuck as a condition, and never on an opening front", () => {
    expect(volumeLine({ top: 1.6, legs: 0.7 }).text).toMatch(/if the upper piece tucks/);
    expect(volumeLine({ top: 1.6, legs: 0.7 }, { front: true }).text).not.toMatch(/tuck/);
  });
});

describe("also: shoes, accents, names, labels, recolour", () => {
  it("one ankle out of sight: the visible foot's shoe is read, not 'cut off'", () => {
    const s = figure({ upper: WHITE, lower: NAVYISH, shoes: [120, 60, 40] });
    s.pose[28] = { ...s.pose[28], visibility: 0.1 };
    const { m, reading } = read(s);
    expect(m.shoesWhy).toBeUndefined();
    expect(m.feet!.length).toBe(1);
    expect(reading.lines.find((l) => l.rule === "legline")!.state).not.toBe("unread");
  });

  it("with a loud accent kept, the colour muted is the loudest one that is not the accent", () => {
    const sw = (L: number, C: number, h: number, share: number, y: number) => ({ L, C, h, share, y });
    // A red top, blue shoes (the accent), a green trim; chroma advice: they compete.
    const b: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.55, C: 0.16, h: 25 }, bottom: { L: 0.3, C: 0, h: 0 }, palette: [sw(0.55, 0.16, 25, 0.55, 0.3), sw(0.3, 0, 0, 0.23, 0.65), sw(0.5, 0.15, 255, 0.12, 0.95), sw(0.6, 0.14, 145, 0.1, 0.5)], fit: null };
    const lines = readBins(b);
    expect(lines.find((l) => l.rule === "chroma")!.state).toBe("advice");
    expect(accentOf(b)).toBe(2);
    const mutes = candidateMoves(b, lines).filter((m) => m.kind === "recolour" && m.title.includes("muted"));
    expect(mutes.length).toBe(1);
    expect(mutes[0].kind === "recolour" && mutes[0].swatch).toBe(0);
  });

  it("a mute move is said as muted in the verdict, never as the plain colour (round 3)", async () => {
    const { plainMove } = await import("../web/src/engine/verdict");
    const sw = (L: number, C: number, h: number, share: number, y: number) => ({ L, C, h, share, y });
    // A red top and green shoes at the same lightness, both saturated: the red is muted.
    const b: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.55, C: 0.16, h: 25 }, bottom: { L: 0.3, C: 0, h: 0 }, palette: [sw(0.3, 0, 0, 0.5, 0.65), sw(0.55, 0.16, 25, 0.38, 0.3), sw(0.55, 0.15, 150, 0.12, 0.95)], fit: null };
    const mute = candidateMoves(b, readBins(b)).find((m) => m.kind === "recolour" && m.title.includes("muted"));
    expect(mute).toBeDefined();
    expect(plainMove(mute!)).toBe("a muted red for the top");
  });

  it("scarlet stays red; coral and light coral are coral", () => {
    const name = (r: number, g: number, bl: number) => {
      const { L, C, h } = labToLch(srgbToOklab(r, g, bl));
      return colourName(Math.round(L / 0.02) * 0.02, Math.round(C / 0.01) * 0.01, (Math.round(h / 5) * 5) % 360);
    };
    expect(name(255, 36, 0)).toBe("red");
    expect(name(255, 0, 0)).toBe("red");
    expect(name(255, 127, 80)).toBe("coral");
    expect(name(240, 128, 128)).toBe("coral");
  });

  it("an unread line is labelled 'Why', not advice", async () => {
    const { adviceLabel } = await import("../web/src/ui/rows");
    expect(adviceLabel({ rule: "legline", title: "", measured: "not read", text: "", state: "unread", borderline: false })).toBe("Why");
  });

  it("with no look to offer, the verdict names the change", () => {
    const sw = (L: number, C: number, h: number, share: number, y: number) => ({ L, C, h, share, y });
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.32, C: 0.07, h: 350 }, palette: [sw(0.2, 0, 0, 0.6, 0.35), sw(0.32, 0.07, 350, 0.3, 0.65), sw(0.66, 0.15, 35, 0.1, 0.95)], fit: null, front: true };
    expect(verdictOf(readBins(b), [], b)).toContain("The change: a shorter upper piece, ending near the waist.");
  });

  it("try it reads the photo's pixels with the cast taken off, as the swatches were read", () => {
    // A garment under a cast the swatch was read without: the raw pixel sits
    // further from the swatch than SAME_CLOTH allows, the uncast one on it.
    const cast = { a: -0.05, b: -0.05 };
    const raw: Rgb = oklabToSrgb({ L: 0.5, a: -0.07, b: -0.12 });
    const swatchLab = uncast(srgbToOklab(...raw), cast);
    const pixels = { width: 1, height: 1, data: new Uint8ClampedArray([...raw, 255]) };
    const mask = { width: 1, height: 1, data: Uint8Array.from([CATEGORY.clothes]) };
    const swatches: Swatch[] = [{ lab: swatchLab, share: 1, y: 0.6 }];
    const bands = { upper: [0, 0], lower: [0, 0], shoes: [0, 0], other: [0, 0] } as const;
    const move = { kind: "recolour" as const, swatch: 0, piece: "lower" as const, L: 0.3, C: 0.1, h: 30, title: "", detail: "" };
    const out = recolour(pixels, mask, { left: 0, right: 0, cast }, bands, swatches, [move]);
    expect(Array.from(out.data.slice(0, 3))).not.toEqual(raw);
  });
});

describe("copy law over every lead sentence (V4)", () => {
  it("no judging word, no em dash, in any branch", () => {
    const rules: AdviceLine["rule"][] = ["proportion", "volume", "harmony", "value", "chroma", "shares", "legline"];
    const states: AdviceLine["state"][] = ["golden", "advice", "neutral", "unread"];
    const measures = ["one column", "neutrals", "250°", "V · 30° 60°", "0.50 : 0.50", "1 saturated"];
    const texts: string[] = [];
    for (const proportion of [null, 0.2, 0.33, 0.38, 0.5, 0.6, 0.8])
      for (const front of [undefined, true as const])
        for (const fit of [null, { top: 1.0, legs: 0.4 }, { top: 1.6, legs: 0.7 }, { top: 1.3, legs: 0.5 }, { top: null, legs: 0.4 }])
          for (const [topL, bottomL] of [[0.8, 0.3], [0.3, 0.8], [0.4, 0.42]]) {
            const bins: Bins = { proportion, waist: 0.38, top: { L: topL, C: 0, h: 0 }, bottom: { L: bottomL, C: 0, h: 0 }, palette: [], fit, ...(front ? { front } : {}) };
            for (const rule of rules)
              for (const state of states)
                for (const borderline of [false, true])
                  for (const measured of measures) {
                    const line: AdviceLine = { rule, state, measured, borderline, title: "", text: state === "advice" && rule === "chroma" ? "they vibrate" : "" };
                    const t = leadSentence(line, bins);
                    if (t) texts.push(t);
                    if (state === "advice") texts.push(changeWords(line, bins));
                  }
          }
    expect(texts.length).toBeGreaterThan(100);
    for (const t of new Set(texts)) {
      for (const w of JUDGING_WORDS) expect(t.toLowerCase(), t).not.toContain(w);
      expect(t, t).not.toContain("—");
    }
  });
});
