// The engine is deterministic and its copy never judges the person. A
// synthetic figure stands in for the models: a head, an upper garment, a
// lower garment and shoes painted into a category mask and its pixels, with
// pose landmarks where a person's would be.

import { describe, expect, it } from "vitest";
import { deltaE, hueGap, labToLch, srgbToOklab } from "../web/src/engine/color";
import { canonicalJson, readingHash } from "../web/src/engine/hash";
import { CATEGORY, type Landmark, type Mask, measureOutfit } from "../web/src/engine/measure";
import { downsample, targetSize } from "../web/src/engine/resample";
import { type BinnedSwatch, TEMPLATES, chromaLine, fitTemplate, harmonyLine, sharesLine, valueLine } from "../web/src/engine/colour-rules";
import { extractPalette } from "../web/src/engine/palette";
import { BODY_MEASURE_WORDS, type Bins, JUDGING_WORDS, readBins, readOutfit } from "../web/src/engine/rules";
import { suggestLooks } from "../web/src/engine/looks";
import { measuredCopy } from "../web/src/engine/measured";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { verdictOf } from "../web/src/engine/verdict";

const W = 200;
const H = 400;
type Rgb = [number, number, number];

interface Figure {
  /** Last row of the upper garment (exclusive). */
  hem: number;
  upper: Rgb;
  lower: Rgb;
}

function paint({ hem, upper, lower }: Figure) {
  const mask: Mask = { width: W, height: H, data: new Uint8Array(W * H) };
  const data = new Uint8ClampedArray(W * H * 4);
  const fill = (y0: number, y1: number, x0: number, x1: number, cat: number, rgb: Rgb) => {
    for (let y = y0; y < y1; y++)
      for (let x = x0; x < x1; x++) {
        mask.data[y * W + x] = cat;
        data.set([...rgb, 255], (y * W + x) * 4);
      }
  };
  fill(0, H, 0, W, CATEGORY.background, [240, 240, 240]);
  fill(10, 50, 85, 115, CATEGORY.faceSkin, [200, 160, 130]);
  fill(50, hem, 65, 135, CATEGORY.clothes, upper);
  fill(hem, 380, 75, 125, CATEGORY.clothes, lower);
  fill(380, 395, 75, 125, CATEGORY.other, [30, 30, 30]);
  const pose: Landmark[] = Array.from({ length: 33 }, () => ({ x: 0.5, y: 0.5, visibility: 0 }));
  const at = (i: number, x: number, y: number) => (pose[i] = { x: x / W, y: y / H, visibility: 0.99 });
  at(11, 75, 60);
  at(12, 125, 60);
  at(23, 85, 190);
  at(24, 115, 190);
  at(25, 88, 290);
  at(26, 112, 290);
  at(27, 90, 380);
  at(28, 110, 380);
  return { pixels: { width: W, height: H, data }, mask, pose };
}

const SAND: Rgb = [214, 196, 160];
const DENIM: Rgb = [52, 78, 120];

function read(f: Figure) {
  const { pixels, mask, pose } = paint(f);
  const m = measureOutfit(pixels, mask, pose);
  if (typeof m === "string") throw new Error(m);
  return { m, reading: readOutfit(m, extractPalette(pixels, mask, m)) };
}

describe("colour", () => {
  it("maps white and black to the ends of OKLab lightness", () => {
    expect(srgbToOklab(255, 255, 255).L).toBeCloseTo(1, 3);
    expect(srgbToOklab(0, 0, 0).L).toBeCloseTo(0, 6);
    expect(labToLch(srgbToOklab(128, 128, 128)).C).toBeLessThan(0.001);
  });

  it("measures hue gaps the short way round the wheel", () => {
    expect(hueGap(350, 10)).toBe(20);
    expect(hueGap(30, 215)).toBe(175);
    expect(deltaE(srgbToOklab(1, 2, 3), srgbToOklab(1, 2, 3))).toBe(0);
  });
});

describe("downsample", () => {
  it("fits the long side and averages boxes exactly", () => {
    expect(targetSize(4000, 3000)).toEqual({ width: 512, height: 384 });
    expect(targetSize(300, 200)).toEqual({ width: 300, height: 200 });
    const src = { width: 2, height: 2, data: new Uint8ClampedArray([0, 0, 0, 255, 255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]) };
    expect(Array.from(downsample(src, 1).data)).toEqual([128, 128, 128, 255]);
  });
});

describe("outfit read", () => {
  it("reads the founder's example: an untucked top at the hip splits the figure in halves", () => {
    const { m, reading } = read({ hem: 200, upper: SAND, lower: DENIM });
    expect(m.breakRow).toBe(200);
    const proportion = reading.lines[0];
    expect(proportion.state).toBe("advice");
    expect(proportion.measured).toBe("0.50 : 0.50");
    expect(proportion.text).toMatch(/front tuck/);
  });

  it("reads a tucked top as near the golden section", () => {
    const { reading } = read({ hem: 140, upper: SAND, lower: DENIM });
    expect(reading.bins.proportion).toBeGreaterThanOrEqual(0.34);
    expect(reading.bins.proportion).toBeLessThan(0.44);
    expect(reading.lines[0].state).toBe("golden");
  });

  it("reads one colour head to foot as a single column, with no break", () => {
    const { m, reading } = read({ hem: 200, upper: DENIM, lower: DENIM });
    expect(m.breakRow).toBeNull();
    expect(reading.bins.proportion).toBeNull();
    expect(reading.lines[0].measured).toBe("one column");
  });

  it("reads an orange and denim pairing as a complementary harmony", () => {
    const { reading } = read({ hem: 200, upper: [200, 120, 60], lower: DENIM });
    const harmony = reading.lines.find((l) => l.rule === "harmony");
    expect(harmony?.text).toMatch(/complementary/);
    expect(harmony?.state).toBe("golden");
  });

  it("extracts the outfit's palette by area: upper, lower and shoes", () => {
    const { reading } = read({ hem: 200, upper: SAND, lower: DENIM });
    const shares = reading.bins.palette.map((p) => p.share);
    expect(reading.bins.palette.length).toBe(3);
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(1, 1);
    expect(reading.lines.map((l) => l.rule)).toEqual(["proportion", "volume", "legline", "harmony", "value", "shares", "chroma"]);
  });

  it("gives the same reading and the same hash every time", async () => {
    const a = read({ hem: 200, upper: SAND, lower: DENIM }).reading;
    const b = read({ hem: 200, upper: SAND, lower: DENIM }).reading;
    expect(b).toEqual(a);
    const ha = await readingHash({ engine: a.engine, bins: a.bins });
    expect(await readingHash({ bins: b.bins, engine: b.engine })).toBe(ha);
    expect(ha).toMatch(/^[0-9a-f]{12}$/);
  });

  it("refuses a figure whose feet are out of frame", () => {
    const { pixels, mask, pose } = paint({ hem: 200, upper: SAND, lower: DENIM });
    pose[27] = { ...pose[27], visibility: 0.1 };
    pose[28] = { ...pose[28], visibility: 0.1 };
    expect(measureOutfit(pixels, mask, pose)).toBe("feet_not_in_frame");
  });
});

describe("hash", () => {
  it("is independent of key order", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 3, c: 4 }] })).toBe('{"a":[2,{"c":4,"d":3}],"b":1}');
  });
});

const sw = (L: number, C: number, h: number, share: number, y = 0.3): BinnedSwatch => ({ L, C, h, share, y });

describe("colour theory", () => {
  it("fits Matsuda's templates: one hue is monochromatic, opposite hues complementary", () => {
    const i = TEMPLATES.find((t) => t.id === "i")!;
    const I = TEMPLATES.find((t) => t.id === "I")!;
    expect(fitTemplate([sw(0.5, 0.1, 30, 0.6), sw(0.3, 0.1, 35, 0.4)], i).cost).toBe(0);
    expect(fitTemplate([sw(0.5, 0.1, 30, 0.6), sw(0.3, 0.1, 210, 0.4)], I).cost).toBe(0);
    expect(fitTemplate([sw(0.5, 0.1, 30, 0.6), sw(0.3, 0.1, 120, 0.4)], I).cost).toBeGreaterThan(0);
  });

  it("names the colour outside the scheme when no template fits", () => {
    const line = harmonyLine([sw(0.5, 0.12, 30, 0.4, 0.3), sw(0.5, 0.12, 150, 0.3, 0.7), sw(0.5, 0.12, 270, 0.3, 0.95)], 0.38);
    expect(line.state).toBe("advice");
    expect(line.text).toMatch(/fit no classic harmony template/);
  });

  it("reads neutrals alone as composed by value", () => {
    expect(harmonyLine([sw(0.2, 0, 0, 0.6), sw(0.9, 0, 0, 0.4)], 0.38).text).toMatch(/composed by value alone/);
  });

  it("flags dark over light as top-heavy, and light over dark as grounded", () => {
    expect(valueLine([sw(0.2, 0, 0, 0.5), sw(0.8, 0, 0, 0.5)], 0.2, 0.8).state).toBe("advice");
    expect(valueLine([sw(0.8, 0, 0, 0.5), sw(0.2, 0, 0, 0.5)], 0.8, 0.2).text).toMatch(/^Light over dark/);
    // A darker upper piece is never called light over dark, however small the gap.
    expect(valueLine([sw(0.24, 0, 0, 0.5), sw(0.38, 0, 0, 0.5)], 0.24, 0.38).text).toMatch(/^Dark over light/);
    expect(valueLine([sw(0.24, 0, 0, 0.5), sw(0.38, 0, 0, 0.5)], 0.24, 0.38).state).toBe("neutral");
  });

  it("measures 60-30-10 and calls out equal shares", () => {
    expect(sharesLine([sw(0.5, 0.1, 30, 0.6), sw(0.3, 0.1, 210, 0.3), sw(0.9, 0, 0, 0.1)]).state).toBe("golden");
    expect(sharesLine([sw(0.5, 0.1, 30, 0.5), sw(0.3, 0.1, 210, 0.5)]).state).toBe("advice");
    expect(sharesLine([sw(0.5, 0.1, 30, 0.6), sw(0.3, 0.1, 210, 0.4)]).text).toMatch(/golden section/);
  });

  it("warns of Albers' vibration: complements at equal lightness and high chroma", () => {
    const line = chromaLine([sw(0.6, 0.15, 30, 0.5, 0.3), sw(0.62, 0.15, 210, 0.5, 0.7)], 0.38);
    expect(line.state).toBe("advice");
    expect(line.text).toMatch(/vibrate/);
    expect(chromaLine([sw(0.6, 0.15, 30, 0.3), sw(0.3, 0.03, 210, 0.7)], 0.38).state).toBe("golden");
  });
});

describe("copy law (V4, design lint)", () => {
  // Every line the rulebook can say, across a grid of bins.
  function allLines(): string[] {
    const out: string[] = [];
    const colours = [sw(0.9, 0, 0, 0.5, 0.2), sw(0.5, 0.12, 30, 0.3, 0.3), sw(0.3, 0.1, 80, 0.2, 0.7), sw(0.6, 0.12, 160, 0.4, 0.6), sw(0.4, 0.06, 215, 0.1, 0.95)];
    const toLab = ({ L, C, h }: BinnedSwatch) => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });
    for (const proportion of [null, 0.2, 0.38, 0.5, 0.6, 0.8])
      for (const top of colours)
        for (const bottom of colours) {
          const palette = [top, bottom, ...colours.filter((c) => c !== top && c !== bottom)].slice(0, 3).map((c, i, all) => ({ lab: toLab(c), share: i === 0 ? 0.6 : 0.4 / (all.length - 1), y: c.y }));
          const r = readOutfit({ top: 0, bottom: 1000, breakRow: proportion === null ? null : proportion * 1000, waistRow: 360, left: 0, right: 0, centerX: 0, topColour: toLab(top), bottomColour: toLab(bottom), fit: { top: proportion === null ? 1.0 : 1.5, legs: proportion === 0.5 ? 0.9 : 0.5 } }, palette);
          out.push(...r.lines.map((l) => l.text));
        }
    return out;
  }

  it("never uses a judging word or an em dash", () => {
    for (const text of allLines()) {
      for (const word of JUDGING_WORDS) expect(text.toLowerCase(), text).not.toContain(word);
      expect(text).not.toContain("—");
    }
  });

  // T6 (Mara, UX pass 3): "Each leg reads narrow (0.40× the shoulder width at
  // the knee)" is heard as a remark on the client's legs and shoulders. Every
  // line names the garment: advice, Measured copy, verdict and look reasons,
  // including each volume case (both read, one read, none read) and each
  // leg-line case (continuing, contrasting, accent shoes, not read).
  function everyGarmentLine(): string[] {
    const out = allLines();
    const base = (over: Partial<Bins>): Bins => ({
      proportion: 0.5,
      waist: 0.38,
      top: { L: 0.3, C: 0, h: 0 },
      bottom: { L: 0.5, C: 0.1, h: 150 },
      palette: [sw(0.3, 0, 0, 0.55, 0.3), sw(0.5, 0.1, 150, 0.35, 0.65), sw(0.7, 0.14, 35, 0.1, 0.95)],
      fit: { top: 1.5, legs: 0.7 },
      ...over,
    });
    const variants: Bins[] = [];
    for (const fit of [null, { top: 1.0, legs: 0.3 }, { top: 1.5, legs: null }, { top: null, legs: 0.4 }, { top: 1.7, legs: 0.9 }, { top: 1.2, legs: 0.5 }])
      for (const fitWhy of [undefined, "arms" as const])
        for (const shoesL of [0.5, 0.9])
          for (const front of [undefined, true as const])
            variants.push(base({ fit, ...(fitWhy ? { fitWhy } : {}), ...(front ? { front } : {}), palette: [sw(0.3, 0, 0, 0.55, 0.3), sw(0.5, 0.1, 150, 0.35, 0.65), sw(shoesL, shoesL > 0.6 ? 0.14 : 0, 35, 0.1, 0.95)] }));
    variants.push(base({ palette: [sw(0.3, 0, 0, 0.6, 0.3), sw(0.5, 0.1, 150, 0.4, 0.65)], shoesWhy: "cut_off" }), base({ proportion: null, bottom: { L: 0.3, C: 0, h: 0 }, palette: [sw(0.3, 0, 0, 0.9, 0.5), sw(0.32, 0, 0, 0.1, 0.95)] }));
    for (const b of variants) {
      const lines = readBins(b);
      const looks = suggestLooks(b, lines);
      out.push(verdictOf(lines, looks, b), ...lines.flatMap((l) => [l.text, measuredCopy(l, b), RULEBOOK[l.rule].rule]), ...looks.flatMap((k) => [k.title, ...k.moves.map((m) => m.detail)]));
    }
    return out;
  }

  it("never makes a body part the thing measured: garment lines only (T6)", () => {
    // The lint catches the old copy.
    const old = "Each leg reads narrow (0.40× the shoulder width at the knee).";
    expect(BODY_MEASURE_WORDS.some((w) => old.toLowerCase().includes(w))).toBe(true);
    const texts = everyGarmentLine();
    expect(texts.length).toBeGreaterThan(400);
    for (const text of texts) {
      for (const word of BODY_MEASURE_WORDS) expect(text.toLowerCase(), text).not.toContain(word);
      for (const word of JUDGING_WORDS) expect(text.toLowerCase(), text).not.toContain(word);
      expect(text).not.toContain("—");
    }
  });
});
