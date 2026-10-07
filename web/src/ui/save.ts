// "Download this read (free)" and the S shortcut: one export at a time, said
// at once. The press shows "Drawing the card." in the save row's status line
// (role=status, polite) in the same tick, before the fonts load and the PNG
// encodes, so S never looks inert (T7, R-09). A second press of S, or of
// either download button, while a card is being drawn starts nothing. The
// card is drawn from whatever is on screen once a look still landing has
// landed, and nothing claims "saved" until the browser has the file.

import type { CardContent } from "./card";
import type { Shown } from "./looks";

/** spec.md, "Download this read (free)": `Drawing the card.` → `Downloaded` → back; failure `Could not draw the card`. */
export const DRAWING_CARD = "Drawing the card.";
export const CARD_FAILED = "The card could not be drawn.";
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

/** How long "Downloaded" stays on the button before it reads as itself again. */
const RESET_MS = 1600;

export function cardSaver(deps: { current: () => SaveTarget | null; save: (c: CardContent) => Promise<void> }): (button: ButtonLike, note: NoteLike) => Promise<void> {
  let drawing = false;
  const labels = new WeakMap<ButtonLike, string | null>();
  const resets = new WeakMap<ButtonLike, ReturnType<typeof setTimeout>>();

  return async (button, note) => {
    if (drawing) return;
    // The read being saved is fixed now: a new read started during the wait
    // must not swap in (its own recolour was never waited on).
    const c = deps.current();
    if (!c) return;
    drawing = true;
    // A button still showing "Downloaded" from the last save keeps its own label.
    clearTimeout(resets.get(button));
    if (!labels.has(button)) labels.set(button, button.textContent);
    // Disabling a focused button drops its focus: give it back afterwards,
    // but never pull focus to it from wherever S was pressed.
    const hadFocus = (globalThis.document?.activeElement as unknown) === button;
    button.disabled = true;
    button.textContent = DRAWING_CARD;
    note.textContent = DRAWING_CARD;
    try {
      // A look still being recoloured lands first: the card matches the photo and its note.
      await c.settled();
      const shown = c.shown();
      await deps.save({ still: c.figure.still(), title: shown.title, note: shown.note, lines: shown.lines, bins: shown.bins, hash: shown.hash, engine: shown.engine, credit: c.credit ?? undefined });
      button.textContent = "Downloaded";
      note.textContent = savedCopy(shown.hash);
    } catch {
      button.textContent = "Could not draw the card";
      note.textContent = CARD_FAILED;
    } finally {
      drawing = false;
      resets.set(
        button,
        setTimeout(() => {
          button.disabled = false;
          button.textContent = labels.get(button) ?? button.textContent;
          labels.delete(button);
          if (hadFocus) button.focus();
        }, RESET_MS),
      );
    }
  };
}
