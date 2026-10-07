// Compact mode's one-line headline (web/src/ui/headline.ts, T8, R-09: the
// verdict filled the fold at every width because Compact folded the rule
// rows but never it). Pure and DOM-free: it only ever reads the verdict
// word and the one change back out of the full sentence the engine wrote.

import { describe, expect, it } from "vitest";
import { compactHeadline, compactHeadlineText } from "../web/src/ui/headline";

describe("compactHeadline", () => {
  it("is empty before any read", () => {
    expect(compactHeadline("")).toEqual({ verdict: "", change: null });
    expect(compactHeadlineText("")).toBe("");
  });

  it("pulls the verdict word and the looked-at change out of a plain 'Works.' sentence", () => {
    const full = "Works. The proportions are strong. Try navy trousers and oxblood shoes.";
    expect(compactHeadline(full)).toEqual({ verdict: "Works", change: "navy trousers and oxblood shoes" });
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

  it("reads 'For one more note, try' as a change too", () => {
    const full = "Works. The hues share one classic scheme. Keep the hues as they are. For one more note, try navy for the lower piece.";
    expect(compactHeadline(full).change).toBe("navy for the lower piece");
  });

  it("names no change when the verdict only says what to keep", () => {
    const full = "Works. The hues share one classic scheme. Keep the hues as they are.";
    expect(compactHeadline(full)).toEqual({ verdict: "Works", change: null });
    expect(compactHeadlineText(full)).toBe("Works");
  });

  it("names no change for 'Keep it as it is.'", () => {
    const full = "Works. One colour among neutrals, the most forgiving scheme. Keep it as it is.";
    expect(compactHeadline(full).change).toBeNull();
  });

  it("reads the verdict from under a 'Trying <look>: ' prefix, never losing whether it works", () => {
    const full = "Trying navy for the lower piece and oxblood shoes: Works. The hues share one classic scheme. Try navy for the lower piece and oxblood shoes.";
    expect(compactHeadline(full).verdict).toBe("Works");
  });

  it("never fabricates a change: the compact line only ever repeats words already in the full sentence", () => {
    const full = "Works. The proportions are strong. Try navy trousers and oxblood shoes.";
    const { change } = compactHeadline(full);
    expect(change && full.includes(change)).toBe(true);
  });
});
