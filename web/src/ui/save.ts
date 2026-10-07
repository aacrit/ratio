// "Download this read (free)" and the S shortcut: one export at a time, said
// at once. The press shows "Drawing the card." in the save row's status line
// (role=status, polite) in the same tick, before the fonts load and the PNG
// encodes, so S never looks inert (T7, R-09). While a card is being drawn,
// any other press of S or a download button starts nothing and says
// "Drawing the card." in its own status line; every such line is brought up
// to date when the card is done. Once saved, "Downloaded" has its moment:
// another press for the same read repeats the saved line, while a press for
// another read (stepped to with [ ]) starts that read's card at once, never
// echoing a line about a read no longer on screen. The card is drawn from
// whatever is on screen once a look still landing has landed. "Saved" is
// said once the PNG was handed to the browser as a download; where the
// browser puts it is the browser's own business.

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

/** An export holding the lock, from the press until "Downloaded" has had its time. */
interface Held {
  /** The read it saves: a press for any other read is never answered with this export's lines. */
  target: SaveTarget;
  drawing: boolean;
  /** The line it stands at: drawing, then saved. */
  line: string;
  /** Status lines of presses dropped while it was drawing, each with the read on screen at its press. */
  echoed: Map<NoteLike, SaveTarget | null>;
}

/** True when focus has gone nowhere in particular (the disabled button dropped it), so giving it back moves nobody. */
function focusIsLost(): boolean {
  const doc = globalThis.document as Document | undefined;
  if (!doc) return false;
  const active = doc.activeElement;
  return active === null || active === undefined || active === doc.body;
}

export function cardSaver(deps: { current: () => SaveTarget | null; save: (c: CardContent) => Promise<void> }): (button: ButtonLike, note: NoteLike) => Promise<void> {
  let held: Held | null = null;
  /** Each button's own label, kept from its first press until it reads as itself again. */
  const labels = new WeakMap<ButtonLike, string | null>();
  /** Each button's pending return to its label, and whether it had focus when that export began. */
  const resets = new WeakMap<ButtonLike, { timer: ReturnType<typeof setTimeout>; hadFocus: boolean }>();

  return async (button, note) => {
    // The read being saved is fixed now: a new read started during the wait
    // must not swap in (its own recolour was never waited on).
    const c = deps.current();
    if (held?.drawing) {
      // Held S, a double tap, the other button: one export at a time. The
      // dropped press says a card is being drawn, and hears how it ended.
      note.textContent = DRAWING_CARD;
      held.echoed.set(note, c);
      return;
    }
    if (held && (c === null || c === held.target)) {
      // "Downloaded" still shows for this very read: say so again, save nothing more.
      note.textContent = held.line;
      return;
    }
    // Nothing held, or the card saved was another read's: this one starts now.
    if (!c) return;
    const mine: Held = { target: c, drawing: true, line: DRAWING_CARD, echoed: new Map() };
    held = mine;
    // A button still reading "Downloaded" or "Could not draw the card"
    // keeps its real label, and the focus it had when that press began.
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
    let final = CARD_FAILED;
    try {
      // A look still being recoloured lands first: the card matches the photo and its note.
      await c.settled();
      const shown = c.shown();
      await deps.save({ still: c.figure.still(), title: shown.title, note: shown.note, lines: shown.lines, bins: shown.bins, hash: shown.hash, engine: shown.engine, credit: c.credit ?? undefined });
      saved = true;
      final = savedCopy(shown.hash);
      button.textContent = "Downloaded";
    } catch {
      button.textContent = "Could not draw the card";
    }
    mine.drawing = false;
    mine.line = final;
    // This press's line says how it ended while its read is still on screen.
    // Once another read is (stepped to while drawing), its line is cleared
    // the way a new read clears the save row: no line ever confirms a card
    // of a read not on screen. A press dropped for this same read hears the
    // same ending; one dropped for another read is cleared too.
    note.textContent = deps.current() === c ? final : "";
    for (const [n, pressedFor] of mine.echoed) n.textContent = pressedFor === c ? final : "";
    // A failure saved nothing, so there is nothing to protect: a retry may
    // start at once. A saved card holds the lock while "Downloaded" shows.
    if (!saved) {
      if (held === mine) held = null;
      button.disabled = false;
    }
    const timer = setTimeout(() => {
      resets.delete(button);
      if (held === mine) held = null;
      button.disabled = false;
      button.textContent = labels.get(button) ?? button.textContent;
      labels.delete(button);
      if (hadFocus && focusIsLost()) button.focus();
    }, RESET_MS);
    resets.set(button, { timer, hadFocus });
  };
}
