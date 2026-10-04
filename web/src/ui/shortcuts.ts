// Keyboard, for heavy use (T3, R-09, Noor: "no shortcuts"). `O` reads
// another, `1`/`2`/`3` try a look, Escape returns to the original, `[`/`]`
// step through this session's reads, `S` downloads the card, `?` lists the
// shortcuts. None of them fire while a field has focus: `isTypingIn` is the
// guard, pure and DOM-free so it is a unit test rather than a manual check.

export interface FocusLike {
  tagName: string;
  isContentEditable?: boolean;
  type?: string;
}

const NOT_TEXTY_INPUT = new Set(["checkbox", "radio", "button", "submit", "reset", "range", "color", "file", "image"]);

/** True when the given element is a field a shortcut key should be left alone to type into. */
export function isTypingIn(el: FocusLike | null | undefined): boolean {
  if (!el) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName.toUpperCase();
  if (tag === "TEXTAREA" || tag === "SELECT") return true;
  if (tag === "INPUT") return !NOT_TEXTY_INPUT.has((el.type ?? "text").toLowerCase());
  return false;
}

export interface ShortcutHandlers {
  /** `O`: read another. */
  another: () => void;
  /** `1`/`2`/`3`: try the look at this 0-based index, if it exists. */
  tryLook: (index: number) => void;
  /** Escape: back to the original (a no-op when nothing is being tried). */
  original: () => void;
  /** `[` (-1) / `]` (+1): step through this session's reads. */
  step: (direction: -1 | 1) => void;
  /** `S`: download the card. */
  download: () => void;
  /** `?`: show the shortcuts sheet. */
  help: () => void;
}

const KEY_LOOK: Record<string, number> = { "1": 0, "2": 1, "3": 2 };

/** Only what setupShortcuts needs from `document`, so a test can hand it a fake one. */
export type ShortcutRoot = Pick<Document, "activeElement" | "addEventListener" | "removeEventListener">;

/**
 * Wires the shortcuts to `document`. Returns a cleanup function. The guard
 * reads `root.activeElement` at call time, never cached, since focus moves
 * constantly. A key a menu or a dialog has already claimed arrives with
 * `defaultPrevented` set (both call `preventDefault()` before this would
 * see it, since they sit closer to the key's target and so run first): this
 * is also what keeps Esc, for instance, to doing one thing.
 */
export function setupShortcuts(handlers: ShortcutHandlers, root: ShortcutRoot = document): () => void {
  const onKeydown = (e: KeyboardEvent) => {
    if (e.defaultPrevented || e.metaKey || e.ctrlKey || e.altKey) return;
    if (isTypingIn(root.activeElement as unknown as FocusLike | null)) return;
    if (e.key === "Escape") return handlers.original();
    if (e.key === "[") return handlers.step(-1);
    if (e.key === "]") return handlers.step(1);
    if (e.key === "?") return handlers.help();
    const lower = e.key.toLowerCase();
    if (lower === "o") return handlers.another();
    if (lower === "s") return handlers.download();
    if (lower in KEY_LOOK) return handlers.tryLook(KEY_LOOK[lower]);
  };
  root.addEventListener("keydown", onKeydown);
  return () => root.removeEventListener("keydown", onKeydown);
}

export const SHORTCUT_LIST: readonly { key: string; does: string }[] = [
  { key: "O", does: "Read another" },
  { key: "1  2  3", does: "Try a look" },
  { key: "Esc", does: "Back to the original" },
  { key: "[  ]", does: "Step through this session's reads" },
  { key: "S", does: "Download this read" },
  { key: "?", does: "Show these shortcuts" },
];
