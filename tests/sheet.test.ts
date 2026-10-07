// The sheet's grip label and wheel-escalation decisions (web/src/ui/sheet.ts,
// T8, review round 1). Pure and DOM-free: the Sheet class itself is only
// ever driven by a real browser (scripts/screens.mjs), but the decisions a
// reviewer found wrong - a label that contradicted its own aria-expanded,
// and a wheel/trackpad scroll doing nothing below full, or acting on a
// pinch-zoom or a stray horizontal nudge - are plain functions of the snap
// state and the event, tested here without a DOM.

import { describe, expect, it } from "vitest";
import { gripLabel, type Snap, type WheelInput, wheelTarget } from "../web/src/ui/sheet";

const wheel = (over: Partial<WheelInput>): WheelInput => ({ deltaX: 0, deltaY: 0, deltaMode: 0, ctrlKey: false, ...over });

describe("gripLabel: one stable name, aria-expanded alone carries the state", () => {
  it("is false only at the fully collapsed peek", () => {
    expect(gripLabel("peek").expanded).toBe(false);
    expect(gripLabel("half").expanded).toBe(true);
    expect(gripLabel("full").expanded).toBe(true);
  });

  it("never pairs a changing label with aria-expanded (review round 1: 'Expand the reading fully' + true was still self-contradictory)", () => {
    const states: Snap[] = ["peek", "half", "full"];
    const labels = new Set(states.map((s) => gripLabel(s).label));
    expect(labels.size).toBe(1);
  });
});

describe("wheelTarget: a wheel or trackpad scroll reaches the same place a swipe up already does", () => {
  it("escalates to full from peek or half on a downward (content-seeking) pixel scroll past the jitter floor", () => {
    expect(wheelTarget("peek", wheel({ deltaY: 40 }))).toBe("full");
    expect(wheelTarget("half", wheel({ deltaY: 4 }))).toBe("full");
  });

  it("does nothing once full: the native scroll takes over there", () => {
    expect(wheelTarget("full", wheel({ deltaY: 40 }))).toBeNull();
  });

  it("does nothing on an upward scroll: there is nothing to collapse on a wheel", () => {
    expect(wheelTarget("half", wheel({ deltaY: -10 }))).toBeNull();
    expect(wheelTarget("peek", wheel({ deltaY: 0 }))).toBeNull();
  });

  it("ignores a pinch-to-zoom (ctrlKey set alongside the wheel, in every evergreen browser)", () => {
    expect(wheelTarget("half", wheel({ deltaY: 40, ctrlKey: true }))).toBeNull();
  });

  it("ignores a mostly-horizontal scroll", () => {
    expect(wheelTarget("half", wheel({ deltaX: 60, deltaY: 10 }))).toBeNull();
  });

  it("ignores a sub-pixel trackpad jitter below the floor, in pixel mode", () => {
    expect(wheelTarget("half", wheel({ deltaY: 1, deltaMode: 0 }))).toBeNull();
  });

  it("never applies the pixel floor to a line or page delta: a single notch always counts", () => {
    expect(wheelTarget("half", wheel({ deltaY: 1, deltaMode: 1 }))).toBe("full");
    expect(wheelTarget("half", wheel({ deltaY: 1, deltaMode: 2 }))).toBe("full");
  });
});
