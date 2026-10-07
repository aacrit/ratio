// The reviewer's probe, kept (T6 review round 2): a seeded generator over
// 4000 bins, built to reach every case the agreement checks are about, each
// read in full (lines, verdict, looks and each look's re-read) and held to
// tests/helpers/agrees.ts. Varied on purpose:
// - an accent on the upper piece, the lower piece, the shoes or a small
//   piece (a bag, a belt), or none;
// - shoes continuing the lower piece, at the leg line's edge (borderline),
//   contrasting, or not read (cut off, on the floor);
// - volume read, half read, unread (arms) or never measured; one side only;
// - an upper piece that opens down the front, or not;
// - the break in every proportion band, or one column.
// It asserts once over all the problems it finds, so it stays fast enough
// for the gate.

import { describe, expect, it } from "vitest";
import type { BinnedSwatch } from "../web/src/engine/colour-rules";
import { binShares } from "../web/src/engine/constants";
import { accentOf, accentWords, pieceOf, pieces } from "../web/src/engine/looks";
import type { Bins } from "../web/src/engine/rules";
import { keepOf, problemsOf, show } from "./helpers/agrees";

export const PROBE_SIZE = 4000;

/** mulberry32: the same readings every run. */
const seeded = (seed: number) => () => {
  seed |= 0;
  seed = (seed + 0x6d2b79f5) | 0;
  let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
  t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
};

const HUES = [0, 25, 35, 60, 95, 150, 200, 215, 240, 255, 280, 330, 345];
const LS = [0.14, 0.2, 0.3, 0.4, 0.5, 0.6, 0.7, 0.8, 0.94];

/** A generator of probe bins from one seed. */
export function probe(seed: number): () => Bins {
  const rand = seeded(seed);
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];
  const colour = (neutral: number) => (rand() < neutral ? { L: pick(LS), C: 0, h: 0 } : { L: pick(LS), C: pick([0.04, 0.06, 0.08, 0.1, 0.12, 0.15, 0.18]), h: pick(HUES) });
  const loud = () => ({ L: pick(LS), C: pick([0.12, 0.15, 0.18]), h: pick(HUES) });
  const clampL = (L: number) => Math.min(0.96, Math.max(0.1, Number(L.toFixed(2))));
  type Raw = { L: number; C: number; h: number; y: number; w: number };

  return () => {
    const accentOn = pick(["none", "upper", "lower", "shoes", "other"] as const);
    const upper = accentOn === "upper" ? loud() : colour(0.45);
    const column = accentOn !== "upper" && accentOn !== "lower" && rand() < 0.15;
    const lower = column ? { ...upper } : accentOn === "lower" ? loud() : colour(0.45);
    const raw: Raw[] = [{ ...upper, y: pick([0.2, 0.3]), w: accentOn === "upper" ? 0.05 + rand() * 0.1 : 0.3 + rand() * 0.5 }];
    if (!column) raw.push({ ...lower, y: pick([0.6, 0.7]), w: accentOn === "lower" ? 0.05 + rand() * 0.1 : 0.3 + rand() * 0.5 });
    // Extra body colours, and the small accent where a bag or a belt sits.
    for (let i = Math.floor(rand() * 3); i > 0; i--) raw.push({ ...colour(0.6), y: pick([0.2, 0.3, 0.6, 0.7]), w: 0.05 + rand() * 0.3 });
    if (accentOn === "other") raw.push({ ...loud(), y: pick([0.4, 0.7]), w: 0.05 + rand() * 0.08 });
    const shoesMode = pick(["continue", "edge", "contrast", "contrast", "none"] as const);
    if (shoesMode !== "none") {
      const delta = shoesMode === "continue" ? pick([0, 0.02, 0.04, 0.06]) : shoesMode === "edge" ? pick([0.08, 0.1, 0.12, 0.14, 0.16]) : pick([0.2, 0.3, 0.5]);
      const L = clampL(lower.L + (rand() < 0.5 ? delta : -delta));
      const c = accentOn === "shoes" ? { ...loud(), L } : rand() < 0.6 ? { L, C: 0, h: 0 } : { L, C: pick([0.04, 0.08, 0.12]), h: pick(HUES) };
      raw.push({ ...c, y: 0.95, w: accentOn === "shoes" ? 0.05 + rand() * 0.1 : 0.04 + rand() * 0.08 });
    }
    const total = raw.reduce((t, s) => t + s.w, 0);
    const shares = binShares(raw.map((s) => s.w / total));
    const palette: BinnedSwatch[] = raw.map((s, i) => ({ L: s.L, C: s.C, h: s.h, y: s.y, share: shares[i] })).sort((p, q) => q.share - p.share);
    const fitMode = pick(["read", "read", "half-top", "half-legs", "arms", "none"] as const);
    const top = pick([1.0, 1.1, 1.15, 1.2, 1.3, 1.4, 1.5, 1.7]);
    const legs = pick([0.3, 0.4, 0.45, 0.5, 0.55, 0.6, 0.7, 0.9]);
    const fit = fitMode === "read" ? { top, legs } : fitMode === "half-top" ? { top, legs: null } : fitMode === "half-legs" ? { top: null, legs } : null;
    const b: Bins = {
      proportion: column ? null : pick([0.2, 0.3, 0.34, 0.38, 0.44, 0.5, 0.56, 0.62, 0.66, 0.7, 0.8]),
      waist: pick([0.36, 0.38, 0.4]),
      top: { L: upper.L, C: upper.C, h: upper.h },
      bottom: { L: lower.L, C: lower.C, h: lower.h },
      palette,
      fit,
    };
    if (rand() < 0.3) b.front = true;
    if (fitMode === "arms" || (fitMode === "half-legs" && rand() < 0.5)) b.fitWhy = "arms";
    if (fitMode === "read" && rand() < 0.2) b.fitOneSide = true;
    if (shoesMode === "none" && rand() < 0.7) b.shoesWhy = pick(["cut_off", "floor"] as const);
    return b;
  };
}

describe("the reviewer's probe: 4000 seeded readings, every line agrees", () => {
  it("no keep against a change, no body word, borderline follows the leg line, no look off the mark, never fine when not read", () => {
    const next = probe(0x7a6);
    const problems: string[] = [];
    const seen = { accentKept: 0, ruleKept: 0, edgeClause: 0, halfRead: 0, looks: 0, matchedValue: 0, accentOn: { upper: 0, lower: 0, shoes: 0, other: 0 } };
    const started = performance.now();
    for (let i = 0; i < PROBE_SIZE; i++) {
      const s = show(next());
      problems.push(...problemsOf(s, `probe #${i}`));
      const kept = keepOf(s.verdict);
      if (kept !== null && kept === accentWords(s.bins)) seen.accentKept++;
      else if (kept !== null) seen.ruleKept++;
      if (s.lines[0].borderline && /the leg line says more/.test(s.lines[0].text)) seen.edgeClause++;
      if (s.lines.some((l) => l.rule === "volume" && l.state === "unread")) seen.halfRead++;
      if (s.lines.some((l) => l.recolours?.some((r) => r.matched))) seen.matchedValue++;
      seen.looks += s.looks.length;
      const a = accentOf(s.bins);
      if (a >= 0) seen.accentOn[pieceOf(a, pieces(s.bins))]++;
    }
    const ms = Math.round(performance.now() - started);
    console.log(`probe: ${PROBE_SIZE} readings in ${ms} ms`, JSON.stringify(seen));
    expect(problems.slice(0, 20), `${problems.length} problems`).toEqual([]);
    // The probe reaches every case it is for.
    expect(seen.accentKept).toBeGreaterThan(50);
    expect(seen.ruleKept).toBeGreaterThan(50);
    expect(seen.edgeClause).toBeGreaterThan(10);
    expect(seen.halfRead).toBeGreaterThan(100);
    expect(seen.matchedValue).toBeGreaterThan(10);
    expect(seen.looks).toBeGreaterThan(2000);
    for (const n of Object.values(seen.accentOn)) expect(n).toBeGreaterThan(50);
  }, 120_000);
});
