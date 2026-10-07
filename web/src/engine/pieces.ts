// Which swatch is the upper piece, the lower piece and the shoes. The upper
// and lower pieces are the swatches nearest the garment colours the measure
// read directly (the torso column and the leg column); position only breaks
// ties and serves when no measured colour is given. One swatch can be both
// pieces (a white waistcoat over white breeches): looks.ts then splits it
// when only one piece changes. The shoes are the largest swatch at the feet.

import { hueGap } from "./color";
import { isNeutral } from "./constants";

/** The shoes' place on the figure, head (0) to feet (1): the shoe swatch sits here or lower, and no other swatch does (palette.ts). */
export const SHOES_Y = 0.9;

export interface Placed {
  L: number;
  C: number;
  h: number;
  share: number;
  y: number;
}

export interface Pieces {
  upper: number;
  lower: number;
  shoes: number;
}

export type Piece = "upper" | "lower" | "shoes" | "other";

type Lch = { L: number; C: number; h: number };

const toLab = ({ L, C, h }: Lch) => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });
const gap = (p: Lch, q: Lch) => {
  const x = toLab(p), y = toLab(q);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

/** A measured colour and a swatch are the same kind when both are neutrals, or both colours within this many degrees of hue. */
export const SAME_KIND_HUE = 45;
const sameKind = (s: Lch, near: Lch) => (isNeutral(s) ? isNeutral(near) : !isNeutral(near) && hueGap(s.h, near.h) <= SAME_KIND_HUE);

/** The shoes: the swatch read from the boxes round the feet (measure.ts), placed at the feet. The one shoe detection the rules, the looks and "try it" share. */
export const isShoes = (s: { y: number; share: number }) => s.share > 0 && s.y >= SHOES_Y;

export function pieces(palette: readonly Placed[], waist: number, measured?: { top: Lch; bottom: Lch }): Pieces {
  const pick = (test: (s: Placed) => boolean, near?: Lch) => {
    // A piece measured as a colour is matched among swatches of that colour
    // first (plum trousers to the plum swatch, never to a charcoal of about
    // the same lightness); a neutral among neutrals. Any swatch when none is.
    const kind = near ? palette.some((s) => s.share > 0 && test(s) && sameKind(s, near)) : false;
    let best = -1;
    palette.forEach((s, i) => {
      // A speck the share binning took to zero is no piece (never the shoes).
      if (s.share <= 0 || !test(s)) return;
      if (kind && near && !sameKind(s, near)) return;
      if (best < 0) return void (best = i);
      const b = palette[best];
      if (near) {
        const d = gap(s, near) - gap(b, near);
        if (d < -1e-9 || (Math.abs(d) <= 1e-9 && s.share > b.share)) best = i;
      } else if (s.share > b.share) best = i;
    });
    return best;
  };
  const body = (s: Placed) => s.y < SHOES_Y;
  return {
    upper: measured ? pick(body, measured.top) : pick((s) => s.y < waist),
    lower: measured ? pick(body, measured.bottom) : pick((s) => s.y >= waist && s.y < SHOES_Y),
    shoes: pick(isShoes),
  };
}

/** A garment a line of advice can ask to change (AdviceLine.asks). */
export type Garment = Exclude<Piece, "other">;

/** What a swatch is to the outfit, preferring the lower piece when one swatch is both. */
export function pieceOf(i: number, p: Pieces): Piece {
  return i === p.lower ? "lower" : i === p.upper ? "upper" : i === p.shoes ? "shoes" : "other";
}

/** An accent: a colour (not a neutral) of at most this share of the outfit. */
export const ACCENT_SHARE = 0.15;
/** From this chroma a colour's hue is clear enough to count as an accent, or for its complement to mean something. */
export const CLEAR_HUE = 0.05;

/**
 * The outfit's accent: the most chromatic colour (clear of the neutral line)
 * holding at most ACCENT_SHARE of it, or -1. The rules read it (the leg line
 * and the value advice never ask to change accent shoes, T6) and the looks
 * keep it as worn.
 */
export function accentOf(palette: readonly Placed[]): number {
  let best = -1;
  palette.forEach((s, i) => {
    if (s.share <= 0 || s.share > ACCENT_SHARE || isNeutral(s) || s.C < CLEAR_HUE) return;
    if (best < 0 || s.C > palette[best].C) best = i;
  });
  return best;
}
