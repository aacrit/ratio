// The reading as an argument (design/BRAND.md): each rule is a row with what
// was measured, the rule it was held against, and the advice. Outside
// Compact mode (T3, ui/compact.ts) the measured and rule lines are never
// folded away; in Compact they collapse to name, band and numbers, and open
// on Enter or tap. A row can also say how a tried look changed it ("was
// advice, now on the mark"). Rows arrive in order (the `argument` stagger).
// The numeral is set once, in full (T3: it never counts, so it can never
// show a value that was not measured; only the hero numeral counts, in
// ui/looks.ts and ui/count.ts).

import type { Bins, AdviceLine, LineState } from "../engine/rules";
import { shownColour } from "../engine/constants";
import { byName, colourLabel } from "../engine/names";
import { measuredCopy } from "../engine/measured";
import { RULEBOOK } from "../engine/rulebook";
import { tuckable } from "../engine/rules";

// The rule each line is held against, said once, from the rulebook.
export const RULE_COPY = Object.fromEntries(Object.entries(RULEBOOK).map(([id, e]) => [id, e.rule])) as Record<AdviceLine["rule"], string>;

export const STATE_WORDS: Record<LineState, string> = { golden: "on the mark", neutral: "fine", advice: "advice", unread: "not read" };

/** The Measured line of each rule lives in the engine, beside the rules it quotes. */
export { measuredCopy };

export function para(label: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  const b = document.createElement("b");
  b.textContent = label;
  p.append(b, " ", text);
  return p;
}

const lchCss = (c: { L: number; C: number; h: number }) => {
  const { L, C, h } = shownColour(c);
  return `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h})`;
};

/** A palette as a strip, each colour as wide as its share. The photo's own colours carry it. */
export function paletteStrip(bins: Bins, label = "The outfit's palette"): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "palette";
  strip.setAttribute("role", "img");
  // One name, one entry: two greys are one grey with their shares summed.
  const named = byName(bins.palette);
  strip.setAttribute("aria-label", `${label}: ${named.map((p) => `${colourLabel(p)} ${p.share.toFixed(2)}`).join(", ")}`);
  for (const sw of named) {
    const chip = document.createElement("span");
    chip.style.flexGrow = String(sw.share);
    chip.style.background = lchCss(sw);
    chip.title = `${colourLabel(sw)}, ${sw.share.toFixed(2)}`;
    strip.append(chip);
  }
  return strip;
}

export interface RowOptions {
  /** The state each rule had before a tried look, to mark what changed. */
  before?: Map<AdviceLine["rule"], LineState>;
  /** Extra controls for a row (the tuck button), by rule. */
  extra?: Partial<Record<AdviceLine["rule"], HTMLElement>>;
  /** Where the one borderline marker for this reading is rendered, once, instead of inside every borderline row. */
  borderlineSlot?: HTMLElement;
}

/** Advice from a rule whose edges are set by hand says so beside it (RULEBOOK calibrated: false). */
export const adviceLabel = (line: AdviceLine): string => (line.state === "unread" ? "Why" : RULEBOOK[line.rule].calibrated ? "Advice" : "Advice, first estimate");

/** The state word for a row, with borderline said. */
export const stateLabel = (line: AdviceLine): string => (line.borderline ? `${STATE_WORDS[line.state]}, borderline` : STATE_WORDS[line.state]);

/** A row is open (its Measured/Rule/Advice showing) when compact mode is off, or when it has been opened. */
export const rowOpen = (compact: boolean, opened: boolean): boolean => !compact || opened;
const isRowOpen = (li: HTMLElement): boolean => rowOpen(document.body.dataset.compact !== undefined, li.dataset.open !== undefined);

/** Just enough of a row for syncRowsExpanded: its data-open flag and its head button. */
export interface RowLike {
  dataset: { open?: string };
  querySelector(sel: ".row-h"): { setAttribute(name: string, value: string): void } | null;
}

/** Re-says every row head's aria-expanded after Compact is toggled, so it matches what the CSS now shows. */
export function syncRowsExpanded(rows: Iterable<RowLike>, compact: boolean): void {
  for (const li of rows) li.querySelector(".row-h")?.setAttribute("aria-expanded", String(rowOpen(compact, li.dataset.open !== undefined)));
}

const BORDERLINE_EXPLAIN = "This measurement sits on the edge between two bands, so a slightly different photo may read the other way. Both readings apply.";

/** The one marker for a reading with any borderline row, opened on demand instead of repeated per row. */
function borderlineMarker(count: number): HTMLElement {
  const wrap = document.createElement("p");
  wrap.className = "borderline-marker";
  const button = document.createElement("button");
  button.type = "button";
  button.className = "btn ghost small";
  button.setAttribute("aria-expanded", "false");
  button.textContent = count > 1 ? `Borderline (${count})` : "Borderline";
  const explain = document.createElement("span");
  explain.className = "borderline-explain";
  explain.hidden = true;
  explain.textContent = BORDERLINE_EXPLAIN;
  button.addEventListener("click", () => {
    const open = button.getAttribute("aria-expanded") !== "true";
    button.setAttribute("aria-expanded", String(open));
    explain.hidden = !open;
  });
  wrap.append(button, explain);
  return wrap;
}

/** Renders the rows: each with a "Why?" link to its rule on the Rulebook. */
export function renderRows(list: HTMLOListElement, lines: AdviceLine[], bins: Bins, opts: RowOptions = {}): { land: () => void } {
  list.classList.remove("in");
  list.replaceChildren(
    ...lines.map((line, i) => {
      const li = document.createElement("li");
      li.className = "row";
      li.style.setProperty("--i", String(i));
      li.dataset.state = line.borderline ? "borderline" : line.state;
      const was = opts.before?.get(line.rule);
      if (was && was !== line.state) li.dataset.changed = "";
      const head = document.createElement("button");
      head.type = "button";
      head.className = "row-h";
      head.setAttribute("aria-expanded", String(isRowOpen(li)));
      const title = document.createElement("span");
      title.className = "row-t";
      title.textContent = line.title;
      const state = document.createElement("span");
      state.className = "row-s";
      state.textContent = stateLabel(line);
      const measured = document.createElement("span");
      measured.className = "row-n";
      measured.dataset.ratio = "";
      // The numeral is set once, in full: it never counts (T3, label at rest), so it can never show a value that was not measured.
      measured.textContent = line.measured;
      const titles = document.createElement("span");
      titles.className = "row-tt";
      titles.append(title, state);
      head.append(titles, measured);
      head.addEventListener("click", () => {
        const open = li.dataset.open === undefined;
        if (open) li.dataset.open = "";
        else delete li.dataset.open;
        head.setAttribute("aria-expanded", String(isRowOpen(li)));
      });
      const body = document.createElement("div");
      body.className = "row-b";
      if (was && was !== line.state) {
        const change = document.createElement("p");
        change.className = "row-change";
        change.textContent = `Was ${STATE_WORDS[was]}, now ${STATE_WORDS[line.state]}.`;
        body.append(change);
      }
      body.append(para("Measured", measuredCopy(line, bins)), para("Rule", RULE_COPY[line.rule]), para(adviceLabel(line), line.text));
      // An upper piece that opens down the front does not tuck: its row shows no tuck control.
      const extra = line.rule === "proportion" && !tuckable(bins) ? undefined : opts.extra?.[line.rule];
      if (extra) body.append(extra);
      const why = document.createElement("a");
      why.className = "row-why";
      why.href = `/rules#rule-${line.rule}`;
      why.textContent = "Why?";
      why.setAttribute("aria-label", `Why: ${line.title}, on the Rulebook`);
      body.append(why);
      li.append(head, body);
      return li;
    }),
  );
  if (opts.borderlineSlot) {
    const n = lines.filter((l) => l.borderline).length;
    opts.borderlineSlot.replaceChildren(...(n > 0 ? [borderlineMarker(n)] : []));
  }
  return {
    land: () => list.classList.add("in"),
  };
}
