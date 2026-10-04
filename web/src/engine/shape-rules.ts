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

/** A volume reading: either part may be missing on its own (an arm on the torso's edges, a leg out of sight). */
export interface Fit {
  top: number | null;
  legs: number | null;
}

/**
 * The words for a volume reading, from its numbers: the one place they are
 * made, so the line, its Measured copy and the Rulebook can never disagree
 * (Mara, 2026-10-04: "1.10× · 0.90×" said "fitted over wide").
 */
export function volumeWords(fit: Fit): { top: TopFit | null; legs: LegFit | null } {
  return { top: fit.top === null ? null : topFit(fit.top), legs: fit.legs === null ? null : legFit(fit.legs) };
}

export interface VolumeContext {
  /** The upper piece's width was read on one side only. */
  oneSide?: boolean;
  /** Why the upper piece's width was not read: an arm or a hand lay on its edges ("arms"); otherwise the rows held no width to read. */
  why?: "arms";
  /** The upper piece opens down the front, so it does not tuck. */
  front?: boolean;
}

const ONE_SIDE = " The upper piece's width was read on one side only, as an arm lay on the other, so take it as a nudge.";

export function volumeLine(fit: Fit, ctx: VolumeContext = {}): AdviceLine {
  const { top: t, legs: l } = volumeWords(fit);
  const n = (v: number | null) => (v === null ? "not read" : `${two(v)}×`);
  // Fit ratios are binned to 0.05; a width read on one side is always borderline.
  const borderline = (fit.top !== null && nearEdge(fit.top, FIT_TOP, 0.05)) || (fit.legs !== null && nearEdge(fit.legs, FIT_LEGS, 0.05)) || (!!ctx.oneSide && fit.top !== null);
  const base = { rule: "volume" as const, title: "Volume", measured: `${n(fit.top)} · ${n(fit.legs)}`, borderline };
  const side = ctx.oneSide && fit.top !== null ? ONE_SIDE : "";
  // One part alone is said, and the balance of the two is not judged.
  if (t === null || l === null) {
    const said = t !== null ? `The upper piece reads ${t} (${two(fit.top!)}× the shoulder width).` : `Each leg reads ${l} (${two(fit.legs!)}× the shoulder width at the knee).`;
    const missing = t !== null ? "The legs were not read" : ctx.why === "arms" ? "An arm or a hand lies over the upper piece's edges, so its width was not read" : "The upper piece's width could not be read on these rows";
    return { ...base, state: "neutral", text: `${said} ${missing}, and the balance of the two is not judged.${side}` };
  }
  const pair = `${t} over ${l}`;
  const cap = pair.charAt(0).toUpperCase() + pair.slice(1);
  if (t === "loose" && l !== "narrow") {
    const anchor = ctx.front ? "Keep one fitted: pair it with a narrower leg." : "Keep one fitted: if the upper piece tucks, a tuck does it; otherwise pair it with a narrower leg.";
    return { ...base, state: "advice", text: `${cap}: two full volumes, so the outfit has nothing to anchor it. ${anchor}${side}` };
  }
  if (t === "fitted" && l === "narrow") {
    return { ...base, state: "neutral", text: `${cap}: a streamlined column of fitted pieces. A single fuller piece, a wide leg or a looser layer, would add contrast if you want it.${side}` };
  }
  if ((t === "loose" && l === "narrow") || (t === "fitted" && l === "wide")) {
    return { ...base, state: "golden", text: `${cap}: one full volume balanced by one fitted, the classic pairing. Keep it.${side}` };
  }
  return { ...base, state: "neutral", text: `${cap}: moderate volumes that sit together quietly.${side}` };
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

/** The volume line when nothing could be read and an arm or a hand lay on the upper piece's edges on every row: said, never guessed. */
export function volumeUnread(_why: "arms"): AdviceLine {
  return {
    rule: "volume",
    title: "Volume",
    measured: "not read",
    state: "unread",
    borderline: false,
    text: "An arm or a hand lies over the upper piece's edges on every row Ratio reads it on, so its width was not read: a sleeve would have counted as the cut. A photo with the arms a little away from the sides lets Ratio read it.",
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
