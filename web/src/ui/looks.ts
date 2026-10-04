// Suggested looks and "try it". The engine proposes up to three looks
// (engine/looks.ts); each card says what changes and which readings improve.
// Trying one recolours the photo in the tab (tryon/recolour.ts), glides the
// break to the look's proportion, dresses the chalk figure, and re-renders
// the argument with the look's own reading, marking every row that changed.
// "As worn" puts everything back. Nothing leaves the tab.

import { readingHash } from "../engine/hash";
import { type Look, suggestLooks } from "../engine/looks";
import { colourLabel } from "../engine/names";
import { assignPixels } from "../engine/palette";
import { ENGINE_VERSION, type LineState } from "../engine/rules";
import type { Figure } from "../overlay";
import type { Read } from "../read";
import { chalkFigure } from "../tryon/figure";
import { recolour, showsOnPhoto } from "../tryon/recolour";
import { STATE_WORDS, paletteStrip, renderRows } from "./rows";

export interface LooksDeps {
  read: Read;
  figure: Figure;
  rows: HTMLOListElement;
  section: HTMLElement;
  list: HTMLOListElement;
  trying: HTMLElement;
  trial: HTMLElement;
  paletteSlot: HTMLElement;
  hash: HTMLElement;
  /** Rows extras for the reading as worn (the tuck button). */
  asWornExtras: () => Parameters<typeof renderRows>[3];
  onTried: () => void;
}

const changeText = (from: LineState, to: LineState) => `${STATE_WORDS[from]} → ${STATE_WORDS[to]}`;

function swatchChip(c: { L: number; C: number; h: number }): HTMLElement {
  const chip = document.createElement("span");
  chip.className = "chip-swatch";
  chip.style.background = `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h})`;
  chip.title = colourLabel(c);
  return chip;
}

export function setupLooks(d: LooksDeps): void {
  const { read } = d;
  const looks = suggestLooks(read.reading.bins, read.reading.lines);
  d.section.hidden = false;
  d.trying.hidden = true;
  d.trial.replaceChildren();
  const intro = d.section.querySelector<HTMLElement>(".looks-intro");

  if (!looks.length) {
    if (intro) intro.textContent = "The rules would change nothing here. Every reading is on the mark or fine, so the look stands as it is.";
    d.list.replaceChildren();
    return;
  }
  if (intro) intro.textContent = `${looks.length === 1 ? "One look" : `${looks.length} looks`} the rules prefer, each judged by the same rulebook that read your outfit. Try one to see it on your photo.`;

  // Which swatch every pixel belongs to: computed once, only when needed.
  let owner: Int8Array | null = null;
  const owners = () => (owner ??= assignPixels(read.pixels, read.mask, read.measure, read.palette));
  const before = new Map(read.reading.lines.map((l) => [l.rule, l.state] as const));
  let current: string | null = null;
  const buttons = new Map<string, HTMLButtonElement>();

  const asWorn = async () => {
    current = null;
    buttons.forEach((b) => {
      b.setAttribute("aria-pressed", "false");
      b.textContent = "Try it";
    });
    d.trying.hidden = true;
    d.trial.replaceChildren();
    d.figure.showBreakAt(null);
    void d.figure.setPhoto(read.pixels);
    renderRows(d.rows, read.reading.lines, read.reading.bins, d.asWornExtras());
    d.rows.classList.add("in");
    d.paletteSlot.replaceChildren(paletteStrip(read.reading.bins));
    d.hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
  };

  const tryLook = async (look: Look) => {
    if (current === look.id) return asWorn();
    current = look.id;
    buttons.forEach((b, id) => {
      b.setAttribute("aria-pressed", String(id === look.id));
      b.textContent = id === look.id ? "As worn" : "Try it";
    });
    // The photo: colour moves only. The chalk figure: the whole look.
    if (showsOnPhoto(look.moves, read.palette)) void d.figure.setPhoto(recolour(read.pixels, owners(), read.palette, look.moves));
    else void d.figure.setPhoto(read.pixels);
    const brk = look.moves.find((m) => m.kind === "break");
    d.figure.showBreakAt(brk && brk.kind === "break" ? brk.to : null);
    const belt = look.moves.some((m) => m.kind === "break" && m.title.startsWith("Belt"));
    d.trial.replaceChildren(chalkFigure(look.bins, { belt, label: `The chalk figure dressed as the look: ${look.title}` }));
    d.trying.hidden = false;
    const title = d.trying.querySelector<HTMLElement>(".trying-title");
    if (title) title.textContent = look.title;
    renderRows(d.rows, look.lines, look.bins, { before });
    d.rows.classList.add("in");
    d.paletteSlot.replaceChildren(paletteStrip(look.bins, "The look's palette"));
    const h = await readingHash({ engine: ENGINE_VERSION, bins: look.bins });
    if (current === look.id) d.hash.textContent = `Trying a look. Same look, same reading. ${h.slice(0, 4)} · ${ENGINE_VERSION}`;
    d.onTried();
  };

  d.trying.querySelector<HTMLButtonElement>(".trying-back")?.addEventListener("click", () => void asWorn());

  d.list.replaceChildren(
    ...looks.map((look, i) => {
      const li = document.createElement("li");
      li.className = "look";
      const head = document.createElement("div");
      head.className = "look-h";
      const n = document.createElement("span");
      n.className = "look-n";
      n.dataset.numeral = "";
      n.textContent = String(i + 1);
      const title = document.createElement("h3");
      title.className = "look-title";
      title.textContent = look.title;
      head.append(n, title);

      const swatches = document.createElement("div");
      swatches.className = "look-swatches";
      for (const m of look.moves) if (m.kind !== "break") swatches.append(swatchChip(m));

      const moves = document.createElement("ul");
      moves.className = "look-moves";
      for (const m of look.moves) {
        const item = document.createElement("li");
        item.textContent = m.detail;
        moves.append(item);
      }

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
      button.addEventListener("click", () => void tryLook(look));
      buttons.set(look.id, button);

      li.append(head, swatches, moves, changes, button);
      return li;
    }),
  );
}
