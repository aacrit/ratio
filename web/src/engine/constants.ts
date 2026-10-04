// Band edges shared by the rules (rules.ts, colour-rules.ts, shape-rules.ts)
// and the rulebook (rulebook.ts), so what the page states is what the engine
// does. Changing any of these changes readings: bump ENGINE_VERSION.

/** Below this OKLCH chroma a colour reads as a neutral. Dark colours carry little chroma, so it is low. */
export const NEUTRAL_CHROMA = 0.02;

/**
 * The neutral line rises with lightness: a cream at chroma 0.03 reads as an
 * off-white (a neutral), while a plum at the same chroma in the dark still
 * reads as plum. From NEUTRAL_CHROMA at mid lightness up to 0.045 at white
 * (the stylist user-sim, 2026-10-04: "treat anything below about 0.04 chroma
 * as neutral before you fit templates", for light colours).
 */
export function neutralChromaAt(L: number): number {
  return NEUTRAL_CHROMA + 0.025 * Math.min(1, Math.max(0, (L - 0.5) / 0.45));
}

export const isNeutral = (c: { L: number; C: number }): boolean => c.C < neutralChromaAt(c.L);

/**
 * The colour to draw for a swatch: a neutral is drawn with no chroma, so a
 * cream or a white the engine reads as neutral never shows as a pale pink
 * (a binned neutral keeps its small chroma at hue 0°). Display only: the
 * readings and the hash keep the measured chroma.
 */
export const shownColour = (c: { L: number; C: number; h: number }): { L: number; C: number; h: number } => (isNeutral(c) ? { L: c.L, C: 0, h: 0 } : { L: c.L, C: c.C, h: c.h });
/** From this OKLCH chroma a colour reads as saturated. */
export const SATURATED_CHROMA = 0.11;

/** Upper piece fabric width over shoulder distance: fitted below [0], loose above [1]. First estimates (R1 calibrates). */
export const FIT_TOP: readonly [number, number] = [1.15, 1.4];
/** Both legs' fabric at the knee over shoulder distance: narrow below [0], wide above [1]. First estimates (R1 calibrates). */
export const FIT_LEGS: readonly [number, number] = [0.6, 0.85];

/** Lightness difference between lower piece and shoes under which the leg line reads continuous. */
export const LEG_LINE_EDGE = 0.12;

/** Lightness range of the palette: low below [0], high above [1]. */
export const CONTRAST_EDGES: readonly [number, number] = [0.15, 0.35];
/** Upper vs lower lightness: one tone within [0]; dark over light is advice beyond [1]. */
export const VALUE_GAP_EDGES: readonly [number, number] = [0.08, 0.15];

export const SHARE_EDGES = { column: 0.85, compete: 0.12, near6030: 0.2 } as const;

/** The 60-30-10 reference: dominant, secondary and accent shares of the garment area. */
export const SHARES_REFERENCE: readonly [number, number, number] = [0.6, 0.3, 0.1];

/** Albers' vibration: two colours at least this far apart in hue, both at least this chroma, within this lightness of each other. */
export const VIBRATION = { minHueGap: 150, minChroma: 0.1, maxLightnessGap: 0.08 } as const;

/** True when a binned value sits within half a bin of any edge: a slightly different photo could read the other way. */
export function nearEdge(value: number, edges: readonly number[], bin: number): boolean {
  return edges.some((e) => Math.abs(value - e) <= bin / 2 + 1e-9);
}

/** Colour shares are binned in units of this size. */
export const SHARE_BIN = 0.05;

/**
 * Shares binned to SHARE_BIN so they always sum to exactly 1.00: largest
 * remainder (Hamilton) apportionment of 20 units, so every share stays
 * within one unit of its quota. A speck below one unit is lifted to one
 * unit while there is room; when the lifts overflow the 20, the smallest
 * specks fall back to zero first (ties: the later colour), so a dominant
 * colour is never cut to pay for them (0.88 stays 0.85, not 0.80). Then the
 * units left go to the largest remainders; ties go to the earlier colour.
 * Deterministic.
 */
export function binShares(shares: readonly number[]): number[] {
  const units = Math.round(1 / SHARE_BIN);
  const n = shares.length;
  if (!n) return [];
  const total = shares.reduce((t, s) => t + s, 0);
  const quota = shares.map((s) => (total > 0 ? (s / total) * units : units / n));
  const got = quota.map((q) => Math.floor(q + 1e-9));
  // Lift specks to one unit, then drop the smallest lifts while they overflow.
  const specks = quota.map((q, i) => ({ q, i })).filter(({ i }) => got[i] === 0);
  for (const { i } of specks) got[i] = 1;
  let over = got.reduce((t, u) => t + u, 0) - units;
  specks.sort((x, y) => x.q - y.q || y.i - x.i);
  for (const { i } of specks) {
    if (over <= 0) break;
    got[i] = 0;
    over--;
  }
  let left = units - got.reduce((t, u) => t + u, 0);
  while (left > 0) {
    let best = 0;
    for (let i = 1; i < n; i++) if (quota[i] - got[i] > quota[best] - got[best] + 1e-9) best = i;
    got[best]++;
    left--;
  }
  return got.map((u) => Number((u * SHARE_BIN).toFixed(2)));
}
