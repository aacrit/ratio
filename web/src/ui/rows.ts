// The reading as an argument (design/BRAND.md): each rule is a row with what
// was measured, the rule it was held against, and the advice. The measured
// and rule lines are never folded away. A row can also say how a tried look
// changed it ("was advice, now on the mark"). Rows arrive in order (the
// `argument` stagger) and their numerals count up as they land.

import type { Bins, AdviceLine, LineState } from "../engine/rules";
import { colourLabel } from "../engine/names";
import { RULEBOOK } from "../engine/rulebook";
import { countTo } from "./count";

// The rule each line is held against, said once, from the rulebook.
export const RULE_COPY = Object.fromEntries(Object.entries(RULEBOOK).map(([id, e]) => [id, e.rule])) as Record<AdviceLine["rule"], string>;

export const STATE_WORDS: Record<LineState, string> = { golden: "on the mark", neutral: "fine", advice: "advice" };

export function measuredCopy(line: AdviceLine, bins: Bins): string {
  switch (line.rule) {
    case "volume":
      return bins.fit ? `Upper piece ${bins.fit.top.toFixed(2)}× the shoulder width at mid-torso; both legs ${bins.fit.legs.toFixed(2)}× at the knee.` : "Volume was not measured.";
    case "legline":
      return "Lightness of the lower piece against the shoes.";
    case "proportion":
      return bins.proportion === null
        ? "Upper and lower pieces measure as one colour, head to feet."
        : `The break sits at ${bins.proportion.toFixed(2)} of the height, head to feet.`;
    case "harmony":
      return `${bins.palette.length} colours in the outfit: ${bins.palette.map(colourLabel).join(", ")}.`;
    case "value":
      return `Lightness of each colour: ${bins.palette.map((p) => p.L.toFixed(2)).join(", ")}.`;
    case "shares":
      return `Share of the outfit's area: ${bins.palette.map((p) => p.share.toFixed(2)).join(", ")}.`;
    case "chroma":
      return `Chroma of each colour: ${bins.palette.map((p) => p.C.toFixed(2)).join(", ")}.`;
  }
}

export function para(label: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  const b = document.createElement("b");
  b.textContent = label;
  p.append(b, " ", text);
  return p;
}

const lchCss = ({ L, C, h }: { L: number; C: number; h: number }) => `oklch(${L.toFixed(3)} ${C.toFixed(3)} ${h})`;

/** A palette as a strip, each colour as wide as its share. The photo's own colours carry it. */
export function paletteStrip(bins: Bins, label = "The outfit's palette"): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "palette";
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label", `${label}: ${bins.palette.map((p) => `${colourLabel(p)} ${Math.round(p.share * 100)}%`).join(", ")}`);
  for (const sw of bins.palette) {
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
  /** The measurement each rule showed before, so a changed numeral counts from it. */
  beforeMeasured?: Map<AdviceLine["rule"], string>;
  /** Extra controls for a row (the tuck button), by rule. */
  extra?: Partial<Record<AdviceLine["rule"], HTMLElement>>;
}

/** The state word for a row, with borderline said. */
export const stateLabel = (line: AdviceLine): string => (line.borderline ? `${STATE_WORDS[line.state]}, borderline` : STATE_WORDS[line.state]);

/**
 * Renders the rows. The numerals count up once the rows are shown
 * (`list.classList.add("in")` by the caller); call `land()` for that.
 */
export function renderRows(list: HTMLOListElement, lines: AdviceLine[], bins: Bins, opts: RowOptions = {}): { land: () => void } {
  list.classList.remove("in");
  const counts: (() => void)[] = [];
  list.replaceChildren(
    ...lines.map((line, i) => {
      const li = document.createElement("li");
      li.className = "row";
      li.style.setProperty("--i", String(i));
      li.dataset.state = line.borderline ? "borderline" : line.state;
      const was = opts.before?.get(line.rule);
      if (was && was !== line.state) li.dataset.changed = "";
      const head = document.createElement("p");
      head.className = "row-h";
      const title = document.createElement("span");
      title.className = "row-t";
      title.textContent = line.title;
      const state = document.createElement("span");
      state.className = "row-s";
      state.textContent = stateLabel(line);
      const measured = document.createElement("span");
      measured.className = "row-n";
      measured.dataset.ratio = "";
      measured.textContent = line.measured;
      const wasMeasured = opts.beforeMeasured?.get(line.rule);
      // Count from the old value when a look changed it; from zero on a fresh read; not at all when unchanged.
      if (opts.beforeMeasured === undefined) counts.push(() => countTo(measured, line.measured));
      else if (wasMeasured !== undefined && wasMeasured !== line.measured) counts.push(() => countTo(measured, line.measured, wasMeasured));
      const titles = document.createElement("span");
      titles.className = "row-tt";
      titles.append(title, state);
      head.append(titles, measured);
      const body = document.createElement("div");
      body.className = "row-b";
      if (was && was !== line.state) {
        const change = document.createElement("p");
        change.className = "row-change";
        change.textContent = `Was ${STATE_WORDS[was]}, now ${STATE_WORDS[line.state]}.`;
        body.append(change);
      }
      body.append(para("Measured", measuredCopy(line, bins)), para("Rule", RULE_COPY[line.rule]), para("Advice", line.text));
      if (line.borderline) {
        const note = para("Borderline", "This measurement sits on the edge between two bands, so a slightly different photo may read the other way. Both readings apply.");
        note.className = "row-borderline";
        body.append(note);
      }
      const extra = opts.extra?.[line.rule];
      if (extra) body.append(extra);
      li.append(head, body);
      return li;
    }),
  );
  return {
    land: () => {
      list.classList.add("in");
      counts.forEach((c) => c());
    },
  };
}
