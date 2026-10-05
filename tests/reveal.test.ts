// The read reveal's two laws (web/src/ui/reveal.ts, T3 R-09): a numeral
// never shows a value that was not measured (it appears once, at rest, never
// interpolated), and only the first read of a session gets the full
// plumb/chalk/count signature. web/src/overlay.ts's Figure.play is the
// canvas-drawing, DOM-bound caller that cannot be unit tested directly; it
// delegates both decisions to these two pure functions, which is what makes
// them testable at all.

import { describe, expect, it } from "vitest";
import { labelAtRest, revealKind } from "../web/src/ui/reveal";

describe("labelAtRest (what Figure.play's tape label is allowed to show)", () => {
  it("withholds the value until the motion has arrived", () => {
    expect(labelAtRest(false, 0.46)).toBeNull();
    expect(labelAtRest(false, 0)).toBeNull();
  });

  it("shows the true value once, exactly, at rest", () => {
    expect(labelAtRest(true, 0.46)).toBe(0.46);
  });
});

describe("revealKind", () => {
  it("is the full signature for the first read of a session", () => {
    expect(revealKind(true, false)).toBe("signature");
  });

  it("is a quick settle for every later read", () => {
    expect(revealKind(false, false)).toBe("settle");
  });

  it("is always a settle under reduced motion, even on the first read", () => {
    expect(revealKind(true, true)).toBe("settle");
  });
});
