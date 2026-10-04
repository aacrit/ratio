// Volume and leg line: states by band, borderline at the edges, garment words
// only. And the rulebook covers every rule the engine can say.

import { describe, expect, it } from "vitest";
import { FIT_LEGS, FIT_TOP, nearEdge } from "../web/src/engine/constants";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { JUDGING_WORDS, readBins, type Bins } from "../web/src/engine/rules";
import { legFit, legLine, topFit, volumeLine } from "../web/src/engine/shape-rules";

describe("volume balance", () => {
  it("classifies the upper piece and the legs by fabric width", () => {
    expect(topFit(1.0)).toBe("fitted");
    expect(topFit(1.3)).toBe("straight");
    expect(topFit(1.6)).toBe("loose");
    // Each leg on its own (0.7.0): skinny trousers measure about 0.42 a leg.
    expect(legFit(0.42)).toBe("narrow");
    expect(legFit(0.5)).toBe("straight");
    expect(legFit(0.7)).toBe("wide");
  });

  it("advises on loose over straight (the founder's example) and keeps a classic pairing", () => {
    expect(volumeLine({ top: 1.6, legs: 0.5 })).toMatchObject({ state: "advice" });
    expect(volumeLine({ top: 1.6, legs: 0.5 }).text).toMatch(/^Loose over straight/);
    expect(volumeLine({ top: 1.6, legs: 0.4 }).state).toBe("golden");
    expect(volumeLine({ top: 1.0, legs: 0.7 }).state).toBe("golden");
    expect(volumeLine({ top: 1.0, legs: 0.4 }).state).toBe("neutral");
  });

  it("marks a reading at a band edge as borderline", () => {
    expect(volumeLine({ top: FIT_TOP[1], legs: 0.52 }).borderline).toBe(true);
    expect(volumeLine({ top: 1.3, legs: FIT_LEGS[0] }).borderline).toBe(true);
    expect(volumeLine({ top: 1.3, legs: 0.52 }).borderline).toBe(false);
  });
});

describe("leg line", () => {
  it("reads shoes close in value as a continuous line", () => {
    expect(legLine(0.3, 0.32).state).toBe("golden");
    expect(legLine(0.3, 0.9).state).toBe("neutral");
  });
});

describe("nearEdge", () => {
  it("is true within half a bin of an edge", () => {
    expect(nearEdge(0.15, [0.15], 0.02)).toBe(true);
    expect(nearEdge(0.16, [0.15], 0.02)).toBe(true);
    expect(nearEdge(0.18, [0.15], 0.02)).toBe(false);
  });
});

describe("rulebook", () => {
  it("has an entry, a rule and a source for every rule the engine can produce", () => {
    const bins: Bins = {
      proportion: 0.5,
      waist: 0.38,
      top: { L: 0.8, C: 0.05, h: 80 },
      bottom: { L: 0.4, C: 0.1, h: 150 },
      palette: [
        { L: 0.8, C: 0.05, h: 80, share: 0.5, y: 0.3 },
        { L: 0.4, C: 0.1, h: 150, share: 0.4, y: 0.65 },
        { L: 0.9, C: 0, h: 0, share: 0.1, y: 0.95 },
      ],
      fit: { top: 1.6, legs: 0.7 },
    };
    const lines = readBins(bins);
    expect(lines).toHaveLength(7);
    for (const l of lines) {
      const entry = RULEBOOK[l.rule];
      expect(entry, l.rule).toBeDefined();
      expect(entry.rule.length).toBeGreaterThan(20);
      expect(entry.sources.length).toBeGreaterThan(0);
      for (const word of JUDGING_WORDS) expect(`${l.text} ${entry.rule}`.toLowerCase()).not.toContain(word);
    }
  });
});

describe("user-sim fixes (2026-10-04)", () => {
  it("a light, barely tinted colour is a neutral; a dark one at the same chroma is not", async () => {
    const { isNeutral } = await import("../web/src/engine/constants");
    expect(isNeutral({ L: 0.74, C: 0.03 })).toBe(true);
    expect(isNeutral({ L: 0.23, C: 0.026 })).toBe(false);
  });

  it("a third reads as composed, as the rule says", async () => {
    const lines = readBins({ proportion: 0.32, waist: 0.38, top: { L: 0.8, C: 0, h: 0 }, bottom: { L: 0.3, C: 0, h: 0 }, palette: [], fit: null });
    expect(lines[0].state).toBe("golden");
    expect(lines[0].text).toMatch(/a third/);
  });

  it("two colours tied for the lead are advice, not fine", async () => {
    const { sharesLine } = await import("../web/src/engine/colour-rules");
    const sw = (share: number) => ({ L: 0.5, C: 0, h: 0, share, y: 0.5 });
    expect(sharesLine([sw(0.25), sw(0.25), sw(0.2), sw(0.15), sw(0.15)]).state).toBe("advice");
  });

  it("the plain verdict counts the advice and names the best look in everyday words", async () => {
    const { verdictOf, plainMove } = await import("../web/src/engine/verdict");
    expect(plainMove({ kind: "recolour", swatch: 1, piece: "lower", L: 0.3, C: 0.07, h: 255, title: "", detail: "" })).toBe("navy for the lower piece");
    expect(plainMove({ kind: "accent", L: 0.36, C: 0.11, h: 25, title: "", detail: "" })).toBe("oxblood shoes");
    const advice = { rule: "shares" as const, title: "", measured: "", text: "", state: "advice" as const, borderline: false };
    const fine = { ...advice, state: "neutral" as const };
    expect(verdictOf([fine], [])).toMatch(/^Works\. /);
    expect(verdictOf([advice], [])).toBe("Works, with one change worth making. Two colours share the outfit almost equally, so none leads. The change: one colour taking the lead, near 0.60 of the outfit.");
    expect(verdictOf([advice, advice], [])).toMatch(/^Two changes would help/);
    for (const v of [verdictOf([fine], []), verdictOf([advice, advice, advice], [])]) for (const w of JUDGING_WORDS) expect(v.toLowerCase()).not.toContain(w);
  });
});
