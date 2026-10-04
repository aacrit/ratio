// "Try it" on the photo, without an image model: every pixel of a garment
// the look recolours is moved in OKLab from its swatch's measured colour to
// the target colour, keeping its own offset from that mean. Folds, shadows,
// weave and print stay the photo's own; only the garment's colour moves.
// Pure pixel arithmetic in the tab. Proportion moves (a tuck, a belt) are
// never painted onto the photo: that would mean inventing pixels, so they
// are shown on the chalk figure instead.
//
// Which pixels belong to a garment is decided by place AND colour: a garment
// pixel (segmenter category) inside that piece's band on the figure (the
// lower piece from the break to the ankle, the upper from the crown to the
// break, the shoes below the ankles) whose hue is close to the swatch's,
// at any lightness, so a fold in shadow is still the same cloth. Colour
// alone is not enough: a white waistcoat and white breeches share a swatch
// (found by the CI screenshots on David's Napoleon, 2026-10-04).

import { type Lab, deltaE, oklabToSrgb, srgbToOklab } from "../engine/color";
import type { Move } from "../engine/looks";
import { colourName } from "../engine/names";
import { CATEGORY, type Mask } from "../engine/measure";
import type { Swatch } from "../engine/palette";
import { type Piece, isShoes as isShoeSwatch } from "../engine/pieces";
import type { Pixels } from "../engine/resample";

const lchToLab = (L: number, C: number, h: number): Lab => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });

/** Rows [from, to] (pixel rows) where each piece's garment may be found. */
export type Bands = Record<Piece, readonly [number, number]>;

/** How far a pixel's hue plane (a, b) may sit from its swatch and still be that cloth, and how far its lightness. */
export const SAME_CLOTH = { ab: 0.06, L: 0.4 } as const;

interface Target {
  swatch: number;
  piece: Piece;
  to: Lab;
}

/** Which swatch and piece each colour move targets, and the colour it moves to. */
export function colourTargets(moves: Move[], swatches: Swatch[]): Target[] {
  const targets: Target[] = [];
  for (const m of moves) {
    if (m.kind === "recolour" && m.swatch < swatches.length) targets.push({ swatch: m.swatch, piece: m.piece, to: lchToLab(m.L, m.C, m.h) });
    if (m.kind === "accent") {
      // Accents show on the photo only when the shoes were measured: the
      // same shoe test as the rules (pieces.ts isShoes), so the leg line and
      // the photo never disagree about whether there are shoes.
      const shoes = swatches.findIndex(isShoeSwatch);
      if (shoes >= 0) targets.push({ swatch: shoes, piece: "shoes", to: lchToLab(m.L, m.C, m.h) });
    }
  }
  return targets;
}

/** True when a look changes anything that can be shown on the photo at all (see honesty for whether it should be). */
export const showsOnPhoto = (moves: Move[], swatches: Swatch[]) => colourTargets(moves, swatches).length > 0;

/**
 * When a recolour is honest enough to show on the photo. Each colour target
 * is measured at reading size over its piece's band:
 * - inside: of the pixels the recolour's colour test picks out in the whole
 *   photo's mask, the share on the read person. Below `inside`, the cloth it
 *   would paint is mostly someone else's (Noor, 2026-10-04).
 * - cover: of the read person's garment pixels in the piece's band, the
 *   share the recolour would move. Below `cover`, the change would show as a
 *   patch on a garment that stays its own colour. (Not for "other": an accent
 *   anywhere on the figure is small by nature.)
 * - area: the moved pixels against all the read person's garment pixels in
 *   the box's columns (padded as the palette's), every row. Below `area`,
 *   the change is too small to see.
 */
export const HONEST = { inside: 0.6, cover: 0.25, area: 0.01 } as const;

export interface Honesty {
  honest: boolean;
  targets: { piece: Piece; inside: number; cover: number; area: number }[];
}

const isGarment = (c: number) => c === CATEGORY.clothes || c === CATEGORY.other;
/** The colour test both the recolour and its honesty use: same cloth, at any reasonable lightness. */
const sameCloth = (px: Lab, from: Lab) => Math.hypot(px.a - from.a, px.b - from.b) <= SAME_CLOTH.ab && Math.abs(px.L - from.L) <= SAME_CLOTH.L;

/**
 * Whether a look's colour moves can be shown honestly on this photo. At
 * reading size: `full` is the segmenter's mask of everyone, `person` the read
 * person's (engine/person.ts); box and bands in reading-size pixels.
 */
export function honesty(pixels: Pixels, full: Mask, person: Mask, box: Box, bands: Bands, swatches: Swatch[], moves: Move[]): Honesty {
  const W = pixels.width;
  const pad = (box.right - box.left) * 0.35;
  const x0 = Math.max(0, Math.floor(box.left - pad)), x1 = Math.min(W - 1, Math.ceil(box.right + pad));
  let garment = 0;
  for (let y = 0; y < pixels.height; y++) for (let x = x0; x <= x1; x++) if (isGarment(person.data[y * W + x])) garment++;
  const targets = colourTargets(moves, swatches).map(({ swatch, piece }) => {
    const from = swatches[swatch].lab;
    const band = bands[piece];
    const y0 = Math.max(0, Math.floor(band[0])), y1 = Math.min(pixels.height - 1, Math.ceil(band[1]));
    let all = 0, own = 0, piecePx = 0;
    for (let y = y0; y <= y1; y++)
      for (let x = x0; x <= x1; x++) {
        const j = y * W + x;
        const mine = isGarment(person.data[j]);
        if (mine) piecePx++;
        if (!isGarment(full.data[j]) && !mine) continue;
        const i = j * 4;
        if (!sameCloth(srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]), from)) continue;
        all++;
        if (mine) own++;
      }
    return { piece, inside: all ? own / all : 0, cover: piecePx ? own / piecePx : 0, area: garment ? own / garment : 0 };
  });
  const honest = targets.length > 0 && targets.every((t) => t.inside >= HONEST.inside && t.area >= HONEST.area && (t.piece === "other" || t.cover >= HONEST.cover));
  return { honest, targets };
}

/** Why a colour move stays on the chalk figure: nothing on the photo to move, a doubtful recolour, or the check could not run (no judgement). */
export type Refusal = "no_target" | "doubtful" | "failed";

/** Which of a look's moves the photo shows (indices into the moves) and which only the chalk figure shows. */
export interface PhotoPlan {
  paint: number[];
  refused: { i: number; reason: Refusal }[];
}

/**
 * Honesty per move, not per look: every colour move that passes HONEST is
 * painted; a move with nothing on the photo to move (shoes in a new colour
 * when no shoes were measured) or a doubtful one stays on the chalk figure.
 * Proportion moves are never painted and never refused (the figure shows them).
 */
export function photoPlan(pixels: Pixels, full: Mask, person: Mask, box: Box, bands: Bands, swatches: Swatch[], moves: Move[]): PhotoPlan {
  const plan: PhotoPlan = { paint: [], refused: [] };
  moves.forEach((m, i) => {
    if (m.kind === "break") return;
    if (!colourTargets([m], swatches).length) plan.refused.push({ i, reason: "no_target" });
    else if (honesty(pixels, full, person, box, bands, swatches, [m]).honest) plan.paint.push(i);
    else plan.refused.push({ i, reason: "doubtful" });
  });
  return plan;
}

/** Every colour move refused because the check itself could not run: not a judgement on the photo. */
export const refuseAll = (moves: Move[]): PhotoPlan => ({ paint: [], refused: moves.flatMap((m, i) => (m.kind === "break" ? [] : [{ i, reason: "failed" as const }])) });

/** The swatches of a plan's refused moves, for recolour's `avoid`. */
export const refusedSwatches = (moves: Move[], plan: PhotoPlan, swatches: Swatch[]): number[] =>
  plan.refused.flatMap((x) => colourTargets([moves[x.i]], swatches).map((t) => t.swatch));

/** The neutral line when the check could not run. */
export const CHECK_FAILED = "The look is shown on the chalk figure only.";

const isShoes = (m: Move) => m.kind === "accent" || (m.kind === "recolour" && m.piece === "shoes");

/** A colour move as a part of the look: "the oxblood shoes", "the lower piece in black". */
function partName(m: Move): string {
  if (m.kind === "break") return "";
  const name = colourName(m.L, m.C, m.h);
  if (isShoes(m)) return `the ${name} shoes`;
  if (m.kind === "recolour" && m.piece !== "other") return `the ${m.piece} piece in ${name}`;
  return `the ${name} accent`;
}

const listed = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
/** "The oxblood shoes are", "The lower piece in black is". */
const subject = (ms: Move[]) => `${cap(listed(ms.map(partName)))} ${ms.length > 1 || isShoes(ms[0]) ? "are" : "is"}`;

/** The trying panel's line when some or all of a look's colour moves are on the chalk figure only; null when none are. */
export function refusedCopy(moves: Move[], plan: PhotoPlan): string | null {
  if (plan.refused.some((x) => x.reason === "failed")) return CHECK_FAILED;
  const of = (r: Refusal) => plan.refused.filter((x) => x.reason === r).map((x) => moves[x.i]);
  const parts: string[] = [];
  const none = of("no_target");
  if (none.length) parts.push(`${subject(none)} shown on the chalk figure only; this photo has no ${none.every(isShoes) ? "shoes" : "such piece"} Ratio could measure.`);
  const doubtful = of("doubtful");
  if (doubtful.length) parts.push(`${subject(doubtful)} shown on the chalk figure only; ${doubtful.length > 1 || isShoes(doubtful[0]) ? "they" : "it"} can't be shown honestly on this photo.`);
  return parts.length ? parts.join(" ") : null;
}

/** The saved card's line for the same look; null when the photo shows every colour move. */
export function refusedCardCopy(moves: Move[], plan: PhotoPlan): string | null {
  if (!plan.refused.length) return null;
  if (!plan.paint.length) return "Shows the photo as worn; this look is drawn on the chalk figure.";
  return `${subject(plan.refused.map((x) => moves[x.i]))} drawn on the chalk figure only.`;
}

/** The box around the figure that pixels are taken from, as the palette was measured. */
export interface Box {
  left: number;
  right: number;
}

/**
 * A recoloured copy of the photo. The mask is the read person's only
 * (engine/person.ts), so no one else's pixels can change. Each moved pixel keeps its lightness offset
 * in full and its chroma offset scaled to the target's chroma, so a dark fold
 * stays a dark fold in the new colour. `avoid` lists the swatches of moves
 * refused on the photo: a pixel nearer to one of them than to the target's
 * own swatch is that piece's cloth, so a passing move (an accent on the
 * shoes) never repaints a refused piece.
 */
export function recolour(pixels: Pixels, mask: Mask, box: Box, bands: Bands, swatches: Swatch[], moves: Move[], avoid: readonly number[] = []): Pixels {
  const targets = colourTargets(moves, swatches);
  const data = new Uint8ClampedArray(pixels.data);
  if (!targets.length) return { width: pixels.width, height: pixels.height, data };
  // The photo may be larger than the mask (the display size against the
  // reading size): the mask is sampled nearest-neighbour. Box and bands are
  // in the photo's own pixels.
  const W = pixels.width;
  const mw = mask.width, mh = mask.height;
  const sx = mw / pixels.width, sy = mh / pixels.height;
  const pad = (box.right - box.left) * 0.35;
  const x0 = Math.max(0, Math.floor(box.left - pad)), x1 = Math.min(W - 1, Math.ceil(box.right + pad));
  for (const { swatch, piece, to } of targets) {
    const from = swatches[swatch].lab;
    const band = bands[piece];
    const y0 = Math.max(0, Math.floor(band[0])), y1 = Math.min(pixels.height - 1, Math.ceil(band[1]));
    const fromC = Math.hypot(from.a, from.b);
    const toC = Math.hypot(to.a, to.b);
    // Texture in chroma scales with the new colour's strength; a neutral
    // target loses the old hue's tint entirely.
    const k2 = fromC > 0.01 ? Math.min(1.5, toC / fromC) : toC > 0.01 ? 1 : 0;
    for (let y = y0; y <= y1; y++) {
      const my = Math.min(mh - 1, Math.floor(y * sy)) * mw;
      for (let x = x0; x <= x1; x++) {
        if (!isGarment(mask.data[my + Math.min(mw - 1, Math.floor(x * sx))])) continue;
        const i = (y * W + x) * 4;
        // Read the original photo, never a pixel another move already changed.
        const px = srgbToOklab(pixels.data[i], pixels.data[i + 1], pixels.data[i + 2]);
        if (!sameCloth(px, from)) continue;
        if (avoid.some((j) => j !== swatch && j < swatches.length && deltaE(px, swatches[j].lab) < deltaE(px, from))) continue;
        const [r, g, b] = oklabToSrgb({
          L: Math.max(0, Math.min(1, to.L + (px.L - from.L))),
          a: to.a + (px.a - from.a) * k2,
          b: to.b + (px.b - from.b) * k2,
        });
        data[i] = r;
        data[i + 1] = g;
        data[i + 2] = b;
      }
    }
  }
  return { width: pixels.width, height: pixels.height, data };
}
