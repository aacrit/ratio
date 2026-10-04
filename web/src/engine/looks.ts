// Suggested looks. The engine suggests by trying a fixed set of moves on the
// measured outfit's bins (a tuck, a colour swap for one piece, a darker
// lower piece, an accent, a muted voice), re-reading each candidate with the
// whole rulebook (rules.ts readBins), and ranking by how much the reading
// improves. No model is involved: the rulebook judges its own suggestions,
// so a suggestion is exactly as explainable as a reading. Deterministic:
// candidates come in a fixed order and ties break by that order.
//
// Two laws:
// - Never fix one rule by breaking another: a look in which any line falls
//   from on the mark or fine to "advice" is dropped.
// - Only choices change: garment colour, tuck, belt, accent. Never the body.

import type { BinnedSwatch } from "./colour-rules";
import { colourName, familyOf } from "./names";
import { binShares, isNeutral } from "./constants";
import { type Piece, pieces as placedPieces } from "./pieces";
import { type AdviceLine, type Bins, type LineState, readBins } from "./rules";

export type Move =
  | { kind: "break"; to: number; title: string; detail: string }
  | { kind: "recolour"; swatch: number; piece: Piece; L: number; C: number; h: number; title: string; detail: string }
  | { kind: "accent"; L: number; C: number; h: number; title: string; detail: string };

export interface Look {
  /** Stable id from the moves, for the UI and the reading hash. */
  id: string;
  title: string;
  moves: Move[];
  bins: Bins;
  lines: AdviceLine[];
  gain: number;
  /** Lines whose state changed, before and after. */
  changes: { rule: AdviceLine["rule"]; title: string; from: LineState; to: LineState }[];
}

const SATURATED = 0.11;
/** From this chroma a lead colour's hue is clear enough for its complement to mean something. */
const CLEAR_HUE = 0.05;
/** Accents a tailor reaches for when the outfit has no clear lead hue: oxblood, cognac, navy. */
const CLASSIC_ACCENTS = [
  { L: 0.36, C: 0.11, h: 25 },
  { L: 0.5, C: 0.1, h: 60 },
  { L: 0.3, C: 0.07, h: 255 },
];
const fix = (v: number, d = 2) => Number(v.toFixed(d));
const wrap = (h: number) => ((Math.round(h / 5) * 5) % 360 + 360) % 360;

const SCORE: Record<LineState, number> = { golden: 2, neutral: 1, advice: 0 };
export const scoreOf = (lines: AdviceLine[]) => lines.reduce((s, l) => s + SCORE[l.state], 0);

/** The pieces of the outfit: the swatches nearest the measured upper and lower garment colours, and the shoes. */
export function pieces(b: Bins): { upper: number; lower: number; shoes: number } {
  return placedPieces(b.palette, b.waist, { top: b.top, bottom: b.bottom });
}

/** What a swatch is to the outfit, preferring the lower piece when one swatch is both. */
export function pieceOf(i: number, p: ReturnType<typeof pieces>): Piece {
  return i === p.lower ? "lower" : i === p.upper ? "upper" : i === p.shoes ? "shoes" : "other";
}

const lchToLab = ({ L, C, h }: { L: number; C: number; h: number }) => ({ L, a: C * Math.cos((h * Math.PI) / 180), b: C * Math.sin((h * Math.PI) / 180) });
const labGap = (p: BinnedSwatch, q: BinnedSwatch) => {
  const x = lchToLab(p), y = lchToLab(q);
  return Math.hypot(x.L - y.L, x.a - y.a, x.b - y.b);
};

/** Merges swatches that a recolour made near-identical, as the palette extractor would. */
export function normalise(b: Bins): Bins {
  const merged: BinnedSwatch[] = [];
  for (const s of [...b.palette].sort((p, q) => q.share - p.share)) {
    const into = merged.find((m) => labGap(m, s) < 0.06);
    if (into) {
      into.y = fix((into.y * into.share + s.y * s.share) / (into.share + s.share));
      into.share = fix(into.share + s.share);
    } else merged.push({ ...s });
  }
  // Shares by largest remainder, so a look's palette sums to exactly 1.00 too.
  const shares = binShares(merged.map((s) => s.share));
  return { ...b, palette: merged.map((s, i) => ({ ...s, share: shares[i] })).sort((p, q) => q.share - p.share) };
}

/**
 * Applies one move to the bins. Swatch indices stay those of the measured
 * palette (an accent is appended), so several moves compose and the photo
 * recolour can find each swatch's pixels; normalise() runs once after all.
 */
export function applyMove(b: Bins, m: Move): Bins {
  if (m.kind === "break") return { ...b, proportion: m.to };
  const palette = b.palette.map((s) => ({ ...s }));
  const colour = { L: m.L, C: m.C, h: isNeutral(m) ? 0 : m.h };
  if (m.kind === "recolour") {
    const { upper, lower } = pieces(b);
    const s = palette[m.swatch];
    // One swatch can be both pieces (white waistcoat, white breeches). Changing
    // one of them splits it: the changed part takes its share of the area.
    const shared = upper === lower && upper === m.swatch && (m.piece === "upper" || m.piece === "lower");
    if (shared) {
      const brk = b.proportion ?? b.waist;
      const f = m.piece === "lower" ? 1 - brk : brk;
      palette[m.swatch] = { ...s, share: fix(s.share * (1 - f)) };
      palette.push({ ...colour, share: fix(s.share * f), y: m.piece === "lower" ? 0.7 : 0.3 });
    } else palette[m.swatch] = { ...s, ...colour };
    const next = { ...b, palette };
    if (m.piece === "upper") next.top = colour;
    if (m.piece === "lower") next.bottom = colour;
    return next;
  }
  // An accent recolours the shoes when they were measured; otherwise it adds
  // one at the feet with a tenth of the area.
  const { shoes } = pieces(b);
  if (shoes >= 0) palette[shoes] = { ...palette[shoes], ...colour };
  else {
    for (const s of palette) s.share = fix(s.share * 0.9);
    palette.push({ ...colour, share: 0.1, y: 0.95 });
  }
  return { ...b, palette };
}

/** A colour's plain name, for titles and advice; the degrees live in the Measured lines. */
const plain = (c: { L: number; C: number; h: number }) => colourName(c.L, c.C, c.h);

const PIECE_NAME: Record<Piece, string> = { upper: "Upper piece", lower: "Lower piece", shoes: "Shoes", other: "Accent" };
const pieceName = (i: number, p: ReturnType<typeof pieces>) => PIECE_NAME[pieceOf(i, p)];

/** Every candidate move for these bins, in a fixed order. */
export function candidateMoves(b: Bins, lines: AdviceLine[]): Move[] {
  const moves: Move[] = [];
  const state = (rule: AdviceLine["rule"]) => lines.find((l) => l.rule === rule)?.state;
  const p = pieces(b);
  const chromatic = b.palette.filter((s) => !isNeutral(s));
  const lead = chromatic[0];

  // Proportion: move the break to the waist.
  if (b.proportion !== null && state("proportion") === "advice") {
    const tuck = b.proportion < 0.66;
    moves.push({
      kind: "break",
      to: b.waist,
      title: tuck ? "Tuck the front" : "Belt at the waist",
      detail: tuck ? "A front tuck moves the break up to the waist." : "A belt draws a break at the waist.",
    });
  }

  // Colour: the lower piece (the commonest question) and any piece that
  // sits outside the harmony, in hues that complete the scheme or a neutral.
  const recolourTargets = new Set<number>();
  if (p.lower >= 0) recolourTargets.add(p.lower);
  if (state("harmony") === "advice") chromatic.forEach((s) => recolourTargets.add(b.palette.indexOf(s)));
  for (const i of recolourTargets) {
    const s = b.palette[i];
    const anchor = b.palette.find((x, j) => j !== i && !isNeutral(x)) ?? lead;
    const options: { L: number; C: number; h: number }[] = [];
    if (anchor && anchor !== s) {
      const C = Math.max(0.06, Math.min(0.12, s.C || 0.08));
      for (const turn of [0, 30, -30, 180, 150, -150]) options.push({ L: s.L, C, h: wrap(anchor.h + turn) });
    }
    // Neutrals at the piece's own lightness, and a deep neutral.
    options.push({ L: s.L, C: 0, h: 0 }, { L: 0.2, C: 0, h: 0 });
    // Navy and denim: the two blues most wardrobes already have.
    options.push({ L: 0.3, C: 0.07, h: 255 }, { L: 0.45, C: 0.06, h: 250 });
    for (const o of options) {
      if (labGap(s, { ...o, share: 0, y: 0 }) < 0.06) continue;
      const label = plain(o);
      moves.push({ kind: "recolour", swatch: i, piece: pieceOf(i, p), ...o, title: `${pieceName(i, p)} in ${label}`, detail: `Swap the ${pieceName(i, p).toLowerCase()} for ${label}.` });
    }
  }

  // Value: a darker lower piece grounds a top-heavy figure.
  if (state("value") === "advice" && p.lower >= 0 && p.upper >= 0) {
    const s = b.palette[p.lower];
    const L = fix(Math.max(0.14, b.top.L - 0.2));
    const o = { L, C: s.C, h: s.h };
    moves.push({ kind: "recolour", swatch: p.lower, piece: "lower", ...o, title: `A darker lower piece: ${plain(o)}`, detail: "A darker value below grounds the figure." });
  }

  // Chroma: step the second loud colour down to a muted version of itself.
  const loud = chromatic.filter((s) => s.C >= SATURATED);
  if (state("chroma") === "advice" && loud.length >= 2) {
    const s = loud[1];
    const i = b.palette.indexOf(s);
    const o = { L: s.L, C: 0.05, h: s.h };
    moves.push({ kind: "recolour", swatch: i, piece: pieceOf(i, p), ...o, title: `${pieceName(i, p)} muted to ${plain(o)}`, detail: "One colour at full strength, the other stepped down." });
  }

  // Accent: a tenth of the area. The complement of the lead hue when the lead
  // is a real colour; when it is near-neutral (a cream, a stone), the
  // complement of a barely-there hue means little, so the tailor's classic
  // accents are offered instead (oxblood, cognac, navy). The rulebook ranks
  // them like any other move.
  if (state("shares") !== "golden") {
    const accents = lead && lead.C >= CLEAR_HUE ? [{ L: 0.5, C: 0.12, h: wrap(lead.h + 180) }] : CLASSIC_ACCENTS;
    for (const accent of accents) {
      moves.push({ kind: "accent", ...accent, title: `Shoes in ${plain(accent)}`, detail: "An accent of about a tenth gives the eye a place to rest." });
    }
  }
  return moves;
}

/** The ideas a look's colour moves stand for: a piece and a hue family ("lower:green"). */
export const ideasOf = (moves: Move[]): string[] =>
  moves.flatMap((m) => (m.kind === "break" ? [] : [`${m.kind === "accent" ? "shoes" : m.piece}:${familyOf(m.L, m.C, m.h)}`]));

const id = (moves: Move[]) =>
  moves.map((m) => (m.kind === "break" ? `b${m.to}` : `${m.kind[0]}${"swatch" in m ? m.swatch : ""}-${m.L}-${m.C}-${m.h}`)).join("+");

/** The three best looks for these bins, best first. Empty when nothing improves the reading. */
export function suggestLooks(b: Bins, lines: AdviceLine[], limit = 3): Look[] {
  const before = scoreOf(lines);
  const singles = candidateMoves(b, lines);
  const combos: Move[][] = singles.map((m) => [m]);
  // Pairs: a proportion move with a colour move, or two colour moves on
  // different pieces.
  for (let i = 0; i < singles.length; i++)
    for (let j = i + 1; j < singles.length; j++) {
      const a = singles[i], c = singles[j];
      if (a.kind === "break" && c.kind === "break") continue;
      if (a.kind === "recolour" && c.kind === "recolour" && a.swatch === c.swatch) continue;
      if (a.kind === "accent" && c.kind === "accent") continue;
      combos.push([a, c]);
    }

  const looks: Look[] = [];
  combos.forEach((moves) => {
    const bins = normalise(moves.reduce(applyMove, b));
    const after = readBins(bins);
    // Never fix one rule by breaking another.
    const worse = after.some((l) => {
      const was = lines.find((x) => x.rule === l.rule);
      return l.state === "advice" && was !== undefined && was.state !== "advice";
    });
    const gain = scoreOf(after) - before;
    if (worse || gain <= 0) return;
    const changes = after
      .map((l) => ({ rule: l.rule, title: l.title, from: lines.find((x) => x.rule === l.rule)?.state ?? l.state, to: l.state }))
      .filter((c) => c.from !== c.to);
    looks.push({ id: id(moves), title: moves.map((m) => m.title).join(" + "), moves, bins, lines: after, gain, changes });
  });

  // Best gain first; fewer moves first at equal gain; then candidate order.
  const ranked = looks.map((l, i) => ({ l, i })).sort((x, y) => y.l.gain - x.l.gain || x.l.moves.length - y.l.moves.length || x.i - y.i).map((x) => x.l);
  // Variety: no look whose moves contain an already chosen look's moves at
  // no extra gain, and at most one look per hue family per piece (forest
  // green, olive and bottle green for the lower piece are one idea, Noor,
  // 2026-10-04). The slots left go to the next best different moves: a
  // value move, an accent, a tuck or a belt. A proportion move sits in at
  // most two of the three while a look without it also improves the
  // reading, so the tuck cannot take every slot; only when none does may it.
  const chosen: Look[] = [];
  const used = new Set<string>();
  const isBreak = (m: Move) => m.kind === "break";
  for (const capBreaks of [true, false]) {
    for (const look of ranked) {
      if (chosen.length === limit) break;
      if (chosen.includes(look)) continue;
      const redundant = chosen.some((c) => c.moves.every((m) => look.moves.includes(m)) && look.gain <= c.gain);
      const keys = ideasOf(look.moves);
      if (redundant || keys.some((k) => used.has(k))) continue;
      if (capBreaks && look.moves.some(isBreak) && chosen.filter((c) => c.moves.some(isBreak)).length >= limit - 1) continue;
      chosen.push(look);
      keys.forEach((k) => used.add(k));
    }
  }
  // Best first, as ranked.
  chosen.sort((x, y) => ranked.indexOf(x) - ranked.indexOf(y));
  return chosen;
}

