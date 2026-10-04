// The reading as an argument (design/BRAND.md): each rule is a row with what
// was measured, the rule it was held against, and the advice. The measured
// and rule lines are never folded away. A row can also say how a tried look
// changed it ("was advice, now on the mark").

import type { Bins, AdviceLine, LineState } from "../engine/rules";
import { colourLabel } from "../engine/names";

// The rule each line is held against, said once.
export const RULE_COPY: Record<AdviceLine["rule"], string> = {
  proportion: "A break near a third (0.333) or the golden section (0.382) of the height reads as composed; near-equal halves read as boxy.",
  harmony: "Matsuda's hue templates (monochromatic, complementary, analogous, right-angle, split, double complementary, half wheel), fitted on the perceptual OKLCH wheel. A palette inside one reads as harmonious.",
  value: "Lightness carries form before hue does. A darker value below a lighter one grounds a figure; the widest lightness edge draws the eye first.",
  shares: "Colour by area: one dominant, one secondary, one accent, near 0.60 · 0.30 · 0.10. Equal shares compete for the lead.",
  chroma: "One saturated colour among muted ones reads as a single voice. Complements at equal lightness vibrate where they meet (Albers).",
};

export const STATE_WORDS: Record<LineState, string> = { golden: "on the mark", neutral: "fine", advice: "advice" };

export function measuredCopy(line: AdviceLine, bins: Bins): string {
  switch (line.rule) {
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
  /** Extra controls for a row (the tuck button), by rule. */
  extra?: Partial<Record<AdviceLine["rule"], HTMLElement>>;
}

export function renderRows(list: HTMLOListElement, lines: AdviceLine[], bins: Bins, opts: RowOptions = {}): void {
  list.classList.remove("in");
  list.replaceChildren(
    ...lines.map((line) => {
      const li = document.createElement("li");
      li.className = "row";
      li.dataset.state = line.borderline ? "borderline" : line.state;
      const was = opts.before?.get(line.rule);
      if (was && was !== line.state) li.dataset.changed = "";
      const head = document.createElement("p");
      head.className = "row-h";
      const title = document.createElement("span");
      title.className = "row-t";
      title.textContent = line.title;
      const measured = document.createElement("span");
      measured.className = "row-n";
      measured.dataset.ratio = "";
      measured.textContent = line.measured;
      head.append(title, measured);
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
}
