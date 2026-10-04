// The plain verdict: one sentence in everyday words above every number, so a
// visitor knows at once whether the outfit works and the one change worth
// making (the shopper user-sim, 2026-10-04: "is that good?"). It speaks of
// the outfit, never the person, and it adds nothing the rules did not say:
// it counts their advice and names the best suggested look in plain words.

import type { Look, Move } from "./looks";
import { colourName } from "./names";
import type { AdviceLine } from "./rules";

const PIECE_WORDS = { upper: "the top", lower: "the lower piece", shoes: "shoes", other: "an accent" } as const;

/** One move in everyday words: "a front tuck", "navy for the lower piece", "oxblood shoes". */
export function plainMove(m: Move): string {
  if (m.kind === "break") return m.title.startsWith("Belt") ? "a belt at the waist" : "a front tuck";
  const name = colourName(m.L, m.C, m.h);
  if (m.kind === "accent") return `${name} shoes`;
  return m.piece === "shoes" ? `${name} shoes` : `${name} for ${PIECE_WORDS[m.piece]}`;
}

const listed = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);

export function verdictOf(lines: AdviceLine[], looks: Look[]): string {
  const changes = lines.filter((l) => l.state === "advice").length;
  const best = looks[0];
  const tryIt = best ? ` Try ${listed(best.moves.map(plainMove))}.` : "";
  if (changes === 0) {
    return best ? `Works. The proportions and colours hold together.${tryIt.replace(" Try", " For one more note, try")}` : "Works. The proportions and colours hold together; keep it as it is.";
  }
  if (changes === 1) return `Works, with one change worth making.${tryIt}`;
  return `${changes === 2 ? "Two" : "A few"} changes would help.${tryIt}`;
}
