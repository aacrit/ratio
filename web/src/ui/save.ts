// "Download this read (free)" and the S shortcut: one export at a time, said
// at once. The press shows "Drawing the card." in the save row's status line
// (role=status, polite) in the same tick, before the fonts load and the PNG
// encodes, so S never looks inert (T7, R-09). While a card is being drawn,
// any other press of S or a download button starts nothing and says
// "Drawing the card." in its own status line; every such line is brought up
// to date when the card is done. A press for another read (stepped to while
// drawing) is kept in one queued slot and starts when the card in hand is
// done, if that read is still on screen. Once saved, "Downloaded" has its moment:
// another press for the same read repeats the saved line, while a press for
// another read (stepped to with [ ]) starts that read's card at once, never
// echoing a line about a read no longer on screen. The card is drawn from
// whatever is on screen once a look still landing has landed. "Saved" is
// said once the PNG was handed to the browser as a download; where the
// browser puts it is the browser's own business.
//
// "What is on screen" is the read and its view: trying or removing a look
// changes the view (T10, R-09: "Saved to your downloads as ratio-0ef2.png."
// stayed under the button after switching to a look). main.ts clears the
// line in that same tick; here, a card whose view has since changed never
// writes its line, and a press after a look change draws a new card rather
// than repeating the last one's line.

import { type CardContent, cardContentOf, cardFileName } from "./card";
import type { Shown } from "./looks";

/** spec.md, "Download this read (free)": `Drawing the card.` → `Downloaded` → back; failure `Could not draw the card`. */
export const DRAWING_CARD = "Drawing the card.";
export const CARD_FAILED = "The card could not be drawn. Try the download again.";
/** The saved line names the file exactly as saveCard names it: the photo's hash, and the look when the card is a look's. */
export const savedCopy = (hash: string, look?: CardContent["look"]): string => `Saved to your downloads as ${cardFileName({ hash, look })}.`;

/** The read on screen, as far as a card needs it. */
export interface SaveTarget {
  figure: { still(): OffscreenCanvas };
  shown(): Shown;
  /** Resolves once the last try or "as worn" in flight has landed. */
  settled(): Promise<void>;
  credit: string | null;
  /** Changes in the same tick a look is tried or removed (ui/looks.ts). Absent: the view never changes. */
  view?(): number;
}

/** A read in one view: what a card, and the line about it, belong to. */
interface Screen {
  target: SaveTarget;
  view: number;
}

const screenOf = (target: SaveTarget): Screen => ({ target, view: target.view?.() ?? 0 });
const sameScreen = (a: Screen | null, b: Screen | null): boolean => a !== null && b !== null && a.target === b.target && a.view === b.view;

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
  /** The read and view it saves: a press for any other is never answered with this export's lines. */
  screen: Screen;
  drawing: boolean;
  /** The line it stands at: drawing, then saved. */
  line: string;
  /** Status lines of presses dropped while it was drawing, each with the read on screen at its press. */
  echoed: Map<NoteLike, Screen | null>;
  /** The latest press, while drawing, for a read or view other than this one: it starts once this card is done. */
  next: { button: ButtonLike; note: NoteLike; screen: Screen } | null;
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

  const download = async (button: ButtonLike, note: NoteLike): Promise<void> => {
    // The read being saved is fixed now: a new read started during the wait
    // must not swap in (its own recolour was never waited on).
    const c = deps.current();
    const at = c ? screenOf(c) : null;
    if (held?.drawing) {
      // Held S, a double tap, the other button: one export at a time. The
      // dropped press says a card is being drawn, and hears how it ended.
      note.textContent = DRAWING_CARD;
      if (at && !sameScreen(at, held.screen)) held.next = { button, note, screen: at };
      else held.echoed.set(note, at);
      return;
    }
    if (held && (at === null || sameScreen(at, held.screen))) {
      // "Downloaded" still shows for this very read and view: say so again, save nothing more.
      note.textContent = held.line;
      return;
    }
    // Nothing held, or the card saved was another read's or view's: this one starts now.
    if (!c || !at) return;
    const mine: Held = { screen: at, drawing: true, line: DRAWING_CARD, echoed: new Map(), next: null };
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
      const content = cardContentOf(shown, c.figure.still(), c.credit);
      await deps.save(content);
      saved = true;
      final = savedCopy(content.hash, content.look);
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
    const now = deps.current();
    const stillShown = sameScreen(now ? screenOf(now) : null, at);
    note.textContent = stillShown ? final : "";
    for (const [n, pressedFor] of mine.echoed) n.textContent = stillShown && sameScreen(pressedFor, at) ? final : "";
    const restore = () => {
      resets.delete(button);
      if (held === mine) held = null;
      button.disabled = false;
      button.textContent = labels.get(button) ?? button.textContent;
      labels.delete(button);
      if (hadFocus && focusIsLost()) button.focus();
    };
    if (!stillShown) {
      // Its read or view is gone from the screen: "Downloaded" would speak
      // for what is shown now, so the button reads as itself at once, and
      // what is shown now may be saved straight away.
      restore();
      const next = mine.next;
      const after = deps.current();
      if (next && sameScreen(after ? screenOf(after) : null, next.screen)) await download(next.button, next.note);
      return;
    }
    // A failure saved nothing, so there is nothing to protect: a retry may
    // start at once. A saved card holds the lock while "Downloaded" shows.
    if (!saved) {
      if (held === mine) held = null;
      button.disabled = false;
    }
    resets.set(button, { timer: setTimeout(restore, RESET_MS), hadFocus });
  };
  return download;
}
