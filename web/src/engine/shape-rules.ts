// The shape rules: volume balance and the leg line. Like every rule they read
// only binned measurements and speak only of garments: "the upper piece is
// loose", never anything about the body under it.

import { FIT_LEGS, FIT_TOP, LEG_LINE_EDGE, nearEdge } from "./constants";
import type { ShoesWhy } from "./measure";
import type { AdviceLine } from "./rules";

export type TopFit = "fitted" | "straight" | "loose";
export type LegFit = "narrow" | "straight" | "wide";

export const topFit = (r: number): TopFit => (r < FIT_TOP[0] ? "fitted" : r < FIT_TOP[1] ? "straight" : "loose");
export const legFit = (r: number): LegFit => (r < FIT_LEGS[0] ? "narrow" : r < FIT_LEGS[1] ? "straight" : "wide");

const two = (v: number) => v.toFixed(2);

/**
 * The words for a volume reading, from its numbers: the one place they are
 * made, so the line, its Measured copy and the Rulebook can never disagree
 * (Mara, 2026-10-04: "1.10× · 0.90×" said "fitted over wide").
 */
export function volumeWords(fit: { top: number; legs: number }): { top: TopFit; legs: LegFit } {
  return { top: topFit(fit.top), legs: legFit(fit.legs) };
}

export function volumeLine(fit: { top: number; legs: number }): AdviceLine {
  const { top: t, legs: l } = volumeWords(fit);
  // Fit ratios are binned to 0.05.
  const borderline = nearEdge(fit.top, FIT_TOP, 0.05) || nearEdge(fit.legs, FIT_LEGS, 0.05);
  const base = { rule: "volume" as const, title: "Volume", measured: `${two(fit.top)}× · ${two(fit.legs)}×`, borderline };
  const pair = `${t} over ${l}`;
  const cap = pair.charAt(0).toUpperCase() + pair.slice(1);
  if (t === "loose" && l !== "narrow") {
    return { ...base, state: "advice", text: `${cap}: two full volumes, so the outfit has nothing to anchor it. Keep one fitted: tuck the upper piece, or pair it with a narrower leg.` };
  }
  if (t === "fitted" && l === "narrow") {
    return { ...base, state: "neutral", text: `${cap}: a streamlined column of fitted pieces. A single fuller piece, a wide leg or a looser layer, would add contrast if you want it.` };
  }
  if ((t === "loose" && l === "narrow") || (t === "fitted" && l === "wide")) {
    return { ...base, state: "golden", text: `${cap}: one full volume balanced by one fitted, the classic pairing. Keep it.` };
  }
  return { ...base, state: "neutral", text: `${cap}: moderate volumes that sit together quietly.` };
}

export function legLine(lowerL: number, shoesL: number): AdviceLine {
  const gap = Math.abs(lowerL - shoesL);
  // Lightness bins are 0.02; a difference of two bins can move by one.
  const base = { rule: "legline" as const, title: "Leg line", measured: `ΔL ${two(gap)}`, borderline: nearEdge(gap, [LEG_LINE_EDGE], 0.04) };
  if (gap < LEG_LINE_EDGE) {
    return { ...base, state: "golden", text: `The shoes sit close in value to the lower piece (${two(lowerL)} and ${two(shoesL)}), so the leg line runs unbroken to the floor.` };
  }
  return { ...base, state: "neutral", text: `The shoes contrast with the lower piece (${two(lowerL)} and ${two(shoesL)}), so the leg line ends at the ankle and the shoes become a point of their own. Shoes nearer the lower piece's value would carry the line down.` };
}

/** The volume line when an arm or a hand crosses every torso row: said, never guessed. */
export function volumeUnread(_why: "arms"): AdviceLine {
  return {
    rule: "volume",
    title: "Volume",
    measured: "not read",
    state: "unread",
    borderline: false,
    text: "An arm or a hand lies over the upper piece on every row Ratio reads it on, so its width was not read: a sleeve would have counted as the cut. A photo with the arms a little away from the sides lets Ratio read it.",
  };
}

/** The leg line when the shoes could not be read, saying why. */
export function legUnread(why: ShoesWhy): AdviceLine {
  const text =
    why === "cut_off"
      ? "The shoes are cut off by the frame, so the leg line was not read. A photo with the feet in full lets Ratio read it."
      : "The shoes merge with the floor: Ratio could not tell where they begin, so the leg line was not read. A plainer floor or more light at the feet lets Ratio read it.";
  return { rule: "legline", title: "Leg line", measured: "not read", state: "unread", borderline: false, text };
}
