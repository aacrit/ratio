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

/**
 * The reference both widths are held against, said as a tailor says it:
 * "across the shoulders", the garment spec-sheet term (founder, 2026-10-07;
 * Mara, UX pass 4: "shoulder line" is the seam from the neck to the shoulder
 * point, not a width). The number is the span between the two shoulder
 * points the pose marks: it comes from the pose, not the cloth, so it holds
 * when the upper piece's own width is not read (Sam, UX pass 4). Every
 * volume ratio is followed by it, in the line and in its Measured copy.
 */
export const ACROSS_SHOULDERS = "across the shoulders";

const ONE_SIDE = "The upper piece's width was read on one side only, as an arm lay on the other, so take it as a nudge.";

export function volumeLine(fit: Fit, ctx: VolumeContext = {}): AdviceLine {
  const { top: t, legs: l } = volumeWords(fit);
  const n = (v: number | null) => (v === null ? "not read" : `${two(v)}×`);
  // Fit ratios are binned to 0.05; a width read on one side is always borderline.
  const borderline = (fit.top !== null && nearEdge(fit.top, FIT_TOP, 0.05)) || (fit.legs !== null && nearEdge(fit.legs, FIT_LEGS, 0.05)) || (!!ctx.oneSide && fit.top !== null);
  const base = { rule: "volume" as const, title: "Volume", measured: `${n(fit.top)} · ${n(fit.legs)}`, borderline };
  const side = ctx.oneSide && fit.top !== null ? ` ${ONE_SIDE}` : "";
  // One part alone is said, and the balance of the two is not judged: the
  // line is "unread" (shown "not judged"), never "fine" (Sam and Noor, UX
  // pass 3: "FINE · not read · 0.40×").
  if (t === null || l === null) {
    const said = t !== null ? `The upper piece reads ${t} (${two(fit.top!)}× ${ACROSS_SHOULDERS}).` : `The lower piece reads ${l} at the knee line (${two(fit.legs!)}× ${ACROSS_SHOULDERS}).`;
    const missing = t !== null ? "The lower piece's width was not read" : ctx.why === "arms" ? "An arm or a hand lies over the upper piece's edges, so its width was not read" : "The upper piece's width could not be read on these rows";
    return { ...base, state: "unread", text: `${said} ${missing}, and the balance of the two is not judged.${side}` };
  }
  const pair = `${t} over ${l}`;
  const cap = pair.charAt(0).toUpperCase() + pair.slice(1);
  if (t === "loose" && l !== "narrow") {
    const anchor = ctx.front ? "Keep one fitted: pair it with a narrower lower piece." : "Keep one fitted: if the upper piece tucks, a tuck does it; otherwise pair it with a narrower lower piece.";
    // A narrower lower piece is a cut change, not a recolour.
    return { ...base, state: "advice", text: `${cap}: two full volumes, so the outfit has nothing to anchor it. ${anchor}${side}` };
  }
  // A row that is fine or on the mark says one plain verdict, on its own
  // subject, and offers no fix; the one-side note follows it as a caveat
  // (Sam, UX pass 4; T9 review round 1: never a verdict, a hedge, a verdict).
  if (t === "fitted" && l === "narrow") {
    return { ...base, state: "neutral", text: `${cap}: a streamlined column of fitted pieces, a pair that works.${side}` };
  }
  if ((t === "loose" && l === "narrow") || (t === "fitted" && l === "wide")) {
    return { ...base, state: "golden", text: `${cap}: one full volume balanced by one fitted, the classic pairing: keep this pairing.${side}` };
  }
  return { ...base, state: "neutral", text: `${cap}: moderate volumes that sit together, a quiet balance that works.${side}` };
}

/** Whether the shoes continue the lower piece's line: the one predicate the leg line and the proportion line's shoe clause share. */
export const shoesContinue = (lowerL: number, shoesL: number): boolean => Math.abs(lowerL - shoesL) < LEG_LINE_EDGE;

/** Whether a lower-piece-to-shoes gap sits at the leg line's edge: lightness bins are 0.02, so a difference of two bins can move by one. */
export const legBorderline = (gap: number): boolean => nearEdge(gap, [LEG_LINE_EDGE], 0.04);

/**
 * The leg line. Contrasting shoes that are the outfit's accent are a choice
 * to keep, never one to change: the verdict keeps them, so this line must
 * not ask for other shoes (Noor, UX pass 3: "Keep the coral shoes" over a
 * row suggesting shoes nearer the lower piece's value).
 */
export function legLine(lowerL: number, shoesL: number, shoesAccent = false): AdviceLine {
  const gap = Math.abs(lowerL - shoesL);
  const base = { rule: "legline" as const, title: "Leg line", measured: `ΔL ${two(gap)}`, borderline: legBorderline(gap) };
  if (shoesContinue(lowerL, shoesL)) {
    return { ...base, state: "golden", text: `The shoes sit close in value to the lower piece (${two(lowerL)} and ${two(shoesL)}), so the leg line runs unbroken to the floor. Keep the shoes close in value.` };
  }
  // A fine row commits: the finding and its verdict, no hypothetical (T9 review round 1).
  const said = `The shoes contrast with the lower piece (${two(lowerL)} and ${two(shoesL)}), so the leg line stops at the shoes and they become a point of their own`;
  if (shoesAccent) return { ...base, state: "neutral", text: `${said}. They carry the outfit's accent, so the contrast is the point: keep the contrast.` };
  return { ...base, state: "neutral", text: `${said}: a contrast that holds.` };
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
