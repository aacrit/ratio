// The sheet's numerals are final the moment they show (T10, R-09). They
// used to count up from 0 (or from the previous look's values) on a spring,
// each number in the string on its own, which put pairs on screen that no
// reading could produce ("0.25 : 0.25", "0.42 : 0.24") and left the numeral
// empty until the reveal had finished; a count still running when a look or
// a new read replaced it could even land its old value over the new one.
// Now the final text is written at once, in the same tick as the verdict
// and the eyebrow, and replacing it simply writes the next final text. What
// lands is the glow: `--color-tape-glow` flashes behind a numeral when its
// value changes, or when the first read's signature arrives on the photo.
// Reduced motion collapses the flash (design/tokens.css).

interface NumeralEl {
  textContent: string | null;
  dataset: DOMStringMap;
  /** Read once to restart the flash's CSS animation; absent in tests. */
  readonly offsetWidth?: number;
  addEventListener?: (type: "animationend", fn: () => void, opts: { once: true }) => void;
}

/** Writes `to` as the numeral's text now, final. Returns whether the text changed. */
export function setNumeral(el: NumeralEl, to: string): boolean {
  const changed = el.textContent !== to;
  el.textContent = to;
  return changed;
}

/** Flashes the tape glow behind the numeral (`.hero-n[data-lands]` in style.css), restarting it if one is running. */
export function flashNumeral(el: NumeralEl): void {
  delete el.dataset.lands;
  void el.offsetWidth; // a reflow, so the same attribute restarts the animation
  el.dataset.lands = "";
  // Cleared once it has played, so a later display change (Compact on or
  // off) never replays it.
  el.addEventListener?.("animationend", () => delete el.dataset.lands, { once: true });
}

/** A replacement (a look tried or removed, Esc, a new read): the final text at once, flashed when the value is new. */
export function replaceNumeral(el: NumeralEl, to: string): void {
  if (setNumeral(el, to)) flashNumeral(el);
}
