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

/** True when a binned value sits within half a bin of any edge: a slightly different photo could read the other way. */
export function nearEdge(value: number, edges: readonly number[], bin: number): boolean {
  return edges.some((e) => Math.abs(value - e) <= bin / 2 + 1e-9);
}

/** Colour shares are binned in units of this size. */
export const SHARE_BIN = 0.05;

/**
 * Shares binned to SHARE_BIN so they always sum to exactly 1.00: largest
 * remainder (Hamilton) apportionment of 20 units. Every colour keeps at
 * least one unit (it passed the palette's speck filter, so it is shown);
 * units go to the largest remainders first and are taken back from the
 * most over-served; ties go to the earlier colour. Deterministic.
 */
export function binShares(shares: readonly number[]): number[] {
  const units = Math.round(1 / SHARE_BIN);
  const n = shares.length;
  if (!n) return [];
  const total = shares.reduce((t, s) => t + s, 0);
  const quota = shares.map((s) => (total > 0 ? (s / total) * units : units / n));
  const got = quota.map((q) => Math.max(n <= units ? 1 : 0, Math.floor(q + 1e-9)));
  let left = units - got.reduce((t, u) => t + u, 0);
  while (left > 0) {
    let best = 0;
    for (let i = 1; i < n; i++) if (quota[i] - got[i] > quota[best] - got[best] + 1e-9) best = i;
    got[best]++;
    left--;
  }
  while (left < 0) {
    let best = -1;
    for (let i = 0; i < n; i++) {
      if (got[i] <= 1) continue;
      if (best < 0 || got[i] - quota[i] > got[best] - quota[best] + 1e-9) best = i;
    }
    if (best < 0) break;
    got[best]--;
    left++;
  }
  return got.map((u) => Number((u * SHARE_BIN).toFixed(2)));
}
