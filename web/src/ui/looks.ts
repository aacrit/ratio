// Suggested looks and "try it". The engine proposes up to three looks
// (engine/looks.ts); each card says what changes and which readings improve.
// Trying one recolours the photo in the tab (tryon/recolour.ts, run in the
// read worker at display size), glides the break to the look's proportion,
// dresses the chalk figure, and re-renders the argument with the look's own
// reading, marking every row that changed. "As worn" puts everything back.
// Nothing leaves the tab.

import { readingHash } from "../engine/hash";
import { type Look, suggestLooks } from "../engine/looks";
import { lookPhrase, looksIntroOf, verdictOf as engineVerdict } from "../engine/verdict";
import { shownColour } from "../engine/constants";
import { colourLabel } from "../engine/names";
import { ENGINE_VERSION, type LineState } from "../engine/rules";
import { reducedMotion } from "../motion";
import type { Figure } from "../overlay";
import type { Read } from "../read";
import type { Reader } from "../reader";
import { chalkFigure } from "../tryon/figure";
import { type Bands, type PhotoPlan, refuseAll, refusedCardCopy, refusedCopy, refusedSwatches, showsOnPhoto } from "../tryon/recolour";
import { replaceNumeral, setNumeral } from "./count";
import { hashesOfShown, hashLine } from "./hashline";
import { STATE_WORDS, paletteStrip, renderRows, stateLabel } from "./rows";
import type { Sheet } from "./sheet";

export interface LooksDeps {
  read: Read;
  reader: Reader;
  figure: Figure;
  sheet: Sheet;
  rows: HTMLOListElement;
  section: HTMLElement;
  list: HTMLOListElement;
  /** The sheet head: the hero numeral, its eyebrow, the verdict. */
  heroN: HTMLElement;
  heroEyebrow: HTMLElement;
  verdict: HTMLElement;
  trying: HTMLElement;
  trial: HTMLElement;
  /** A visible aria-live line that says what changed ("Trying: navy for the lower piece"). */
  announce: HTMLElement;
  paletteSlot: HTMLElement;
  hash: HTMLElement;
  /** The compare control over the photo: as worn on the left, the look on the right. */
  wipe: HTMLInputElement;
  /** Rows extras for the reading as worn (the tuck button). */
  asWornExtras: () => Parameters<typeof renderRows>[3];
  /** Where the one borderline marker for whatever is shown now is rendered. */
  borderlineSlot: HTMLElement;
  onTried: () => void;
  /** Whatever is now on screen, as worn (look null) or a tried look: the Rulebook marks it. */
  onShown?: (shown: Shown, look: string | null) => void;
  /** Called in the same tick a look is tried or removed, before anything else changes: whatever described the last view (the saved line) is cleared. */
  onChange?: () => void;
}

/** The verdict reads as a judgement of a tried look, never of the outfit itself: "Trying navy for the lower piece: Works...". */
const tryingPrefix = (look: Look | null): string => (look ? `Trying ${lookPhrase(look.moves)}: ` : "");

/** In Compact the full verdict is hidden; its one-line toggle (ui/compact.ts) is what actually shows, so that's what a tried look must keep in view (review round 1). */
function summaryEl(verdict: HTMLElement): HTMLElement {
  if (document.body.dataset.compact === undefined) return verdict;
  return document.getElementById("verdict-compact-toggle") ?? verdict;
}

/** Scrolls the summary (the verdict) into view if a tried look pushed it off-screen; smooth unless reduced motion. */
function keepSummaryInView(verdict: HTMLElement): void {
  const el = summaryEl(verdict);
  const r = el.getBoundingClientRect();
  if (r.top >= 0 && r.bottom <= innerHeight) return;
  el.scrollIntoView({ behavior: reducedMotion() ? "auto" : "smooth", block: "nearest" });
}

const changeText = (from: LineState, to: LineState) => `${STATE_WORDS[from]} → ${STATE_WORDS[to]}`;

/** One "Show original" listener per read: each setupLooks call aborts the previous read's before adding its own. */
const backControllers = new WeakMap<HTMLButtonElement, AbortController>();

function swatchChip(m: { L: number; C: number; h: number }): HTMLElement {
  const c = shownColour(m);
  const chip = document.createElement("span");
  chip.className = "chip-swatch";
  chip.style.background = `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h})`;
  chip.title = colourLabel(m);
  return chip;
}

/** What is on screen now, for "Save as card": the outfit as worn or the tried look. */
export interface Shown {
  title: string;
  lines: Read["reading"]["lines"];
  bins: Read["reading"]["bins"];
  /** The reading hash of what is shown: the photo's as worn, the look's own when a look is tried. */
  hash: string;
  engine: string;
  /** A line for the card when the photo on it is not the look (a recolour refused as doubtful). */
  note?: string;
  /** On a tried look: the photo's own reading hash, which the card's footer names (T10). As worn it is `hash` itself. */
  photoHash?: string;
  /** On a tried look: the look's title, as its card is titled and the Rulebook names it, for the hash line and filename. */
  look?: string;
}

/** The plain verdict (engine/verdict.ts): whether it works, and the best look in everyday words. */
export const verdictOf = (lines: Read["reading"]["lines"], looks: Look[] = [], bins?: Read["reading"]["bins"]) => engineVerdict(lines, looks, bins);

/** The sheet head's eyebrow under the hero numeral: the rule and its state. */
export const heroEyebrowOf = (lines: Read["reading"]["lines"]) => `${lines[0].title}, ${stateLabel(lines[0])}`;

/** The card's note while the proportion advice's change is shown on the as-worn photo (a tuck, a belt or a shorter upper piece all move the break to the waist): the break line moved, the readings did not. */
export const TUCK_NOTE = "Shown with the break at the waist, where the advice moves it. The readings are as worn.";

/** The sheet head's three texts. */
export interface HeadEls {
  heroN: { textContent: string | null; dataset: DOMStringMap; getClientRects?: () => { length: number } };
  heroEyebrow: { textContent: string | null };
  verdict: { textContent: string | null };
}

/**
 * Writes the sheet head for a reading: the hero numeral final at once (T10:
 * never counted, never empty while the eyebrow shows), its state, the
 * eyebrow and the verdict, all in one tick. `arrive` is a read being shown
 * (no flash: the signature flashes it when the photo's label lands);
 * `replace` is a look tried or removed, which flashes a changed value.
 * Every reading surface (a read, a look, the chalk restore) goes through it.
 */
export function writeHead(els: HeadEls, lines: Read["reading"]["lines"], verdict: string, mode: "arrive" | "replace"): void {
  if (mode === "replace") replaceNumeral(els.heroN, lines[0].measured);
  else setNumeral(els.heroN, lines[0].measured);
  els.heroN.dataset.state = lines[0].borderline ? "borderline" : lines[0].state;
  els.heroEyebrow.textContent = heroEyebrowOf(lines);
  els.verdict.textContent = verdict;
}

export interface LooksApi {
  shown: () => Shown;
  settled: () => Promise<void>;
  /** Changes in the same tick a look is tried or removed, or the tuck is shown or hidden. */
  view: () => number;
  /** The as-worn tuck toggle (main.ts): a change of view, and the card marks it. */
  setTuck: (on: boolean) => void;
}

export function setupLooks(d: LooksDeps): LooksApi {
  const { read } = d;
  const looks = suggestLooks(read.reading.bins, read.reading.lines);
  d.verdict.textContent = verdictOf(read.reading.lines, looks, read.reading.bins);
  d.section.hidden = false;
  d.trying.hidden = true;
  d.trial.replaceChildren();
  const intro = d.section.querySelector<HTMLElement>(".looks-intro");
  const asWornShown: Shown = { title: "As worn", lines: read.reading.lines, bins: read.reading.bins, hash: read.hash, engine: read.reading.engine };
  let shown = asWornShown;
  let current: string | null = null;
  /** Bumped in the same tick a look is tried or removed (or the tuck toggled): the save row compares it to tell whether its card still matches the screen. */
  let view = 0;
  const changeView = () => {
    view++;
    d.onChange?.();
  };
  const setTuck = (on: boolean) => {
    if (current !== null) return; // the tuck button belongs to the as-worn rows only
    changeView();
    shown = on ? { ...asWornShown, note: TUCK_NOTE } : asWornShown;
  };

  if (!looks.length) {
    if (intro) intro.textContent = looksIntroOf(read.reading.lines, 0);
    d.list.replaceChildren();
    return { shown: () => shown, settled: () => Promise.resolve(), view: () => view, setTuck };
  }
  if (intro) intro.textContent = looksIntroOf(read.reading.lines, looks.length);

  // Where each piece may be found on the figure: the upper piece from the
  // crown to the break, the lower from the break to the ankle, the shoes in
  // the last few percent; any other swatch anywhere on the figure. In
  // reading-size rows, scaled to the display photo for the recolour.
  const m = read.measure;
  const h = m.bottom - m.top;
  const brk = m.breakRow ?? m.waistRow;
  const bandsAt = (k: number): Bands => {
    const band = (a: number, b: number): [number, number] => [a * k, b * k];
    return { upper: band(m.top, brk), lower: band(brk, m.bottom - h * 0.04), shoes: band(m.bottom - h * 0.08, m.bottom), other: band(m.top, m.bottom) };
  };
  const k = read.display.width / read.pixels.width;
  const bands = bandsAt(k);
  const box = { left: m.left * k, right: m.right * k, cast: m.cast };
  // Which of each look's colour moves the photo can show honestly, judged
  // once per look in the read worker at reading size, move by move. A failed
  // check refuses them all: the chalk figure still shows the look.
  const plans = new Map<string, Promise<PhotoPlan>>();
  const planOf = (look: Look) => {
    let plan = plans.get(look.id);
    if (!plan) {
      plan = d.reader.plan(read.pixels, read.fullMask, read.mask, { left: m.left, right: m.right, cast: m.cast }, bandsAt(1), read.palette, look.moves).catch(() => refuseAll(look.moves));
      plans.set(look.id, plan);
    }
    return plan;
  };
  const note = d.trying.querySelector<HTMLElement>(".trying-note");
  const noteAsBuilt = note?.textContent ?? "";
  const before = new Map(read.reading.lines.map((l) => [l.rule, l.state] as const));
  /** Each look's own reading hash, computed once. */
  const lookHashes = new Map<string, Promise<string>>();
  const lookHashOf = (look: Look) => {
    let hh = lookHashes.get(look.id);
    if (!hh) {
      hh = readingHash({ engine: ENGINE_VERSION, bins: look.bins });
      lookHashes.set(look.id, hh);
    }
    return hh;
  };
  const buttons = new Map<string, HTMLButtonElement>();
  const cards = new Map<string, HTMLElement>();
  /** The recoloured photo for each look, computed once in the worker. */
  const recoloured = new Map<string, Promise<Parameters<Figure["setLook"]>[0]>>();

  const setHead = (lines: Read["reading"]["lines"], bins: Read["reading"]["bins"], tried: Look | null) => {
    // Final at once, never counted (T10): a replaced numeral is never left mid-way.
    // As worn, the verdict names the best look; on a tried look, it judges that look and says so up front, never as a verdict on the outfit itself.
    writeHead(d, lines, tryingPrefix(tried) + verdictOf(lines, tried ? [] : looks, bins), "replace");
    keepSummaryInView(d.verdict);
  };

  const asWorn = async () => {
    changeView();
    current = null;
    shown = asWornShown;
    d.onShown?.(shown, null);
    buttons.forEach((b, id) => {
      b.setAttribute("aria-pressed", "false");
      b.textContent = "Try it";
      const look = looks.find((l) => l.id === id);
      if (look) b.setAttribute("aria-label", `Try ${lookPhrase(look.moves)}`);
    });
    cards.forEach((c) => delete c.dataset.on);
    d.trying.hidden = true;
    d.trial.replaceChildren();
    d.announce.textContent = "Showing the outfit as worn.";
    d.figure.showBreakAt(null);
    d.figure.setLook(null);
    d.wipe.hidden = true;
    document.body.dataset.compare = "off";
    setHead(read.reading.lines, read.reading.bins, null);
    renderRows(d.rows, read.reading.lines, read.reading.bins, { borderlineSlot: d.borderlineSlot, ...d.asWornExtras() }).land();
    d.paletteSlot.replaceChildren(paletteStrip(read.reading.bins));
    d.hash.textContent = hashLine(hashesOfShown(shown));
    d.hash.title = `Reading hash ${read.hash}`;
  };

  // The last try or "as worn" in flight, with its recolour: the card waits
  // for it, so a saved card always shows the photo its note describes.
  let pending: Promise<unknown> = Promise.resolve();
  const tryLook = async (look: Look) => {
    let landed: Promise<void> = Promise.resolve();
    if (current === look.id) return asWorn();
    changeView();
    current = look.id;
    buttons.forEach((b, id) => {
      b.setAttribute("aria-pressed", String(id === look.id));
      if (id === look.id) {
        b.textContent = "Show original";
        b.setAttribute("aria-label", "Show original");
      } else {
        b.textContent = "Try it";
        const other = looks.find((l) => l.id === id);
        if (other) b.setAttribute("aria-label", `Try ${lookPhrase(other.moves)}`);
      }
    });
    cards.forEach((c, id) => (id === look.id ? (c.dataset.on = "") : delete c.dataset.on));
    // The photo: colour moves only. The chalk figure: the whole look.
    // Colour moves show on the photo behind the wipe; a look of proportion
    // moves alone leaves the photo as worn and shows on the chalk figure.
    // Honesty is per move: the photo shows every colour move that passes;
    // one that fails (or has nothing on the photo to move, like shoes when
    // none were measured) is named and shown on the chalk figure only. A
    // doubtful recolour is never painted, so it can never reach a saved card.
    // The look's own reading hash comes with the plan, so the hash line
    // changes in the same tick as the numerals, never a beat after them.
    const [plan, hh] = await Promise.all([planOf(look), lookHashOf(look)]);
    if (current !== look.id) return;
    const painted = plan.paint.map((i) => look.moves[i]);
    const onPhoto = painted.length > 0 && showsOnPhoto(painted, read.palette);
    if (note) note.textContent = refusedCopy(look.moves, plan) ?? noteAsBuilt;
    if (onPhoto) {
      let job = recoloured.get(look.id);
      if (!job) {
        job = d.reader.recolour(read.display, read.mask, box, bands, read.palette, painted, refusedSwatches(look.moves, plan, read.palette));
        recoloured.set(look.id, job);
      }
      landed = job.then((pixels) => void (current === look.id && d.figure.setLook(pixels)));
    } else d.figure.setLook(null);
    d.wipe.hidden = !onPhoto;
    // Over the photo the pointer becomes a grip while a look can be compared.
    document.body.dataset.compare = onPhoto ? "on" : "off";
    d.wipe.value = "50";
    const brk = look.moves.find((m) => m.kind === "break");
    d.figure.showBreakAt(brk && brk.kind === "break" ? brk.to : null);
    const belt = look.moves.some((m) => m.kind === "break" && m.title.startsWith("Belt"));
    d.trial.replaceChildren(chalkFigure(look.bins, { belt, label: `The chalk figure dressed as the look: ${look.title}` }));
    d.trying.hidden = false;
    const title = d.trying.querySelector<HTMLElement>(".trying-title");
    if (title) title.textContent = look.title;
    const phrase = lookPhrase(look.moves);
    d.announce.textContent = `Trying: ${phrase}`;
    // A look the photo shows only in part says so on the card, naming the parts on the chalk figure.
    shown = { title: look.title, lines: look.lines, bins: look.bins, hash: hh, engine: ENGINE_VERSION, note: refusedCardCopy(look.moves, plan) ?? undefined, photoHash: read.hash, look: look.title };
    setHead(look.lines, look.bins, look);
    // One hash line for this view: the screen, the card and the Rulebook's chip all say it (ui/hashline.ts).
    d.hash.textContent = hashLine(hashesOfShown(shown));
    d.hash.title = `Photo reading hash ${read.hash}; look reading hash ${hh}`;
    d.onShown?.(shown, look.title);
    // On a phone the sheet drops to half so the photo and the wipe are in view.
    if (!d.sheet.isWide) d.sheet.snap("half");
    renderRows(d.rows, look.lines, look.bins, { before, borderlineSlot: d.borderlineSlot }).land();
    d.paletteSlot.replaceChildren(paletteStrip(look.bins, "The look's palette"));
    d.onTried();
    await landed;
  };

  const back = d.trying.querySelector<HTMLButtonElement>(".trying-back");
  if (back) {
    back.textContent = "Show original";
    // The button is static HTML, reused read after read: without this, each
    // read's setupLooks call would add one more listener on top of the
    // last's, and a click would call every previous read's asWorn() too.
    backControllers.get(back)?.abort();
    const ac = new AbortController();
    backControllers.set(back, ac);
    back.addEventListener("click", () => void (pending = asWorn()), { signal: ac.signal });
  }

  d.list.replaceChildren(
    ...looks.map((look, i) => {
      const li = document.createElement("li");
      li.className = "look";
      li.style.setProperty("--i", String(i));
      const head = document.createElement("div");
      head.className = "look-h";
      const swatches = document.createElement("span");
      swatches.className = "look-swatches";
      for (const mv of look.moves) if (mv.kind !== "break") swatches.append(swatchChip(mv));
      const title = document.createElement("h3");
      title.className = "look-title";
      title.textContent = look.title;
      head.append(swatches, title);

      const moves = document.createElement("p");
      moves.className = "look-moves";
      moves.textContent = [...look.moves.map((mv) => mv.detail), ...look.keeps].join(" ");

      const changes = document.createElement("ul");
      changes.className = "look-changes";
      for (const c of look.changes) {
        const item = document.createElement("li");
        item.dataset.to = c.to;
        const rule = document.createElement("b");
        rule.textContent = c.title;
        item.append(rule, " ", changeText(c.from, c.to));
        changes.append(item);
      }

      const button = document.createElement("button");
      button.type = "button";
      button.className = "btn";
      button.textContent = "Try it";
      button.setAttribute("aria-pressed", "false");
      button.setAttribute("aria-label", `Try ${lookPhrase(look.moves)}`);
      button.addEventListener("click", () => void (pending = tryLook(look)));
      buttons.set(look.id, button);
      cards.set(look.id, li);

      const why = document.createElement("a");
      why.className = "look-why";
      why.href = `/rules#rule-${look.changes[0]?.rule ?? "proportion"}`;
      why.textContent = "Why?";
      why.setAttribute("aria-label", `Why: ${look.title}, on the Rulebook`);

      const actions = document.createElement("div");
      actions.className = "look-actions";
      actions.append(why, button);

      const foot = document.createElement("div");
      foot.className = "look-foot";
      foot.append(changes, actions);
      li.append(head, moves, foot);
      return li;
    }),
  );
  // The cards arrive after the rows, settling one after another.
  requestAnimationFrame(() => d.list.classList.add("in"));
  return { shown: () => shown, settled: () => pending.then(() => undefined, () => undefined), view: () => view, setTuck };
}
