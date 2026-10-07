// T6 (UX pass 3, R-09): every line a reading shows agrees with the other
// lines and names the garment, never the body.
//
// - No line, Measured copy, verdict, look or look reason makes a body part
//   the thing measured (bodyMeasureIn: BODY_MEASURE_WORDS and BODY_PART_PATTERNS).
// - A rule that was not judged never shows "fine".
// - The verdict never keeps a piece any line, or the look it offers, asks to
//   change; the proportion line's shoe clause follows the leg line.
// - The Harmony row shows the plain template name.
// - Every move in a look carries its own reason.
//
// Checked on the three committed fixtures' bins (fixtures.lock.json, the
// readings Mara, Noor and Sam saw) and on the reviewers' reproducers; the
// 4000-reading probe is tests/advice-probe.test.ts. The checks live in
// tests/helpers/agrees.ts.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BinnedSwatch } from "../web/src/engine/colour-rules";
import { accentOf, accentWords, pieceOf, pieces } from "../web/src/engine/looks";
import { measuredCopy } from "../web/src/engine/measured";
import { type Bins, readBins } from "../web/src/engine/rules";
import { looksIntroOf, restoredLooksIntroOf } from "../web/src/engine/verdict";
import { STATE_WORDS, stateLabel } from "../web/src/ui/rows";
import { agrees, keepsShoes, show } from "./helpers/agrees";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));
const fixtureBins = (id: "sample" | "p1" | "p2"): Bins => lock.fixtures[id].bins as Bins;


describe("the UX pass 3 fixtures (fixtures.lock.json bins)", () => {
  for (const id of ["sample", "p1", "p2"] as const) {
    it(`${id}: every line agrees and names the garment`, () => agrees(show(fixtureBins(id)), id));
  }

  it("Volume names the garment: no 'each leg', no 'shoulder width' (Mara)", () => {
    for (const id of ["sample", "p1", "p2"] as const) {
      const s = show(fixtureBins(id));
      const v = s.lines.find((l) => l.rule === "volume")!;
      const copy = measuredCopy(v, s.bins);
      expect(v.text + copy).not.toMatch(/each leg|shoulder width|torso/i);
      expect(copy).toMatch(/lower piece/);
    }
    const p2 = show(fixtureBins("p2"));
    const v = p2.lines.find((l) => l.rule === "volume")!;
    expect(measuredCopy(v, p2.bins)).toBe("Upper piece 0.90× its shoulder line, read on one side, on the rows no arm crosses, fitted; lower piece 0.45× at the knee line, straight.");
  });

  it("p1 (Noor, UX pass 3 read 0429 at 0.9.0, ed0f at 0.10.0): keeps the coral shoes, and the leg line keeps them too", () => {
    const s = show(fixtureBins("p1"));
    expect(s.verdict).toContain("Keep the coral shoes.");
    const leg = s.lines.find((l) => l.rule === "legline")!;
    expect(leg.text).not.toMatch(/nearer/);
    expect(leg.text).toMatch(/accent, so the contrast is the point: keep it\.$/);
    expect(leg.recolours).toBeUndefined();
  });

  it("p1: the half-read Volume row says 'not judged', never 'fine' (Sam, Noor)", () => {
    const s = show(fixtureBins("p1"));
    const v = s.lines.find((l) => l.rule === "volume")!;
    expect(v.measured).toBe("not read · 0.40×");
    expect(v.state).toBe("unread");
    expect(stateLabel(v)).toBe(STATE_WORDS.unread);
    expect(STATE_WORDS.unread).toBe("not judged");
    expect(v.text).toMatch(/balance of the two is not judged/);
  });

  it("p1: the Harmony row shows the plain name, 'analogous', not Matsuda's 'V' (Mara)", () => {
    const h = show(fixtureBins("p1")).lines.find((l) => l.rule === "harmony")!;
    expect(h.measured).toBe("analogous · 345° 35°");
  });

  it("p2 (Mara, UX pass 3 read ed6c at 0.9.0, ef5b at 0.10.0): one column over contrasting shoes says so, and never says to keep the shoes close", () => {
    const s = show(fixtureBins("p2"));
    const prop = s.lines.find((l) => l.rule === "proportion")!;
    const leg = s.lines.find((l) => l.rule === "legline")!;
    expect(leg.state).toBe("neutral");
    expect(leg.text).toMatch(/contrast/);
    expect(prop.text).toMatch(/The shoes contrast with it, so the column stops where the shoes begin/);
    expect(prop.text).not.toMatch(/Keep the shoes/);
    // "Works" and the looks' "No rule asks for a change" stay true: no rule gives advice.
    expect(s.lines.some((l) => l.state === "advice")).toBe(false);
    expect(s.verdict).toMatch(/^Works\./);
    expect(keepsShoes(s.verdict)).toBe(false);
  });

  it("sample (Mara, Looks): each swap in a look carries its own reason", () => {
    const s = show(fixtureBins("sample"));
    const two = s.looks.filter((l) => l.moves.length > 1);
    for (const look of s.looks) for (const m of look.moves) expect(m.detail).toMatch(/: /);
    for (const look of two) {
      const reasons = look.moves.map((m) => m.detail.split(": ")[1]);
      expect(new Set(reasons).size).toBe(reasons.length);
    }
    // The navy lower piece is explained by navy's reason, not the accent's.
    for (const look of s.looks)
      for (const m of look.moves) if (m.kind === "recolour") expect(m.detail).not.toMatch(/accent of about a tenth/);
  });
});

describe("review round 1 reproducers", () => {
  const lch = (s: BinnedSwatch) => ({ L: s.L, C: s.C, h: s.h });
  const swatch = (L: number, C: number, h: number, share: number, y: number): BinnedSwatch => ({ L, C, h, share, y });

  /** (a) A small blue accent at y 0.7 (a bag or a belt) and a look that recolours the lower piece. */
  const reproA = (): Bins => {
    const palette = [swatch(0.6, 0.08, 95, 0.35, 0.6), swatch(0.4, 0.05, 280, 0.35, 0.3), swatch(0.5, 0.18, 255, 0.1, 0.7), swatch(0.5, 0.05, 330, 0.1, 0.6), swatch(0.95, 0, 0, 0.05, 0.6), swatch(0.6, 0.18, 0, 0.05, 0.95)];
    return { proportion: 0.72, waist: 0.38, top: lch(palette[1]), bottom: lch(palette[0]), palette, fit: null, front: true };
  };
  /** (b) Two blues; the look takes the lower piece to charcoal. */
  const reproB = (): Bins => {
    const palette = [swatch(0.3, 0.18, 240, 0.85, 0.6), swatch(0.5, 0.18, 215, 0.15, 0.2)];
    return { proportion: 0.72, waist: 0.38, top: lch(palette[1]), bottom: lch(palette[0]), palette, fit: null, front: true };
  };

  it("1a. never 'Keep the hues as they are' over a look that recolours a hue; the bag-sized accent is kept, not suppressed by where it sits", () => {
    const s = show(reproA());
    expect(s.looks[0].moves.some((m) => m.kind === "recolour" && m.piece === "lower")).toBe(true);
    expect(s.verdict).not.toContain("Keep the hues as they are.");
    expect(s.verdict).toContain(`Keep ${accentWords(s.bins)}.`);
    agrees(s, "repro a");
  });

  it("1b. never 'Keep the hues as they are' when the look takes a coloured piece to a neutral", () => {
    const s = show(reproB());
    expect(s.looks[0].title).toMatch(/Lower piece in charcoal/);
    expect(s.verdict).not.toContain("Keep the hues as they are.");
    agrees(s, "repro b");
  });

  it("2. a yellow column over stone shoes at the leg line's edge carries the borderline mark (law 2)", () => {
    const palette = [swatch(0.8, 0.1, 95, 0.9, 0.5), swatch(0.7, 0.02, 80, 0.1, 0.95)];
    const b: Bins = { proportion: null, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[0]), palette, fit: null };
    const lines = readBins(b);
    const prop = lines.find((l) => l.rule === "proportion")!;
    const leg = lines.find((l) => l.rule === "legline")!;
    expect(leg.measured).toBe("ΔL 0.10");
    expect(leg.borderline).toBe(true);
    expect(prop.text).toMatch(/close in value too.*the leg line says more\.$/);
    expect(prop.borderline).toBe(true);
  });

  it("value: shoes carrying the leg line on darken with the lower piece, as a pair, never alone", () => {
    const palette = [swatch(0.2, 0, 0, 0.5, 0.3), swatch(0.6, 0, 0, 0.4, 0.65), swatch(0.62, 0, 0, 0.1, 0.95)];
    const b: Bins = { proportion: 0.38, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[1]), palette, fit: null };
    const lines = readBins(b);
    expect(lines.find((l) => l.rule === "legline")!.state).toBe("golden");
    const value = lines.find((l) => l.rule === "value")!;
    expect(value.state).toBe("advice");
    expect(value.text).toMatch(/a darker lower piece and shoes to match would do it/);
    expect(value.text).not.toMatch(/or darker shoes/);
    expect(value.recolours).toEqual([{ garment: "lower" }, { garment: "shoes", matched: true }]);
    agrees(show(b), "value pair");
  });

  it("harmony: kept shoes (the accent) are never the colour named outside the scheme while another piece can be", () => {
    const palette = [swatch(0.5, 0.12, 30, 0.45, 0.3), swatch(0.3, 0.12, 150, 0.4, 0.65), swatch(0.7, 0.15, 270, 0.15, 0.95)];
    const b: Bins = { proportion: 0.38, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[1]), palette, fit: null };
    const s = show(b);
    const harmony = s.lines.find((l) => l.rule === "harmony")!;
    expect(harmony.state).toBe("advice");
    expect(accentWords(b)).toMatch(/shoes$/);
    expect(harmony.text).not.toMatch(/The shoes at/);
    expect(harmony.recolours?.every((r) => r.garment !== "shoes")).toBe(true);
    agrees(s, "harmony kept shoes");
  });

  it("3. the restore-from-chalk path never says 'on the mark or fine' over a rule not judged", () => {
    const p1 = readBins(fixtureBins("p1"));
    const noAdvice = p1.map((l) => (l.state === "advice" ? { ...l, state: "neutral" as const } : l));
    expect(restoredLooksIntroOf(noAdvice, 0)).toBe(looksIntroOf(noAdvice, 0));
    expect(restoredLooksIntroOf(noAdvice, 0)).toMatch(/Every rule Ratio could judge/);
    expect(restoredLooksIntroOf(p1, 0)).toBe(looksIntroOf(p1, 0));
    expect(restoredLooksIntroOf(p1, 2)).toMatch(/^2 looks the rules prefer.*chalk figure/);
    // main.ts takes the sentence from the engine, never a copy of its own.
    const main = readFileSync(path.join(repoRoot, "web/src/main.ts"), "utf8");
    expect(main).not.toContain("on the mark or fine");
    expect(main).toContain("restoredLooksIntroOf(asWornLines, looks.length)");
  });
});

describe("review round 2 reproducers", () => {
  const swatch = (L: number, C: number, h: number, share: number, y: number): BinnedSwatch => ({ L, C, h, share, y });
  const lch = (s: BinnedSwatch) => ({ L: s.L, C: s.C, h: s.h });

  it("1. a pink skirt that is the accent is not kept while Value asks for a darker lower piece", () => {
    const palette = [swatch(0.2, 0.05, 240, 0.35, 0.3), swatch(0.94, 0, 0, 0.25, 0.2), swatch(0.4, 0.05, 280, 0.2, 0.2), swatch(0.94, 0.15, 0, 0.15, 0.7), swatch(0.15, 0, 0, 0.05, 0.95)];
    const b: Bins = { proportion: 0.44, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[3]), palette, fit: { top: 1.5, legs: null } };
    const s = show(b);
    const value = s.lines.find((l) => l.rule === "value")!;
    expect(value.recolours?.some((r) => r.garment === "lower")).toBe(true);
    expect(pieceOf(accentOf(b), pieces(b))).toBe("lower");
    expect(s.verdict).not.toContain(`Keep ${accentWords(b)}.`);
    agrees(s, "pink skirt");
  });

  it("2. a value look darkens the shoes with the lower piece when the value row says so, and never breaks the leg line", () => {
    const palette = [swatch(0.2, 0, 0, 0.5, 0.3), swatch(0.4, 0, 0, 0.4, 0.65), swatch(0.5, 0, 0, 0.1, 0.95)];
    const b: Bins = { proportion: 0.38, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[1]), palette, fit: null };
    const s = show(b);
    const value = s.lines.find((l) => l.rule === "value")!;
    expect(value.state).toBe("advice");
    expect(value.recolours).toEqual([{ garment: "lower" }, { garment: "shoes", matched: true }]);
    expect(value.text).toContain("a darker lower piece and shoes to match would do it");
    const darker = s.looks.filter((look) => look.moves.some((m) => m.title.startsWith("A darker lower piece")));
    expect(darker.length).toBeGreaterThan(0);
    for (const look of darker) expect(look.moves.some((m) => m.kind === "recolour" && m.piece === "shoes")).toBe(true);
    for (const look of s.looks) expect(look.lines.find((l) => l.rule === "legline")!.state).toBe("golden");
    agrees(s, "value pair look");
  });

  it("3. the one saturated note is a colour: a look that swaps which colour is saturated never keeps it", () => {
    const palette = [swatch(0.5, 0, 0, 0.6, 0.3), swatch(0.4, 0.15, 280, 0.3, 0.65), swatch(0.6, 0.04, 95, 0.1, 0.95)];
    const b: Bins = { proportion: 0.38, waist: 0.38, top: lch(palette[0]), bottom: lch(palette[1]), palette, fit: null };
    agrees(show(b), "saturated note");
  });
});

