// Compact mode's one-line headline (web/src/ui/headline.ts, T8, R-09: the
// verdict filled the fold at every width because Compact folded the rule
// rows but never it). Pure and DOM-free: it only ever reads the verdict
// word and the one change back out of the full sentence the engine wrote.

import { describe, expect, it } from "vitest";
import { suggestLooks } from "../web/src/engine/looks";
import { type Bins, type BinnedSwatch, readBins } from "../web/src/engine/rules";
import { verdictOf } from "../web/src/engine/verdict";
import { compactHeadline, compactHeadlineText } from "../web/src/ui/headline";

const sw = (L: number, C: number, h: number, share: number, y = 0.3): BinnedSwatch => ({ L, C, h, share, y });

/** A real verdict, from real engine readings (readBins, suggestLooks, verdictOf), not a hand-written string: review round 1 asked these invariants to hold over actual readings, not only over crafted examples. */
function realVerdict(bins: Bins): string {
  const lines = readBins(bins);
  const looks = suggestLooks(bins, lines);
  return verdictOf(lines, looks, bins);
}

/** A sample of real readings across proportion bands, fit combinations, shoes and a front opening - the same shape of variation tests/engine.test.ts's own garment-line check uses. */
function sampleReadings(): Bins[] {
  const base = (over: Partial<Bins>): Bins => ({
    proportion: 0.5,
    waist: 0.38,
    top: { L: 0.3, C: 0, h: 0 },
    bottom: { L: 0.5, C: 0.1, h: 150 },
    palette: [sw(0.3, 0, 0, 0.55, 0.3), sw(0.5, 0.1, 150, 0.35, 0.65), sw(0.7, 0.14, 35, 0.1, 0.95)],
    fit: { top: 1.5, legs: 0.7 },
    ...over,
  });
  const out: Bins[] = [];
  for (const proportion of [null, 0.25, 0.35, 0.38, 0.44, 0.5, 0.6, 0.7, 0.85])
    for (const fit of [null, { top: 1.0, legs: 0.3 }, { top: 1.5, legs: null }, { top: null, legs: 0.4 }, { top: 1.7, legs: 0.9 }])
      for (const shoesL of [0.3, 0.5, 0.9])
        for (const front of [undefined, true as const])
          out.push(base({ proportion, fit, ...(front ? { front } : {}), palette: [sw(0.3, 0, 0, 0.55, 0.3), sw(0.5, 0.1, 150, 0.35, 0.65), sw(shoesL, shoesL > 0.6 ? 0.14 : 0, 35, 0.1, 0.95)] }));
  return out;
}

describe("compactHeadline", () => {
  it("is empty before any read", () => {
    expect(compactHeadline("")).toEqual({ verdict: "", change: null, optional: false, trying: false });
    expect(compactHeadlineText("")).toBe("");
  });

  it("pulls the verdict word and the looked-at change out of a plain 'Works.' sentence", () => {
    const full = "Works. The proportions are strong. Try navy trousers and oxblood shoes.";
    expect(compactHeadline(full)).toEqual({ verdict: "Works", change: "navy trousers and oxblood shoes", optional: false, trying: false });
    expect(compactHeadlineText(full)).toBe("Works · navy trousers and oxblood shoes");
  });

  it("still reads as 'Works' when the opening names one change worth making", () => {
    const full = "Works, with one change worth making. The upper piece covers most of the figure. Keep the balance of volumes. The change: a shorter upper piece, ending near the waist.";
    expect(compactHeadline(full).verdict).toBe("Works");
    expect(compactHeadline(full).change).toBe("a shorter upper piece, ending near the waist");
    expect(compactHeadlineText(full)).toBe("Works · a shorter upper piece, ending near the waist");
  });

  it("names the count when more than one change would help", () => {
    const full = "Two changes would help. The upper piece covers most of the figure. The change: a narrower leg.";
    expect(compactHeadline(full).verdict).toBe("Two changes would help");
    expect(compactHeadline(full).change).toBe("a narrower leg");
  });

  it("marks 'For one more note, try' optional, and reads differently from a needed change (review round 1)", () => {
    const full = "Works. The hues share one classic scheme. Keep the hues as they are. For one more note, try navy for the lower piece.";
    const needed = "Works. The proportions are strong. Try navy for the lower piece.";
    expect(compactHeadline(full).optional).toBe(true);
    expect(compactHeadline(full).change).toBe("navy for the lower piece");
    expect(compactHeadline(needed).optional).toBe(false);
    expect(compactHeadlineText(full)).toBe("Works · or try navy for the lower piece");
    expect(compactHeadlineText(needed)).toBe("Works · navy for the lower piece");
    expect(compactHeadlineText(full)).not.toBe(compactHeadlineText(needed));
  });

  it("names no change when the verdict only says what to keep", () => {
    const full = "Works. The hues share one classic scheme. Keep the hues as they are.";
    expect(compactHeadline(full)).toEqual({ verdict: "Works", change: null, optional: false, trying: false });
    expect(compactHeadlineText(full)).toBe("Works");
  });

  it("names no change for 'Keep it as it is.'", () => {
    const full = "Works. One colour among neutrals, the most forgiving scheme. Keep it as it is.";
    expect(compactHeadline(full).change).toBeNull();
  });

  it("reads the verdict from under a 'Trying <look>: ' prefix, and keeps that fact in `trying` and the one-line text", () => {
    const full = "Trying navy for the lower piece and oxblood shoes: Works. The hues share one classic scheme. Try navy for the lower piece and oxblood shoes.";
    const h = compactHeadline(full);
    expect(h.verdict).toBe("Works");
    expect(h.trying).toBe(true);
    expect(compactHeadlineText(full)).toBe("Trying · Works · navy for the lower piece and oxblood shoes");
  });

  it("never fabricates a change: the compact line only ever repeats words already in the full sentence", () => {
    const full = "Works. The proportions are strong. Try navy trousers and oxblood shoes.";
    const { change } = compactHeadline(full);
    expect(change && full.includes(change)).toBe(true);
  });
});

describe("compactHeadline over real verdicts (sampleReadings, read by the real engine)", () => {
  const bins = sampleReadings();
  const readings = bins.map((b) => ({ bins: b, lines: readBins(b), verdict: realVerdict(b) }));

  it("samples more than one hundred distinct real readings (the variation is real, not one case repeated)", () => {
    expect(readings.length).toBeGreaterThan(100);
    expect(new Set(readings.map((r) => r.verdict)).size).toBeGreaterThan(10);
  });

  it("the verdict is always the full sentence's own opening", () => {
    for (const r of readings) {
      const { verdict, trying } = compactHeadline(r.verdict);
      expect(trying).toBe(false); // none of these verdicts carries a "Trying ...: " prefix
      expect(r.verdict.startsWith(verdict)).toBe(true);
    }
  });

  it("the change, when named, is a suffix of the verdict's last sentence", () => {
    for (const r of readings) {
      const { change } = compactHeadline(r.verdict);
      if (change === null) continue;
      expect(r.verdict.endsWith(`${change}.`)).toBe(true);
    }
  });

  it("the change is never null when the reading has advice to give", () => {
    for (const r of readings) {
      if (!r.lines.some((l) => l.state === "advice")) continue;
      const { change } = compactHeadline(r.verdict);
      expect(change).not.toBeNull();
    }
  });
});
