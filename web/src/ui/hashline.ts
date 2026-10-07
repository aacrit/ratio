// The hash line: one promise, one string, on every surface that shows a
// view (T10 review 1). The screen's #reading-hash, the card's footer and the
// Rulebook's chip all build it here, so what you save says exactly what you
// saw (T7's law). Each hash is labelled with what it hashes: the photo's own
// reading first, then, when a look is tried, the look's reading, with the
// look named as its card is titled.
//
//   as worn  Same photo, same reading. 0ef2 · ratio-engine/0.10.0
//   a look   Same photo, same reading. 0ef2 · look f8eb: Lower piece in black · ratio-engine/0.10.0
//
// Pure and DOM-free: the tests hold every surface to it.

export interface HashLineOf {
  /** The photo's own reading hash (the outfit as worn). */
  photoHash: string;
  engine: string;
  /** The tried look: its own reading hash and its title. */
  look?: { hash: string; name: string } | null;
}

const hex4 = (h: string) => h.slice(0, 4);

/** The hash line in parts, the order they are read in; the card wraps between them, never inside one. */
export function hashSegments(h: HashLineOf): string[] {
  return [`Same photo, same reading. ${hex4(h.photoHash)}`, ...(h.look ? [`look ${hex4(h.look.hash)}: ${h.look.name}`] : []), h.engine];
}

/** The hash line as one string, for the screen and the Rulebook's chip. */
export const hashLine = (h: HashLineOf): string => hashSegments(h).join(" · ");

/** What is on screen (ui/looks.ts's Shown): `hash` is the shown reading's own, `photoHash` and `look` are set on a tried look. */
export interface ShownHashes {
  hash: string;
  engine: string;
  photoHash?: string;
  look?: string;
}

/** The hash line's inputs for what is on screen, as worn or a tried look. */
export const hashesOfShown = (s: ShownHashes): HashLineOf => ({
  photoHash: s.photoHash ?? s.hash,
  engine: s.engine,
  look: s.photoHash !== undefined && s.look ? { hash: s.hash, name: s.look } : null,
});

/** The hash line's inputs for the Rulebook's hand-off (rules/handoff.ts): the as-worn hash, and the look's when one was tried last. */
export const hashesOfLastRead = (r: { engine: string; hash: string; look: string | null; worn?: { hash: string } }): HashLineOf => ({
  photoHash: r.worn?.hash ?? r.hash,
  engine: r.engine,
  look: r.look !== null && r.worn ? { hash: r.hash, name: r.look } : null,
});
