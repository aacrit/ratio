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
    expect(legFit(0.5)).toBe("slim");
    expect(legFit(0.7)).toBe("straight");
    expect(legFit(1.0)).toBe("wide");
  });

  it("advises on loose over straight (the founder's example) and keeps a classic pairing", () => {
    expect(volumeLine({ top: 1.6, legs: 0.7 })).toMatchObject({ state: "advice" });
    expect(volumeLine({ top: 1.6, legs: 0.7 }).text).toMatch(/^Loose over straight/);
    expect(volumeLine({ top: 1.6, legs: 0.5 }).state).toBe("golden");
    expect(volumeLine({ top: 1.0, legs: 1.0 }).state).toBe("golden");
    expect(volumeLine({ top: 1.0, legs: 0.5 }).state).toBe("neutral");
  });

  it("marks a reading at a band edge as borderline", () => {
    expect(volumeLine({ top: FIT_TOP[1], legs: 0.7 }).borderline).toBe(true);
    expect(volumeLine({ top: 1.3, legs: FIT_LEGS[0] }).borderline).toBe(true);
    expect(volumeLine({ top: 1.3, legs: 0.7 }).borderline).toBe(false);
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
