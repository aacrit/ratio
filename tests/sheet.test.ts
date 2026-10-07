// The sheet's grip label and wheel-escalation decisions (web/src/ui/sheet.ts,
// T8). Pure and DOM-free: the Sheet class itself is only ever driven by a
// real browser (scripts/screens.mjs), but the two decisions a reviewer
// found wrong - the grip's label not matching its own aria-expanded, and a
// wheel/trackpad scroll doing nothing below full - are plain functions of
// the snap state, tested here without a DOM.

import { describe, expect, it } from "vitest";
import { gripLabel, type Snap, wheelTarget } from "../web/src/ui/sheet";

describe("gripLabel: a distinct, truthful label for each of the three resting places", () => {
  it("peek: collapsed, not yet expanded", () => {
    expect(gripLabel("peek")).toEqual({ expanded: false, label: "Expand the reading" });
  });

  it("half: already open some, and says so - never the same text as peek (R-09: 'Expand the reading' at aria-expanded=true was the bug)", () => {
    const half = gripLabel("half");
    expect(half).toEqual({ expanded: true, label: "Expand the reading fully" });
    expect(half.label).not.toBe(gripLabel("peek").label);
  });

  it("full: offers to collapse, distinct from both other states", () => {
    const full = gripLabel("full");
    expect(full).toEqual({ expanded: true, label: "Collapse the reading" });
    expect(full.label).not.toBe(gripLabel("half").label);
  });

  it("every state's label is different from every other state's", () => {
    const states: Snap[] = ["peek", "half", "full"];
    const labels = states.map((s) => gripLabel(s).label);
    expect(new Set(labels).size).toBe(states.length);
  });
});

describe("wheelTarget: a wheel or trackpad scroll reaches the same place a swipe up already does", () => {
  it("escalates to full from peek or half on a downward (content-seeking) scroll", () => {
    expect(wheelTarget("peek", 40)).toBe("full");
    expect(wheelTarget("half", 1)).toBe("full");
  });

  it("does nothing once full: the native scroll takes over there", () => {
    expect(wheelTarget("full", 40)).toBeNull();
  });

  it("does nothing on an upward scroll: there is nothing to collapse on a wheel", () => {
    expect(wheelTarget("half", -10)).toBeNull();
    expect(wheelTarget("peek", 0)).toBeNull();
  });
});
