// Which swatch is the upper piece, the lower piece and the shoes, by where
// its colour sits on the figure (head 0, feet 1) and how much area it holds.

export interface Placed {
  share: number;
  y: number;
}

export interface Pieces {
  upper: number;
  lower: number;
  shoes: number;
}

export function pieces(palette: readonly Placed[], waist: number): Pieces {
  const pick = (test: (s: Placed) => boolean) => {
    let best = -1;
    palette.forEach((s, i) => {
      if (test(s) && (best < 0 || s.share > palette[best].share)) best = i;
    });
    return best;
  };
  return {
    upper: pick((s) => s.y < waist),
    lower: pick((s) => s.y >= waist && s.y < 0.9),
    shoes: pick((s) => s.y >= 0.9),
  };
}
