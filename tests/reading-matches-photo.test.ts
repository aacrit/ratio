// T4, engine 0.7.0: the reading matches the photo (UX pass 2, 2026-10-04).
// Mara (a stylist) and Noor (the super user) read two real photos and found
// the colours, the volume, the break and the shoes saying something a
// stylist does not see. Each test here is a synthetic stand-in for one of
// those findings, built like the other engine tests (a painted mask, its
// pixels and pose landmarks), and fails on engine 0.6.0.

import { describe, expect, it } from "vitest";
import { labToLch, oklabToSrgb } from "../web/src/engine/color";
import { CAST, coreColour, neutralCast } from "../web/src/engine/garment-colour";
import { type Bins, JUDGING_WORDS, readBins, readOutfit } from "../web/src/engine/rules";
import { CATEGORY, type Landmark, type Mask, measureOutfit } from "../web/src/engine/measure";
import { extractPalette } from "../web/src/engine/palette";
import { byName, colourName } from "../web/src/engine/names";
import { candidateMoves, suggestLooks } from "../web/src/engine/looks";
import { verdictOf } from "../web/src/engine/verdict";
import { measuredCopy } from "../web/src/engine/measured";
import { legFit, topFit } from "../web/src/engine/shape-rules";
import { pieces } from "../web/src/engine/pieces";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { TEMPLATES } from "../web/src/engine/colour-rules";
import { PROVENANCE, UNCALIBRATED, UNCALIBRATED_NOTE } from "../web/src/rules/render";
import { keyStep } from "../web/src/rules/model";
import { type LastRead, lastReadOf, lookOf, parseLastRead, withWorn, wornOf } from "../web/src/rules/handoff";
import { colourTargets } from "../web/src/tryon/recolour";
import type { Swatch } from "../web/src/engine/palette";

const W = 200;
const H = 400;
type Rgb = [number, number, number];
/** An sRGB colour from OKLCH, so a fixture states the colour a stylist would name. */
const lch = (L: number, C: number, h: number): Rgb => oklabToSrgb({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });

interface Scene {
  mask: Mask;
  pixels: { width: number; height: number; data: Uint8ClampedArray };
  pose: Landmark[];
}

function scene(bg: Rgb = [240, 240, 240]): Scene {
  const mask: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
  const data = new Uint8ClampedArray(W * H * 4);
  for (let i = 0; i < W * H; i++) data.set([...bg, 255], i * 4);
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
  return { mask, pixels: { width: W, height: H, data }, pose };
}

/** Paints a rectangle; `rgb` may vary by pixel. */
function fill(s: Scene, y0: number, y1: number, x0: number, x1: number, cat: number, rgb: Rgb | ((x: number, y: number) => Rgb)) {
  for (let y = y0; y < y1; y++)
    for (let x = x0; x < x1; x++) {
      s.mask.data[y * W + x] = cat;
      s.pixels.data.set([...(typeof rgb === "function" ? rgb(x, y) : rgb), 255], (y * W + x) * 4);
    }
}

interface Outfit {
  upper: Rgb | ((x: number, y: number) => Rgb);
  lower: Rgb | ((x: number, y: number) => Rgb);
  shoes: Rgb;
  /** The upper piece's hem row. */
  hem?: number;
  /** Two separate legs (trousers), or one block (a skirt or wide trousers). */
  legs?: "two" | "block";
  sole?: Rgb;
}

/** A person: head, upper piece from the shoulders to the hem, the lower piece, shoes below the ankles. */
function dress(s: Scene, o: Outfit) {
  const hem = o.hem ?? 200;
  fill(s, 10, 50, 85, 115, CATEGORY.faceSkin, [200, 160, 130]);
  fill(s, 50, hem, 70, 130, CATEGORY.clothes, o.upper);
  if (o.legs === "block") fill(s, hem, 376, 72, 128, CATEGORY.clothes, o.lower);
  else {
    const fork = Math.max(hem, 225);
    fill(s, hem, fork, 72, 128, CATEGORY.clothes, o.lower);
    fill(s, fork, 376, 75, 95, CATEGORY.clothes, o.lower);
    fill(s, fork, 376, 105, 125, CATEGORY.clothes, o.lower);
  }
  fill(s, 376, 396, 72, 98, CATEGORY.other, o.shoes);
  fill(s, 376, 396, 102, 128, CATEGORY.other, o.shoes);
  // A sole as tall as the upper is deep, as a sneaker's is in a full-length photo.
  if (o.sole) {
    fill(s, 386, 396, 72, 98, CATEGORY.other, o.sole);
    fill(s, 386, 396, 102, 128, CATEGORY.other, o.sole);
  }
}

function read(s: Scene) {
  const m = measureOutfit(s.pixels, s.mask, s.pose);
  if (typeof m === "string") throw new Error(m);
  const palette = extractPalette(s.pixels, s.mask, m);
  return { m, palette, reading: readOutfit(m, palette) };
}

const swatchLch = (s: Swatch) => labToLch(s.lab);

const BLACK_CYAN = lch(0.2, 0.012, 215);
const PLUM_LIT = lch(0.32, 0.075, 345);
const PLUM_SHADE = lch(0.17, 0.022, 345);
const CORAL = lch(0.7, 0.14, 35);
const WHITE: Rgb = [242, 242, 238];

describe("1. chroma: a garment's colour is its well-lit core, not a mix", () => {
  // p1: a black jacket over plum trousers, half of them in shade, coral sneakers with white soles.
  const p1 = () => {
    const s = scene();
    dress(s, { upper: BLACK_CYAN, lower: (x) => (x % 4 < 2 ? PLUM_LIT : PLUM_SHADE), shoes: CORAL, sole: WHITE });
    return read(s);
  };

  it("plum trousers measure as a colour (0.6.0 read them near grey)", () => {
    const { reading } = p1();
    const lower = reading.bins.palette[pieces(reading.bins.palette, reading.bins.waist, { top: reading.bins.top, bottom: reading.bins.bottom }).lower];
    expect(lower.C).toBeGreaterThanOrEqual(0.06);
    expect(lower.h).toBeGreaterThanOrEqual(335);
    expect(colourName(lower.L, lower.C, lower.h)).not.toMatch(/black|charcoal|grey/);
  });

  it("coral sneakers with white soles read as coral, saturated (0.6.0: chroma 0.05)", () => {
    const { reading } = p1();
    const shoes = reading.bins.palette.find((s) => s.y >= 0.9)!;
    expect(shoes.C).toBeGreaterThanOrEqual(0.11);
    expect(colourName(shoes.L, shoes.C, shoes.h)).toBe("coral");
    expect(reading.lines.find((l) => l.rule === "chroma")!.measured).toBe("1 saturated");
  });

  it("shade on the plum joins the plum: the shares are the jacket, the trousers and the shoes", () => {
    const { reading } = p1();
    const named = byName(reading.bins.palette);
    expect(named.map((n) => n.name)).toEqual(["black", "wine", "coral"]);
    expect(named[1].share).toBeGreaterThanOrEqual(0.35);
  });

  it("the median of a hue's projection: noise round a grey never adds up to a colour", () => {
    const greys = Array.from({ length: 200 }, (_, i) => ({ L: 0.5, a: ((i * 37) % 21 - 10) / 1000, b: ((i * 53) % 21 - 10) / 1000 }));
    expect(labToLch(coreColour(greys)).C).toBeLessThan(0.01);
  });

  it("a uniform tint across the outfit is a light, not a hue: no chromatic swatch, harmony reads neutrals", () => {
    // A grey jacket, darker grey trousers and grey shoes, all under one cool cast of chroma 0.022.
    const s = scene();
    dress(s, { upper: lch(0.55, 0.022, 250), lower: lch(0.38, 0.022, 250), shoes: lch(0.3, 0.022, 250) });
    const { m, reading } = read(s);
    expect(Math.sqrt(m.cast!.a ** 2 + m.cast!.b ** 2)).toBeGreaterThan(0.015);
    expect(Math.sqrt(m.cast!.a ** 2 + m.cast!.b ** 2)).toBeLessThanOrEqual(CAST.max + 1e-9);
    expect(reading.bins.palette.every((p) => p.h === 0)).toBe(true);
    expect(reading.lines.find((l) => l.rule === "harmony")!.measured).toBe("neutrals");
  });

  it("neutral or not is decided on the binned colour the rules read, at or below the line (0.6.0: a 0.018 grey read as 'one hue, 0°')", () => {
    const lab = { L: 0.38, a: 0.018 * Math.cos(0.3), b: 0.018 * Math.sin(0.3) };
    const m = { top: 0, bottom: 1000, breakRow: 400, waistRow: 380, left: 0, right: 0, centerX: 0, topColour: lab, bottomColour: { L: 0.2, a: 0, b: 0 }, fit: null };
    const r = readOutfit(m, [{ lab, share: 0.6, y: 0.3 }, { lab: { L: 0.2, a: 0, b: 0 }, share: 0.4, y: 0.7 }]);
    expect(r.lines.find((l) => l.rule === "harmony")!.measured).toBe("neutrals");
  });

  it("the cast is the median a/b of the near-neutral pools, when the upper and lower pools agree", () => {
    const pool = Array.from({ length: 100 }, () => ({ L: 0.4, a: 0.02, b: 0 }));
    expect(neutralCast(pool, pool).a).toBeCloseTo(0.02, 6);
    // Too few near-neutral pixels: no cast.
    const coloured = Array.from({ length: 100 }, (_, i) => ({ L: 0.4, a: i < 10 ? 0.01 : 0.1, b: 0 }));
    expect(neutralCast(coloured, pool)).toEqual({ a: 0, b: 0 });
    void CAST;
  });

  it("a coloured backdrop's light on the cloth is not a swatch; a garment of that hue still is", () => {
    // A black hoodie over black jeans on a blue stage, the blue light on its shoulders.
    const blue = lch(0.4, 0.15, 265);
    const s = scene(blue);
    dress(s, { upper: (_x, y) => (y < 90 ? lch(0.4, 0.09, 260) : lch(0.25, 0.004, 0)), lower: lch(0.3, 0.004, 0), shoes: WHITE });
    const { reading } = read(s);
    expect(reading.bins.palette.filter((p) => p.h >= 230 && p.h <= 290)).toEqual([]);
    // A blue shirt on the same stage is the shirt.
    const t = scene(blue);
    dress(t, { upper: lch(0.45, 0.1, 260), lower: lch(0.3, 0.004, 0), shoes: WHITE });
    expect(read(t).reading.bins.palette.some((p) => p.h >= 230 && p.h <= 290)).toBe(true);
  });
});

describe("2. volume: the words follow the numbers, arms never count as the cut", () => {
  it("each leg is read on its own: skinny trousers are narrow (0.6.0 summed both legs to 'straight' or 'wide')", () => {
    const s = scene();
    dress(s, { upper: lch(0.6, 0, 0), lower: lch(0.3, 0, 0), shoes: lch(0.2, 0, 0) });
    const { m, reading } = read(s);
    expect(m.fit!.legs).toBeCloseTo(20 / 50, 5);
    expect(legFit(reading.bins.fit!.legs)).toBe("narrow");
    const line = reading.lines.find((l) => l.rule === "volume")!;
    const words = `${topFit(reading.bins.fit!.top)} over ${legFit(reading.bins.fit!.legs)}`;
    expect(line.text.toLowerCase().startsWith(words)).toBe(true);
    expect(measuredCopy(line, reading.bins)).toContain(`, ${legFit(reading.bins.fit!.legs)}.`);
  });

  it("a skirt holding both knees counts half to each leg", () => {
    const s = scene();
    dress(s, { upper: lch(0.6, 0, 0), lower: lch(0.3, 0, 0), shoes: lch(0.2, 0, 0), legs: "block" });
    expect(read(s).m.fit!.legs).toBeCloseTo(56 / 2 / 50, 5);
  });

  it("arms against the sides and hands in pockets: the upper piece is not read and the line says why; the legs still are (round 2)", () => {
    const s = scene();
    dress(s, { upper: lch(0.2, 0, 0), lower: lch(0.35, 0.07, 345), shoes: lch(0.2, 0, 0) });
    // Sleeves in the jacket's colour against the torso, from the shoulders past the hips.
    fill(s, 55, 215, 58, 70, CATEGORY.clothes, lch(0.2, 0, 0));
    fill(s, 55, 215, 130, 142, CATEGORY.clothes, lch(0.2, 0, 0));
    const at = (i: number, x: number, y: number) => (s.pose[i] = { x: x / W, y: y / H, visibility: 0.9 });
    at(13, 66, 130);
    at(14, 134, 130);
    at(15, 70, 200);
    at(16, 130, 200);
    const { m, reading } = read(s);
    expect(m.fit?.top).toBeNull();
    expect(m.fit?.legs).toBeCloseTo(20 / 50, 5);
    expect(m.fitWhy).toBe("arms");
    const line = reading.lines.find((l) => l.rule === "volume")!;
    expect(line).toMatchObject({ state: "neutral", measured: "not read · 0.40×" });
    expect(line.text).toMatch(/^Each leg reads narrow/);
    expect(line.text).toMatch(/an arm or a hand lies over the upper piece's edges/i);
    // No advice is made from a measurement that was not taken.
    expect(suggestLooks(reading.bins, reading.lines).every((l) => l.changes.every((c) => c.rule !== "volume"))).toBe(true);
  });

  it("arms held away from the body leave the torso to be read, and only the torso", () => {
    const s = scene();
    dress(s, { upper: lch(0.2, 0, 0), lower: lch(0.35, 0.07, 345), shoes: lch(0.2, 0, 0) });
    fill(s, 55, 215, 50, 62, CATEGORY.clothes, lch(0.2, 0, 0));
    fill(s, 55, 215, 138, 150, CATEGORY.clothes, lch(0.2, 0, 0));
    const at = (i: number, x: number, y: number) => (s.pose[i] = { x: x / W, y: y / H, visibility: 0.9 });
    at(13, 56, 130);
    at(14, 144, 130);
    at(15, 56, 200);
    at(16, 144, 200);
    expect(read(s).m.fit!.top).toBeCloseTo(60 / 50, 5);
  });
});

describe("3. the break is the outer upper piece's hem", () => {
  it("a t-shirt and a zip showing at the chest are not a break: the hoodie's hem is (0.6.0: 0.28)", () => {
    const s = scene();
    const hoodie = lch(0.22, 0.004, 0);
    // A white t-shirt in the middle of the chest down to row 120, a zip below it, the hem at 230.
    dress(s, { upper: (x, y) => (x >= 90 && x < 110 && y < 75 ? WHITE : x === 100 ? [200, 200, 200] : hoodie), lower: lch(0.55, 0, 0), shoes: WHITE, hem: 230 });
    const { m, reading } = read(s);
    expect(m.breakRow).toBe(230);
    expect(reading.bins.proportion).toBeCloseTo((230 - 10) / (395 - 10), 1);
    // The zip and the t-shirt mark a front opening: no tuck is offered.
    expect(m.front).toBe(true);
  });

  it("a plain upper piece has no front opening", () => {
    const s = scene();
    dress(s, { upper: lch(0.6, 0.05, 80), lower: lch(0.35, 0.06, 250), shoes: lch(0.2, 0, 0) });
    expect(read(s).m.front).toBeUndefined();
  });
});

describe("4. shoes: one detection for the leg line, the palette and try it", () => {
  it("white sneakers under a white t-shirt are still shoes (0.6.0 merged them with the t-shirt)", () => {
    const s = scene();
    dress(s, { upper: WHITE, lower: lch(0.2, 0, 0), shoes: WHITE });
    const { palette, reading } = read(s);
    const p = pieces(reading.bins.palette, reading.bins.waist, { top: reading.bins.top, bottom: reading.bins.bottom });
    expect(p.shoes).toBeGreaterThanOrEqual(0);
    expect(reading.lines.find((l) => l.rule === "legline")?.state).toBe("neutral");
    // "Try it" finds the same shoes the leg line read.
    const targets = colourTargets([{ kind: "accent", L: 0.36, C: 0.11, h: 25, title: "", detail: "" }], palette);
    expect(targets).toHaveLength(1);
    expect(targets[0].swatch).toBe(p.shoes);
  });

  it("shoes cut off by the frame: the leg line says so instead of disappearing", () => {
    const s = scene();
    dress(s, { upper: lch(0.6, 0, 0), lower: lch(0.3, 0, 0), shoes: lch(0.2, 0, 0) });
    // The frame ends at the ankles: nothing below row 376 but the edge.
    for (let y = 376; y < H; y++) for (let x = 0; x < W; x++) s.mask.data[y * W + x] = CATEGORY.background;
    fill(s, 372, 400, 75, 95, CATEGORY.clothes, lch(0.3, 0, 0));
    fill(s, 372, 400, 105, 125, CATEGORY.clothes, lch(0.3, 0, 0));
    const at = (i: number, x: number, y: number) => (s.pose[i] = { x: x / W, y: y / H, visibility: 0.9 });
    at(29, 85, 399);
    at(30, 115, 399);
    at(31, 85, 399);
    at(32, 115, 399);
    const { m, reading } = read(s);
    expect(m.shoesWhy).toBe("cut_off");
    expect(m.feet).toEqual([]);
    const line = reading.lines.find((l) => l.rule === "legline")!;
    expect(line).toMatchObject({ state: "unread", measured: "not read" });
    expect(line.text).toMatch(/cut off by the frame/);
  });

  it("no shoe pixels at all: the line names the reason", () => {
    const s = scene();
    dress(s, { upper: lch(0.6, 0, 0), lower: lch(0.3, 0, 0), shoes: lch(0.2, 0, 0) });
    // The segmenter left the shoes as floor.
    for (let y = 376; y < 396; y++) for (let x = 60; x < 140; x++) s.mask.data[y * W + x] = CATEGORY.background;
    const { m, reading } = read(s);
    expect(m.shoesWhy).toBe("floor");
    const line = reading.lines.find((l) => l.rule === "legline")!;
    expect(line).toMatchObject({ state: "unread", measured: "not read" });
    expect(line.text).toMatch(/merge with the floor/);
    expect(measuredCopy(line, reading.bins)).toMatch(/merge with the floor/);
    // No accent on shoes Ratio cannot see.
    expect(candidateMoves(reading.bins, reading.lines).some((mv) => mv.kind === "accent")).toBe(false);
  });
});

const sw = (L: number, C: number, h: number, share: number, y: number) => ({ L, C, h, share, y });

describe("5. looks are honest", () => {
  it("never suggests the colour a piece already wears ('lower piece in black' on black jeans)", () => {
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.8, C: 0.05, h: 80 }, bottom: { L: 0.26, C: 0, h: 0 }, palette: [sw(0.8, 0.05, 80, 0.5, 0.3), sw(0.26, 0, 0, 0.4, 0.65), sw(0.95, 0, 0, 0.1, 0.95)], fit: null };
    const moves = candidateMoves(b, readBins(b));
    for (const mv of moves) if (mv.kind === "recolour" && mv.piece === "lower") expect(colourName(mv.L, mv.C, mv.h), mv.title).not.toBe("black");
  });

  it("keeps the outfit's accent: no move takes the coral shoes away, and the look and the verdict say keep", () => {
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.32, C: 0.07, h: 350 }, palette: [sw(0.2, 0, 0, 0.5, 0.35), sw(0.32, 0.07, 350, 0.45, 0.65), sw(0.66, 0.15, 35, 0.05, 0.95)], fit: null };
    const lines = readBins(b);
    const moves = candidateMoves(b, lines);
    expect(moves.some((mv) => mv.kind === "accent" || (mv.kind === "recolour" && mv.swatch === 2))).toBe(false);
    const looks = suggestLooks(b, lines);
    for (const l of looks) expect(l.keeps).toEqual(["Keeps the coral shoes."]);
    expect(verdictOf(lines, looks, b)).toContain("Keep the coral shoes.");
  });

  it("no tuck or belt for an upper piece that opens down the front; a tuck elsewhere is a condition", () => {
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.6, C: 0, h: 0 }, palette: [sw(0.2, 0, 0, 0.6, 0.35), sw(0.6, 0, 0, 0.4, 0.65)], fit: null };
    const open = { ...b, front: true as const };
    expect(candidateMoves(open, readBins(open)).some((m) => m.kind === "break")).toBe(false);
    expect(readBins(open)[0].text).not.toMatch(/tuck moves/);
    expect(readBins(open)[0].text).toMatch(/opens down the front/);
    expect(readBins(b)[0].text).toMatch(/If the upper piece tucks, a front tuck/);
    expect(candidateMoves(b, readBins(b))[0]).toMatchObject({ kind: "break", title: "A front tuck, if it tucks" });
  });

  it("every look shows at least one rule that changes", () => {
    // No shoes read: 0.6.0 offered "Shoes in oxblood", which only added a leg line row, with no chip.
    const b: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.8, C: 0, h: 0 }, bottom: { L: 0.3, C: 0, h: 0 }, palette: [sw(0.8, 0, 0, 0.5, 0.3), sw(0.3, 0, 0, 0.5, 0.65)], fit: null, shoesWhy: "floor" };
    const lines = readBins(b);
    for (const look of suggestLooks(b, lines)) expect(look.changes.length, look.title).toBeGreaterThan(0);
    expect(suggestLooks(b, lines).some((l) => l.moves.some((m) => m.kind === "accent"))).toBe(false);
  });
});

describe("6. uncalibrated is said, and the sources are right", () => {
  it("every rule's edges are set by hand, so every entry says so and Read says 'first estimate'", async () => {
    const { adviceLabel } = await import("../web/src/ui/rows");
    for (const [id, e] of Object.entries(RULEBOOK)) {
      expect(e.calibrated, id).toBe(false);
      expect(adviceLabel({ rule: id as keyof typeof RULEBOOK, title: "", measured: "", text: "", state: "advice", borderline: false })).toBe("Advice, first estimate");
    }
    expect(UNCALIBRATED).toBe("set by hand, not yet calibrated");
    expect(UNCALIBRATED_NOTE).toContain("set by hand, to be calibrated against labelled photos.");
    // The UI copy names no repository path.
    expect(UNCALIBRATED_NOTE).not.toMatch(/docs\/|\.md|R1/);
  });

  it("60-30-10 cites interior design only; the half wheel is any 180° arc; no Dürer in the provenance", () => {
    expect(RULEBOOK.shares.sources.map((s) => s.label).join(" ")).not.toMatch(/Euclid/);
    const half = TEMPLATES.find((t) => t.id === "T")!;
    expect(half.gloss).not.toMatch(/warm|cool/);
    expect(half.gloss).toMatch(/180°/);
    expect(PROVENANCE).not.toMatch(/Dürer/);
  });
});

describe("7. the verdict is written from the leading measurement", () => {
  it("differs between outfits, says what to keep, and is the same every time", () => {
    const halves: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.32, C: 0.07, h: 350 }, palette: [sw(0.2, 0, 0, 0.5, 0.35), sw(0.32, 0.07, 350, 0.45, 0.65), sw(0.66, 0.15, 35, 0.05, 0.95)], fit: null, front: true };
    const column: Bins = { proportion: null, waist: 0.38, top: { L: 0.25, C: 0, h: 0 }, bottom: { L: 0.3, C: 0, h: 0 }, palette: [sw(0.25, 0, 0, 0.55, 0.45), sw(0.38, 0, 0, 0.35, 0.6), sw(0.88, 0, 0, 0.1, 0.95)], fit: null };
    const golden: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.8, C: 0.04, h: 80 }, bottom: { L: 0.3, C: 0.07, h: 255 }, palette: [sw(0.3, 0.07, 255, 0.6, 0.65), sw(0.8, 0.04, 80, 0.3, 0.3), sw(0.36, 0.11, 25, 0.1, 0.95)], fit: { top: 1.0, legs: 0.7 } };
    const verdicts = [halves, column, golden].map((b) => verdictOf(readBins(b), suggestLooks(b, readBins(b)), b));
    expect(new Set(verdicts).size).toBe(3);
    expect(verdicts[0]).toMatch(/middle of the figure/);
    expect(verdicts[0]).toContain("Keep the coral shoes.");
    expect(verdicts[1]).toMatch(/composed by value/);
    expect(verdicts[2]).toMatch(/golden section|a third/);
    for (const v of verdicts) {
      for (const w of JUDGING_WORDS) expect(v.toLowerCase()).not.toContain(w);
      expect(v).not.toContain("—");
    }
    expect(verdictOf(readBins(halves), suggestLooks(halves, readBins(halves)), halves)).toBe(verdicts[0]);
  });
});

describe("copy law over every new line (V4)", () => {
  it("no judging word and no em dash in the unread lines, the front-opening proportion lines, the verdicts or the keeps", async () => {
    const { legUnread, volumeUnread } = await import("../web/src/engine/shape-rules");
    const texts = [volumeUnread("arms").text, legUnread("cut_off").text, legUnread("floor").text];
    for (const proportion of [0.5, 0.75])
      for (const front of [true, undefined]) {
        const b: Bins = { proportion, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.32, C: 0.07, h: 350 }, palette: [sw(0.2, 0, 0, 0.5, 0.35), sw(0.32, 0.07, 350, 0.45, 0.65), sw(0.66, 0.15, 35, 0.05, 0.95)], fit: null, fitWhy: "arms", ...(front ? { front } : {}) };
        const lines = readBins(b);
        const looks = suggestLooks(b, lines);
        texts.push(...lines.map((l) => l.text), ...lines.map((l) => measuredCopy(l, b)), verdictOf(lines, looks, b), ...looks.flatMap((l) => [l.title, ...l.keeps, ...l.moves.map((m) => m.detail)]));
      }
    for (const t of texts) {
      for (const w of JUDGING_WORDS) expect(t.toLowerCase(), t).not.toContain(w);
      expect(t, t).not.toContain("—");
      expect(t.toLowerCase(), t).not.toMatch(/body|your (waist|hips|legs|figure)/);
    }
  });
});

describe("5b. Read never contradicts its own advice", () => {
  it("with no look to offer, the looks line says advice remains when a rule gives it", async () => {
    const { looksIntroOf } = await import("../web/src/engine/verdict");
    const advice = { rule: "proportion" as const, title: "", measured: "", text: "", state: "advice" as const, borderline: false };
    expect(looksIntroOf([advice], 0)).not.toMatch(/on the mark or fine/);
    expect(looksIntroOf([{ ...advice, state: "neutral" }], 0)).toMatch(/on the mark or fine/);
    expect(looksIntroOf([advice], 2)).toMatch(/^2 looks/);
  });

  it("tuckable(bins) is the one predicate for the tuck: false on an opening front, and the proportion text, the tuck move and the volume advice agree", async () => {
    const { tuckable } = await import("../web/src/engine/rules");
    const b: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.6, C: 0, h: 0 }, palette: [sw(0.2, 0, 0, 0.6, 0.35), sw(0.6, 0, 0, 0.4, 0.65)], fit: { top: 1.6, legs: 0.7 } };
    const open = { ...b, front: true as const };
    expect(tuckable(b)).toBe(true);
    expect(tuckable(open)).toBe(false);
    for (const [bins, can] of [[b, true], [open, false]] as const) {
      const lines = readBins(bins);
      expect(candidateMoves(bins, lines).some((m) => m.kind === "break"), String(can)).toBe(can);
      expect(/tuck/.test(lines.find((l) => l.rule === "volume")!.text), String(can)).toBe(can);
      expect(/front tuck/.test(lines[0].text), String(can)).toBe(can);
    }
  });
});

describe("8. the Rulebook", () => {
  it("the arrows move a handle the way they point: Down moves the break down the tape", () => {
    expect(keyStep("ArrowDown", true)).toBe(1);
    expect(keyStep("ArrowUp", true)).toBe(-1);
    expect(keyStep("ArrowRight", true)).toBe(1);
    expect(keyStep("ArrowLeft", true)).toBe(-1);
    // A horizontal scale: Down lowers the value, as Left does.
    expect(keyStep("ArrowDown", false)).toBe(-1);
    expect(keyStep("ArrowLeft", false)).toBe(-1);
    expect(keyStep("ArrowRight", false)).toBe(1);
    expect(keyStep("Home", true)).toBe("min");
    expect(keyStep("a", true)).toBeNull();
  });

  it("marks the outfit as worn first, and a tried look as the second marker", () => {
    const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.2, C: 0, h: 0 }, bottom: { L: 0.6, C: 0, h: 0 }, palette: [sw(0.2, 0, 0, 0.6, 0.35), sw(0.6, 0, 0, 0.4, 0.65)], fit: null };
    const worn = lastReadOf({ engine: "ratio-engine/0.7.0", hash: "aaaaaaaaaaaa", source: "photo", look: null, bins, lines: readBins(bins) });
    const lookBins = { ...bins, proportion: 0.38 };
    const look = lastReadOf({ engine: "ratio-engine/0.7.0", hash: "bbbbbbbbbbbb", source: "photo", look: "A front tuck, if it tucks", bins: lookBins, lines: readBins(lookBins) });
    const stored: LastRead = withWorn(look, worn);
    expect(wornOf(stored).bins.proportion).toBe(0.5);
    expect(wornOf(stored).hash).toBe("aaaaaaaaaaaa");
    expect(lookOf(stored)?.bins.proportion).toBe(0.38);
    // It survives the trip through session storage, and a worn reading never rides without a look.
    expect(parseLastRead(JSON.stringify(stored))).toEqual(stored);
    expect(parseLastRead(JSON.stringify({ ...stored, look: null }))).toBeNull();
    // Beside a look the browser keeps the as-worn reading's hash, bins and line labels only: no prose, no pixels.
    expect(Object.keys(stored.worn!).sort()).toEqual(["bins", "hash", "lines"]);
    expect(Object.keys(stored.worn!.lines[0]).sort()).toEqual(["borderline", "measured", "rule", "state"]);
    // As worn alone: no look marker.
    expect(lookOf(worn)).toBeNull();
    expect(wornOf(worn).hash).toBe("aaaaaaaaaaaa");
  });
});
