// The read reveal, as a rule rather than a drawing routine (T3, R-09): the
// tape label and the hero numeral must never show a value that was not
// measured. A spring or a tween that interpolates a numeral necessarily
// passes through values nobody measured, so the label is withheld until the
// motion has actually arrived; only then is the true, final value shown, in
// full, once. Pure and DOM-free, so the rule itself is a unit test, not a
// screenshot to eyeball.
//
// The first read of a session plays the full plumb/chalk/count signature;
// every later read in the same session "appears settled" (a quick `settle`,
// design/BRAND.md) instead, so the instrument does not perform the same two
// seconds of theatre on every single read (Noor, R-09).

/** The tape label's text is the measured value once arrived, never a value interpolated on the way there. */
export function labelAtRest<T>(arrived: boolean, measured: T): T | null {
  return arrived ? measured : null;
}

export type RevealKind = "signature" | "settle";

/** Which reveal a read gets: the full signature once per session, a quick settle after. */
export function revealKind(isFirstOfSession: boolean, reducedMotion: boolean): RevealKind {
  if (reducedMotion) return "settle";
  return isFirstOfSession ? "signature" : "settle";
}
