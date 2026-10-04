// The chalk figure: the brand's abstract figure (design/BRAND.md), dressed
// in the outfit's measured palette at a look's proportions. It shows what a
// photo cannot show honestly: where a tuck or a belt moves the break. Never
// a body shape of the person; one standard figure for everyone, in chalk.
// Vector only. Colours are the measured OKLab values, never literals.

import type { Bins } from "../engine/rules";
import { GOLDEN, ratioText } from "../engine/rules";
import { pieces } from "../engine/looks";
import { shownColour } from "../engine/constants";

const NS = "http://www.w3.org/2000/svg";
const CROWN = 22;
const SOLE = 420;
const yOf = (r: number) => CROWN + (SOLE - CROWN) * r;

const lab = (c: { L: number; C: number; h: number }) => {
  const { L, C, h } = shownColour(c);
  const a = C * Math.cos((h * Math.PI) / 180), b = C * Math.sin((h * Math.PI) / 180);
  return `oklab(${L.toFixed(3)} ${a.toFixed(3)} ${b.toFixed(3)})`;
};

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent?: Element): SVGElementTagNameMap[K] {
  const node = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, String(v));
  parent?.append(node);
  return node;
}

export interface FigureOptions {
  /** Draw a belt at the break (a "Belt at the waist" look). */
  belt?: boolean;
  label?: string;
  /** Chalk outline and tape only, no garments: the drop cloth before a photo. */
  outline?: boolean;
}

/**
 * The figure for a set of bins: upper piece from the shoulders to the break,
 * lower piece from the break to the ankle, shoes, all in their measured
 * colours. A one-column outfit has no break: one colour shoulder to ankle.
 */
export function chalkFigure(b: Bins, opts: FigureOptions = {}): SVGSVGElement {
  const svg = el("svg", { viewBox: "0 0 236 440", class: "chalk-figure", role: "img", "aria-label": opts.label ?? "The chalk figure in the outfit's colours" });
  const g = el("g", { transform: "translate(36 0)" }, svg);
  const p = pieces(b);
  const upper = p.upper >= 0 ? b.palette[p.upper] : b.top;
  const lower = p.lower >= 0 ? b.palette[p.lower] : b.bottom;
  const shoes = p.shoes >= 0 ? b.palette[p.shoes] : null;
  const r = b.proportion ?? b.waist;
  const by = Math.max(150, Math.min(330, yOf(r)));

  // Garments first, then the chalk outline over them.
  if (opts.outline) {
    const o = el("g", { class: "chalk" }, g);
    el("path", { d: "M93 76 Q100 80 107 76 L140 86 L152 98 L147 152 L136 149 L146 217 L54 217 L64 149 L53 152 L48 98 L60 86 Z M54 217 L58 410 M146 217 L142 410 M100 263 V410" }, o);
  }
  const lowerFill = b.proportion === null ? lab(upper) : lab(lower);
  if (!opts.outline) el("path", { d: `M54 ${by} L146 ${by} L142 410 L106 410 L100 ${by + 46} L94 410 L58 410 Z`, fill: lowerFill, class: "garment" }, g);
  if (!opts.outline) el("path", { d: `M93 76 Q100 80 107 76 L140 86 L152 98 L147 152 L136 149 L${by > 200 ? 152 : 146} ${by} L${by > 200 ? 48 : 54} ${by} L64 149 L53 152 L48 98 L60 86 Z`, fill: lab(upper), class: "garment" }, g);
  if (shoes && !opts.outline) {
    el("rect", { x: 50, y: 410, width: 44, height: 10, rx: 5, fill: lab(shoes), class: "garment" }, g);
    el("rect", { x: 106, y: 410, width: 44, height: 10, rx: 5, fill: lab(shoes), class: "garment" }, g);
  }
  const outline = el("g", { class: "chalk" }, g);
  el("circle", { cx: 100, cy: 44, r: 22 }, outline);
  el("path", { d: "M93 65 V76 M107 65 V76 M50 102 L44 232 M150 102 L156 232" }, outline);
  if (!shoes) el("path", { d: "M50 415 H94 M106 415 H150" }, outline);
  if (opts.belt) el("path", { d: `M52 ${by} H148`, class: "belt" }, g);

  // The tape at the side, the golden tick and the break with its ratio.
  const tape = el("g", { class: "fig-tape" }, g);
  el("path", { d: `M24 ${CROWN} V${SOLE}` }, tape);
  for (let i = 0; i <= 10; i++) el("path", { d: `M${i % 5 ? 20 : 17} ${yOf(i / 10)} H24` }, tape);
  el("path", { d: `M24 ${yOf(GOLDEN)} H34`, class: Math.abs(r - GOLDEN) <= 0.04 ? "fig-section on" : "fig-section" }, g);
  if (b.proportion !== null) {
    el("path", { d: `M24 ${by} H170`, class: "fig-break" }, g);
    // Above the break, right-aligned inside the frame.
    const t = el("text", { x: 170, y: by - 5, "text-anchor": "end", class: "fig-ratio" }, g);
    t.textContent = ratioText(b.proportion);
  }
  return svg;
}
