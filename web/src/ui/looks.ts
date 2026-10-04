// Suggested looks and "try it". The engine proposes up to three looks
// (engine/looks.ts); each card says what changes and which readings improve.
// Trying one recolours the photo in the tab (tryon/recolour.ts, run in the
// read worker at display size), glides the break to the look's proportion,
// dresses the chalk figure, and re-renders the argument with the look's own
// reading, marking every row that changed. "As worn" puts everything back.
// Nothing leaves the tab.

import { readingHash } from "../engine/hash";
import { type Look, suggestLooks } from "../engine/looks";
import { verdictOf as engineVerdict } from "../engine/verdict";
import { shownColour } from "../engine/constants";
import { colourLabel } from "../engine/names";
import { ENGINE_VERSION, type LineState } from "../engine/rules";
import type { Figure } from "../overlay";
import type { Read } from "../read";
import type { Reader } from "../reader";
import { chalkFigure } from "../tryon/figure";
import { type Bands, type PhotoPlan, refuseAll, refusedCardCopy, refusedCopy, refusedSwatches, showsOnPhoto } from "../tryon/recolour";
import { countTo } from "./count";
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
  paletteSlot: HTMLElement;
  hash: HTMLElement;
  /** The compare control over the photo: as worn on the left, the look on the right. */
  wipe: HTMLInputElement;
  /** Rows extras for the reading as worn (the tuck button). */
  asWornExtras: () => Parameters<typeof renderRows>[3];
  onTried: () => void;
  /** Whatever is now on screen, as worn (look null) or a tried look: the Rulebook marks it. */
  onShown?: (shown: Shown, look: string | null) => void;
}

const changeText = (from: LineState, to: LineState) => `${STATE_WORDS[from]} → ${STATE_WORDS[to]}`;

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
  hash: string;
  engine: string;
  /** A line for the card when the photo on it is not the look (a recolour refused as doubtful). */
  note?: string;
}

/** The plain verdict (engine/verdict.ts): whether it works, and the best look in everyday words. */
export const verdictOf = (lines: Read["reading"]["lines"], looks: Look[] = []) => engineVerdict(lines, looks);

/** The sheet head's eyebrow under the hero numeral: the rule and its state. */
export const heroEyebrowOf = (lines: Read["reading"]["lines"]) => `${lines[0].title}, ${stateLabel(lines[0])}`;

export function setupLooks(d: LooksDeps): { shown: () => Shown; settled: () => Promise<void> } {
  const { read } = d;
  const looks = suggestLooks(read.reading.bins, read.reading.lines);
  d.verdict.textContent = verdictOf(read.reading.lines, looks);
  d.section.hidden = false;
  d.trying.hidden = true;
  d.trial.replaceChildren();
  const intro = d.section.querySelector<HTMLElement>(".looks-intro");
  const asWornShown: Shown = { title: "As worn", lines: read.reading.lines, bins: read.reading.bins, hash: read.hash, engine: read.reading.engine };
  let shown = asWornShown;

  if (!looks.length) {
    if (intro) intro.textContent = "The rules would change nothing here. Every reading is on the mark or fine, so the look stands as it is.";
    d.list.replaceChildren();
    return { shown: () => shown, settled: () => Promise.resolve() };
  }
  if (intro) intro.textContent = `${looks.length === 1 ? "One look" : `${looks.length} looks`} the rules prefer, judged by the same rulebook. Try one on the photo.`;

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
  const box = { left: m.left * k, right: m.right * k };
  // Which of each look's colour moves the photo can show honestly, judged
  // once per look in the read worker at reading size, move by move. A failed
  // check refuses them all: the chalk figure still shows the look.
  const plans = new Map<string, Promise<PhotoPlan>>();
  const planOf = (look: Look) => {
    let plan = plans.get(look.id);
    if (!plan) {
      plan = d.reader.plan(read.pixels, read.fullMask, read.mask, { left: m.left, right: m.right }, bandsAt(1), read.palette, look.moves).catch(() => refuseAll(look.moves));
      plans.set(look.id, plan);
    }
    return plan;
  };
  const note = d.trying.querySelector<HTMLElement>(".trying-note");
  const noteAsBuilt = note?.textContent ?? "";
  const before = new Map(read.reading.lines.map((l) => [l.rule, l.state] as const));
  let current: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();
  const cards = new Map<string, HTMLElement>();
  /** The recoloured photo for each look, computed once in the worker. */
  const recoloured = new Map<string, Promise<Parameters<Figure["setLook"]>[0]>>();

  const setHead = (lines: Read["reading"]["lines"], fromLines: Read["reading"]["lines"]) => {
    countTo(d.heroN, lines[0].measured, fromLines[0].measured);
    d.heroN.dataset.state = lines[0].borderline ? "borderline" : lines[0].state;
    d.heroEyebrow.textContent = heroEyebrowOf(lines);
    // As worn, the verdict names the best look; on a tried look, it judges that look.
    d.verdict.textContent = verdictOf(lines, lines === read.reading.lines ? looks : []);
  };

  const asWorn = async () => {
    const from = shown.lines;
    current = null;
    shown = asWornShown;
    d.onShown?.(shown, null);
    buttons.forEach((b) => {
      b.setAttribute("aria-pressed", "false");
      b.textContent = "Try it";
    });
    cards.forEach((c) => delete c.dataset.on);
    d.trying.hidden = true;
    d.trial.replaceChildren();
    d.figure.showBreakAt(null);
    d.figure.setLook(null);
    d.wipe.hidden = true;
    document.body.dataset.compare = "off";
    setHead(read.reading.lines, from);
    renderRows(d.rows, read.reading.lines, read.reading.bins, { beforeMeasured: new Map(from.map((l) => [l.rule, l.measured])), ...d.asWornExtras() }).land();
    d.paletteSlot.replaceChildren(paletteStrip(read.reading.bins));
    d.hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
  };

  // The last try or "as worn" in flight, with its recolour: the card waits
  // for it, so a saved card always shows the photo its note describes.
  let pending: Promise<unknown> = Promise.resolve();
  const tryLook = async (look: Look) => {
    let landed: Promise<void> = Promise.resolve();
    if (current === look.id) return asWorn();
    const from = shown.lines;
    current = look.id;
    buttons.forEach((b, id) => {
      b.setAttribute("aria-pressed", String(id === look.id));
      b.textContent = id === look.id ? "As worn" : "Try it";
    });
    cards.forEach((c, id) => (id === look.id ? (c.dataset.on = "") : delete c.dataset.on));
    // The photo: colour moves only. The chalk figure: the whole look.
    // Colour moves show on the photo behind the wipe; a look of proportion
    // moves alone leaves the photo as worn and shows on the chalk figure.
    // Honesty is per move: the photo shows every colour move that passes;
    // one that fails (or has nothing on the photo to move, like shoes when
    // none were measured) is named and shown on the chalk figure only. A
    // doubtful recolour is never painted, so it can never reach a saved card.
    const plan = await planOf(look);
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
    setHead(look.lines, from);
    // On a phone the sheet drops to half so the photo and the wipe are in view.
    if (!d.sheet.isWide) d.sheet.snap("half");
    renderRows(d.rows, look.lines, look.bins, { before, beforeMeasured: new Map(from.map((l) => [l.rule, l.measured])) }).land();
    d.paletteSlot.replaceChildren(paletteStrip(look.bins, "The look's palette"));
    const hh = await readingHash({ engine: ENGINE_VERSION, bins: look.bins });
    // A look the photo shows only in part says so on the card, naming the parts on the chalk figure.
    if (current === look.id) {
      shown = { title: look.title, lines: look.lines, bins: look.bins, hash: hh, engine: ENGINE_VERSION, note: refusedCardCopy(look.moves, plan) ?? undefined };
      d.onShown?.(shown, look.title);
    }
    if (current === look.id) d.hash.textContent = `Trying a look. Same look, same reading. ${hh.slice(0, 4)} · ${ENGINE_VERSION}`;
    d.onTried();
    await landed;
  };

  d.trying.querySelector<HTMLButtonElement>(".trying-back")?.addEventListener("click", () => void (pending = asWorn()));

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
      moves.textContent = look.moves.map((mv) => mv.detail).join(" ");

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
      button.addEventListener("click", () => void (pending = tryLook(look)));
      buttons.set(look.id, button);
      cards.set(look.id, li);

      const foot = document.createElement("div");
      foot.className = "look-foot";
      foot.append(changes, button);
      li.append(head, moves, foot);
      return li;
    }),
  );
  // The cards arrive after the rows, settling one after another.
  requestAnimationFrame(() => d.list.classList.add("in"));
  return { shown: () => shown, settled: () => pending.then(() => undefined, () => undefined) };
}
