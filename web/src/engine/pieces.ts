// Which swatch is the upper piece, the lower piece and the shoes. The upper
// and lower pieces are the swatches nearest the garment colours the measure
// read directly (the torso column and the leg column); position only breaks
// ties and serves when no measured colour is given. One swatch can be both
// pieces (a white waistcoat over white breeches): looks.ts then splits it
// when only one piece changes. The shoes are the largest swatch at the feet.

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

export function pieces(palette: readonly Placed[], waist: number, measured?: { top: Lch; bottom: Lch }): Pieces {
  const pick = (test: (s: Placed) => boolean, near?: Lch) => {
    let best = -1;
    palette.forEach((s, i) => {
      // A speck the share binning took to zero is no piece (never the shoes).
      if (s.share <= 0 || !test(s)) return;
      if (best < 0) return void (best = i);
      const b = palette[best];
      if (near) {
        const d = gap(s, near) - gap(b, near);
        if (d < -1e-9 || (Math.abs(d) <= 1e-9 && s.share > b.share)) best = i;
      } else if (s.share > b.share) best = i;
    });
    return best;
  };
  const body = (s: Placed) => s.y < 0.9;
  return {
    upper: measured ? pick(body, measured.top) : pick((s) => s.y < waist),
    lower: measured ? pick(body, measured.bottom) : pick((s) => s.y >= waist && s.y < 0.9),
    shoes: pick((s) => s.y >= 0.9),
  };
}
