// Compact mode's one-line headline (T8, R-09: the verdict fills the fold at
// every width, in both Compact states, because Compact folded the rule
// rows but never the headline above them). This reads the verdict word and
// the one change back out of the full sentence the engine already wrote
// (engine/verdict.ts), rather than composing new copy: the compact line can
// only ever say what the full sentence already says, pulled apart to fit
// one line. That keeps it true in every state the full sentence can take,
// including "Trying <look>: Works. ..." while a look is on.
//
// The full sentence is always `opening sentence(s) + " " + tryIt`, where
// tryIt (verdictOf, engine/verdict.ts) is the last sentence and, when there
// is something to act on, always opens with "Try ", "For one more note,
// try " or "The change: ". Anything else there ("Keep it as it is.", or a
// "Keep ..." sentence when there is nothing to try) names nothing to do,
// so the compact line is the verdict word alone.

export interface CompactHeadline {
  /** The opening clause: "Works", "Works, with one change worth making" stripped to "Works", "Two changes would help", "A few changes would help". */
  verdict: string;
  /** The one change to make, in the engine's own words, or null when there is none to name. */
  change: string | null;
  /** True when `change` is an offer ("For one more note, try ...") rather than something the rules are asking for: review round 1, these must not read the same ("Works · X" for both). */
  optional: boolean;
  /** True while the verdict judges a tried look, not the outfit as worn (ui/looks.ts's tryingPrefix). */
  trying: boolean;
}

/** The plain-verdict openings (engine/verdict.ts's `opening`), tested longest-match first so "Works, with one change..." still matches "Works". */
const OPENINGS = ["A few changes would help", "Two changes would help", "Works"] as const;

/** Strips a "Trying <phrase>: " prefix (ui/looks.ts's tryingPrefix) and says whether it was there, so a tried look's headline still starts from its own verdict but the fact that it is a trial is never lost. */
function stripTrying(full: string): { body: string; trying: boolean } {
  const m = /^Trying .+?:\s*/.exec(full);
  return m ? { body: full.slice(m[0].length), trying: true } : { body: full, trying: false };
}

export function compactHeadline(full: string): CompactHeadline {
  const trimmed = full.trim();
  const { body, trying } = stripTrying(trimmed);
  const opening = OPENINGS.find((o) => body.startsWith(o));
  const verdict = opening ?? (body.split(/\.\s|\.$/)[0] || body).trim();

  const sentences = trimmed
    .split(/\.\s+/)
    .map((s) => s.replace(/\.$/, "").trim())
    .filter(Boolean);
  const last = sentences.at(-1) ?? "";
  const optionalMatch = /^For one more note, try (.+)$/i.exec(last);
  const tryMatch = /^Try (.+)$/i.exec(last);
  const changeMatch = /^The change: (.+)$/i.exec(last);
  const change = optionalMatch?.[1] ?? tryMatch?.[1] ?? changeMatch?.[1] ?? null;

  return { verdict, change, optional: !!optionalMatch, trying };
}

/**
 * The headline as one line: "Works · a shorter upper piece" for a needed
 * change, "Works · or try navy for the lower piece" for an offered one (an
 * optional note must never fold to the same text as a needed change -
 * review round 1), or the verdict word alone when there is nothing to try.
 * While a look is tried, a short "Trying · " prefix keeps that true too.
 * Empty input (no read yet) stays empty.
 */
export function compactHeadlineText(full: string): string {
  if (!full.trim()) return "";
  const { verdict, change, optional, trying } = compactHeadline(full);
  const line = change ? `${verdict} · ${optional ? "or try " : ""}${change}` : verdict;
  return trying ? `Trying · ${line}` : line;
}
