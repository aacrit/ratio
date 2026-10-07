// "Download this read (free)" and the S shortcut: one export at a time, said
// at once. The press shows "Drawing the card." in the save row's status line
// (role=status, polite) in the same tick, before the fonts load and the PNG
// encodes, so S never looks inert (T7, R-09). Another press of S, or of any
// download button, while a card is being drawn or while "Downloaded" still
// shows starts nothing; it repeats the current line in its own status line
// instead. The card is drawn from whatever is on screen once a look still
// landing has landed. "Saved" is said once the PNG was handed to the browser
// as a download; where the browser puts it is the browser's own business.

import type { CardContent } from "./card";
import type { Shown } from "./looks";

/** spec.md, "Download this read (free)": `Drawing the card.` → `Downloaded` → back; failure `Could not draw the card`. */
export const DRAWING_CARD = "Drawing the card.";
export const CARD_FAILED = "The card could not be drawn. Try the download again.";
export const savedCopy = (hash: string): string => `Saved to your downloads as ratio-${hash.slice(0, 4)}.png.`;

/** The read on screen, as far as a card needs it. */
export interface SaveTarget {
  figure: { still(): OffscreenCanvas };
  shown(): Shown;
  /** Resolves once the last try or "as worn" in flight has landed. */
  settled(): Promise<void>;
  credit: string | null;
}

export interface ButtonLike {
  disabled: boolean;
  textContent: string | null;
  focus(): void;
}

export interface NoteLike {
  textContent: string | null;
}

/** How long "Downloaded" stays on the button before it reads as itself again; no new export starts until then. */
export const RESET_MS = 1600;

export function cardSaver(deps: { current: () => SaveTarget | null; save: (c: CardContent) => Promise<void> }): (button: ButtonLike, note: NoteLike) => Promise<void> {
  /** The export holding the lock, from the press until "Downloaded" has had its time; null when a press may start one. */
  let held: { line: string } | null = null;
  /** Each button's own label, kept from its first press until it reads as itself again. */
  const labels = new WeakMap<ButtonLike, string | null>();
  /** Each button's pending return to its label, and whether it had focus when that export began. */
  const resets = new WeakMap<ButtonLike, { timer: ReturnType<typeof setTimeout>; hadFocus: boolean }>();

  return async (button, note) => {
    if (held) {
      // Held S, a double tap, the other button: one export, and the press
      // that was dropped says where things stand rather than nothing.
      note.textContent = held.line;
      return;
    }
    // The read being saved is fixed now: a new read started during the wait
    // must not swap in (its own recolour was never waited on).
    const c = deps.current();
    if (!c) return;
    const mine = { line: DRAWING_CARD };
    held = mine;
    // A retry on a button still reading "Could not draw the card" keeps its
    // real label, and the focus it had when the first press began.
    const earlier = resets.get(button);
    if (earlier) clearTimeout(earlier.timer);
    if (!labels.has(button)) labels.set(button, button.textContent);
    // Disabling a focused button drops its focus: give it back afterwards,
    // but never pull focus to it from wherever S was pressed.
    const hadFocus = (earlier?.hadFocus ?? false) || (globalThis.document?.activeElement as unknown) === button;
    button.disabled = true;
    button.textContent = DRAWING_CARD;
    note.textContent = DRAWING_CARD;
    let saved = false;
    try {
      // A look still being recoloured lands first: the card matches the photo and its note.
      await c.settled();
      const shown = c.shown();
      await deps.save({ still: c.figure.still(), title: shown.title, note: shown.note, lines: shown.lines, bins: shown.bins, hash: shown.hash, engine: shown.engine, credit: c.credit ?? undefined });
      saved = true;
      button.textContent = "Downloaded";
      note.textContent = mine.line = savedCopy(shown.hash);
    } catch {
      button.textContent = "Could not draw the card";
      note.textContent = CARD_FAILED;
    }
    // A failure saved nothing, so there is nothing to protect: a retry may
    // start at once. A saved card holds the lock while "Downloaded" shows.
    if (!saved) {
      held = null;
      button.disabled = false;
    }
    const timer = setTimeout(() => {
      resets.delete(button);
      if (held === mine) held = null;
      button.disabled = false;
      button.textContent = labels.get(button) ?? button.textContent;
      labels.delete(button);
      if (hadFocus) button.focus();
    }, RESET_MS);
    resets.set(button, { timer, hadFocus });
  };
}
