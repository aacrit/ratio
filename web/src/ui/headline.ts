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
}

/** The plain-verdict openings (engine/verdict.ts's `opening`), tested longest-match first so "Works, with one change..." still matches "Works". */
const OPENINGS = ["A few changes would help", "Two changes would help", "Works"] as const;

/** Strips a "Trying <phrase>: " prefix (ui/looks.ts's tryingPrefix), so a tried look's headline still starts from its own verdict. */
function stripTrying(full: string): string {
  const m = /^Trying .+?:\s*/.exec(full);
  return m ? full.slice(m[0].length) : full;
}

export function compactHeadline(full: string): CompactHeadline {
  const trimmed = full.trim();
  const body = stripTrying(trimmed);
  const opening = OPENINGS.find((o) => body.startsWith(o));
  const verdict = opening ?? (body.split(/\.\s|\.$/)[0] || body).trim();

  const sentences = trimmed
    .split(/\.\s+/)
    .map((s) => s.replace(/\.$/, "").trim())
    .filter(Boolean);
  const last = sentences.at(-1) ?? "";
  const tryMatch = /^(?:Try|For one more note, try) (.+)$/i.exec(last);
  const changeMatch = /^The change: (.+)$/i.exec(last);
  const change = tryMatch?.[1] ?? changeMatch?.[1] ?? null;

  return { verdict, change };
}

/** The headline as one line: "Works · a shorter upper piece", or the verdict word alone when there is nothing to try. Empty input (no read yet) stays empty. */
export function compactHeadlineText(full: string): string {
  if (!full.trim()) return "";
  const { verdict, change } = compactHeadline(full);
  return change ? `${verdict} · ${change}` : verdict;
}
