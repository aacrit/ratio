// "Try it" on the photo, without an image model: every pixel of a garment
// the look recolours is moved in OKLab from its swatch's measured colour to
// the target colour, keeping its own offset from that mean. Folds, shadows,
// weave and print stay the photo's own; only the garment's colour moves.
// Pure pixel arithmetic in the tab. Proportion moves (a tuck, a belt) are
// never painted onto the photo: that would mean inventing pixels, so they
// are shown on the chalk figure instead.

import { type Lab, oklabToSrgb, srgbToOklab } from "../engine/color";
import type { Move } from "../engine/looks";
import type { Swatch } from "../engine/palette";
import type { Pixels } from "../engine/resample";

const lchToLab = (L: number, C: number, h: number): Lab => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });

/** Which swatch each colour move targets, and the colour it moves to. */
export function colourTargets(moves: Move[], swatches: Swatch[]): Map<number, Lab> {
  const targets = new Map<number, Lab>();
  for (const m of moves) {
    if (m.kind === "recolour" && m.swatch < swatches.length) targets.set(m.swatch, lchToLab(m.L, m.C, m.h));
    if (m.kind === "accent") {
      // Accents show on the photo only when the shoes were measured.
      const shoes = swatches.findIndex((s) => s.y >= 0.9);
      if (shoes >= 0) targets.set(shoes, lchToLab(m.L, m.C, m.h));
    }
  }
  return targets;
}

/** True when a look changes anything that can honestly be shown on the photo. */
export const showsOnPhoto = (moves: Move[], swatches: Swatch[]) => colourTargets(moves, swatches).size > 0;

/**
 * A recoloured copy of the photo. Each moved pixel keeps its lightness offset
 * in full and its chroma offset scaled to the target's chroma, so a dark fold
 * stays a dark fold in the new colour.
 */
export function recolour(pixels: Pixels, owner: Int8Array, swatches: Swatch[], moves: Move[]): Pixels {
  const targets = colourTargets(moves, swatches);
  const data = new Uint8ClampedArray(pixels.data);
  if (!targets.size) return { width: pixels.width, height: pixels.height, data };
  for (let p = 0; p < owner.length; p++) {
    const k = owner[p];
    if (k < 0) continue;
    const to = targets.get(k);
    if (!to) continue;
    const from = swatches[k].lab;
    const i = p * 4;
    const px = srgbToOklab(data[i], data[i + 1], data[i + 2]);
    const fromC = Math.hypot(from.a, from.b);
    const toC = Math.hypot(to.a, to.b);
    // Texture in chroma scales with the new colour's strength; a neutral
    // target loses the old hue's tint entirely.
    const k2 = fromC > 0.01 ? Math.min(1.5, toC / fromC) : toC > 0.01 ? 1 : 0;
    const [r, g, b] = oklabToSrgb({
      L: Math.max(0, Math.min(1, to.L + (px.L - from.L))),
      a: to.a + (px.a - from.a) * k2,
      b: to.b + (px.b - from.b) * k2,
    });
    data[i] = r;
    data[i + 1] = g;
    data[i + 2] = b;
  }
  return { width: pixels.width, height: pixels.height, data };
}
