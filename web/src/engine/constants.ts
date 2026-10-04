// Band edges shared by the rules (rules.ts, colour-rules.ts, shape-rules.ts)
// and the rulebook (rulebook.ts), so what the page states is what the engine
// does. Changing any of these changes readings: bump ENGINE_VERSION.

/** Below this OKLCH chroma a colour reads as a neutral. Dark colours carry little chroma, so it is low. */
export const NEUTRAL_CHROMA = 0.02;
/** From this OKLCH chroma a colour reads as saturated. */
export const SATURATED_CHROMA = 0.11;

/** Upper piece fabric width over shoulder distance: fitted below [0], loose above [1]. First estimates (R1 calibrates). */
export const FIT_TOP: readonly [number, number] = [1.15, 1.4];
/** Both legs' fabric at the knee over shoulder distance: slim below [0], wide above [1]. First estimates (R1 calibrates). */
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
