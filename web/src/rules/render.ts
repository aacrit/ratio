// The Rulebook page's markup, rendered at build time from RULEBOOK and the
// engine's constants (web/vite.config.ts puts it into rules.html), so every
// word and every edge on the page comes from the one object the engine and
// the read screen use, and the page reads in full before any script runs.
// Pure string building: no DOM. The page's script (web/src/rules.ts) then
// makes the instruments live and marks the visitor's last read.

import { TEMPLATES } from "../engine/colour-rules";
import { RULEBOOK, type RuleEntry, type RuleId } from "../engine/rulebook";
import { ENGINE_VERSION, GOLDEN, PROPORTION_BANDS } from "../engine/rules";
import {
  HARMONY_EXAMPLE,
  PROPORTION_EDGES,
  PROPORTION_LABELS,
  PROPORTION_RANGE,
  PROP_GEOM,
  RING,
  RULE_ORDER,
  SCALE_LAYOUT,
  SCALE_X,
  SHARES_REFERENCE,
  type ScaleDef,
  countWord,
  pairText,
  proportionAt,
  proportionNote,
  propY,
  scaleById,
  scaleNote,
  scaleX,
  sectorPath,
} from "./model";

export const PROVENANCE =
  "The canons cited here (Euclid's section, the golden ratio, Dürer, Matsuda's templates) are European traditions, one lineage among many; the rulebook names its sources so you can weigh them.";
export const LEDE = "Every reading is held against these and nothing else. Drag an instrument to see where a band ends. Your last read in this tab is marked on each one.";
export const NO_READ_CHIP = "Read a photo and your values appear on each instrument.";
export const DRILL_SUMMARY = "The maths, the edges, the sources";
export const UNCALIBRATED = "calibrated: no, first estimates";
export const UNCALIBRATED_NOTE = 'The edges are first estimates. The labelled fixture set (risk R1) sets them, and this line changes to "calibrated" when it has.';

const ESC: Record<string, string> = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
export const esc = (s: string | number): string => String(s).replace(/[&<>"']/g, (c) => ESC[c]);
const f1 = (n: number) => n.toFixed(1);

// ---- Instruments --------------------------------------------------------------

function proportionInstrument(): string {
  const { crown, sole, tapeX, handleEnd } = PROP_GEOM;
  const start = proportionAt(0.38);
  const ticks = Array.from({ length: 11 }, (_, i) => {
    const y = crown + ((sole - crown) * i) / 10;
    return `M${i % 5 === 0 ? 17 : 20} ${f1(y)} H24`;
  }).join(" ");
  const edges = PROPORTION_EDGES.map((e) => `M62 ${f1(propY(e))} H118`).join(" ");
  // Beside the tape the long name is shortened, as in the mock, so it fits the column.
  const labels = PROPORTION_BANDS.map((b, i) => {
    const y = Math.min(sole - 4, Math.max(crown + 10, propY((b.from + Math.min(1, b.to)) / 2) + 3));
    return `<text x="86" y="${f1(y)}" text-anchor="end" class="band" data-band="${i}">${esc(b.id === "golden-long" ? "section, below" : PROPORTION_LABELS[b.id])}</text>`;
  }).join("");
  const golden = [GOLDEN, 1 - GOLDEN].map((g) => `M${tapeX} ${f1(propY(g))} H${tapeX + 12}`).join(" ");
  return `<div class="instrument-wrap">
<svg class="instrument" data-instrument="proportion" viewBox="0 0 320 440" role="img" aria-label="The proportion instrument: a chalk figure with the tape from the crown to the soles; the break line can be dragged along the figure, and the ratio and its band update">
<g transform="translate(96 0)"><g class="chalk"><path d="M93 76 Q100 80 107 76 L140 86 L152 98 L147 152 L136 149 L146 217 L54 217 L64 149 L53 152 L48 98 L60 86 Z M54 217 L58 410 M146 217 L142 410 M100 263 V410" /><circle cx="100" cy="44" r="22" /><path d="M93 65 V76 M107 65 V76 M50 102 L44 232 M150 102 L156 232 M50 415 H94 M106 415 H150" /></g>
<g class="tape"><path d="M24 ${crown} V${sole} ${ticks}" /></g></g>
<path class="faint dashed" d="${edges}" />
${labels}
<path class="mark" d="${golden}" />
<g class="yours-layer" data-yours-layer="proportion"></g>
<g class="prop-handle" data-handle="proportion" transform="translate(0 ${f1(propY(start.r))})"><path d="M${tapeX} 0 H${handleEnd}" class="tape" stroke-width="2" /><circle cx="${handleEnd}" cy="0" r="9" class="handle" /><text x="${handleEnd - 12}" y="-8" text-anchor="end" class="n" data-readout="proportion">${esc(pairText(start.r))}</text></g>
</svg>
<input class="range-hidden" type="range" data-range="proportion" min="${PROPORTION_RANGE.min}" max="${PROPORTION_RANGE.max}" step="${PROPORTION_RANGE.step}" value="${start.r}" aria-label="The break, as a fraction of the height from the crown" aria-valuetext="${esc(`${pairText(start.r)}, ${start.label}`)}" />
</div>`;
}

function scaleGroup(s: ScaleDef, y: number): string {
  const edges = s.edges.map((e) => `M${f1(scaleX(s, e))} ${y - 6} V${y + 6}`).join(" ");
  const edgeText = s.edges.map((e) => `<text x="${f1(scaleX(s, e))}" y="${y + 20}" text-anchor="middle">${esc(e.toFixed(2))}</text>`).join("");
  const stops = [s.min, ...s.edges, s.max];
  const bands = s.bands
    .map((name, i) => {
      const first = i === 0;
      const last = i === s.bands.length - 1;
      const x = first ? SCALE_X.from : last ? SCALE_X.to : (scaleX(s, stops[i]) + scaleX(s, stops[i + 1])) / 2;
      return `<text x="${f1(x)}" y="${y - 12}" text-anchor="${first ? "start" : last ? "end" : "middle"}" class="band" data-band="${i}">${esc(name)}</text>`;
    })
    .join("");
  return `<g data-scale="${s.id}"><text x="${SCALE_X.from}" y="${y - 32}" class="band caption">${esc(s.title)}</text>${bands}
<path class="tape" d="M${SCALE_X.from} ${y} H${SCALE_X.to}" /><path class="faint" d="${edges}" />${edgeText}
<g class="yours-layer" data-yours-layer="${s.id}"></g>
<g class="scale-handle" data-handle="${s.id}" transform="translate(${f1(scaleX(s, s.start))} 0)"><circle cx="0" cy="${y}" r="8" class="handle" /></g></g>`;
}

function rangeFor(s: ScaleDef): string {
  return `<input class="range-hidden" type="range" data-range="${s.id}" min="${s.min}" max="${s.max}" step="${s.step}" value="${s.start}" aria-label="${esc(s.label)}" aria-valuetext="${esc(scaleNote(s, s.start))}" />`;
}

const LABELS: Partial<Record<RuleId, string>> = {
  volume: "The volume instrument: two scales, the upper piece's width over the shoulders and both legs' width at the knee, each with its bands; drag a handle to see where a band ends",
  legline: "The leg line instrument: the lightness gap between the lower piece and the shoes, against the edge where the line stops running on; drag the handle to see where it ends",
  value: "The value instrument: the palette's lightness range against its low, medium and high edges, over a lightness scale; drag the handle to see where a band ends",
  chroma: "The chroma instrument: a colour's chroma against the neutral and saturated edges, and a worked pair of complements at equal lightness; drag the handle to see where a band ends",
};

/** A lightness strip from black to white (the gradient's stops come from the token file). */
function lightnessStrip(id: string, y: number, caption: string): string {
  return `<defs><linearGradient id="ls-${id}" x1="0" x2="1"><stop offset="0" class="ls-dark" /><stop offset="1" class="ls-light" /></linearGradient></defs>
<text x="${SCALE_X.from}" y="${y - 10}" class="band caption">${esc(caption)}</text>
<rect x="${SCALE_X.from}" y="${y}" width="${SCALE_X.to - SCALE_X.from}" height="10" rx="3" fill="url(#ls-${id})" />
<text x="${SCALE_X.from}" y="${y + 24}">0</text><text x="${SCALE_X.to}" y="${y + 24}" text-anchor="end">1</text>
<g class="yours-layer" data-yours-layer="${id}-strip"></g>`;
}

function scaleInstrument(rule: RuleId): string {
  const layout = SCALE_LAYOUT[rule] ?? [];
  const groups = layout.map(({ id, y }) => scaleGroup(scaleById(id), y)).join("\n");
  let extra = "";
  if (rule === "legline") extra = lightnessStrip("legline", 124, "lightness, lower piece and shoes");
  if (rule === "value") extra = lightnessStrip("value", 124, "lightness of each colour");
  if (rule === "chroma")
    extra = `<text x="${SCALE_X.from}" y="124" class="band caption">vibration: complements within 0.08 in lightness</text>
<circle cx="40" cy="150" r="10" class="vib-a" /><circle cx="56" cy="150" r="10" class="vib-b" /><text x="74" y="154">both at 0.55: they vibrate</text>`;
  return `<div class="instrument-wrap">
<svg class="instrument" data-instrument="${rule}" viewBox="0 0 256 200" role="img" aria-label="${esc(LABELS[rule] ?? rule)}">
${groups}
${extra}
<text x="${SCALE_X.from}" y="194" class="yours" data-yours-label="${rule}"></text>
</svg>
${layout.map(({ id }) => rangeFor(scaleById(id))).join("\n")}
</div>`;
}

function harmonyInstrument(): string {
  const t = TEMPLATES.find((x) => x.id === HARMONY_EXAMPLE.id) ?? TEMPLATES[0];
  const sectors = t.sectors.map(([off, w]) => `<path class="sector" d="${sectorPath(HARMONY_EXAMPLE.rot + off - w / 2, HARMONY_EXAMPLE.rot + off + w / 2)}" />`).join("");
  return `<div class="instrument wheel" data-instrument="harmony" role="img" aria-label="The harmony instrument: the OKLCH hue ring with a template's sectors; with a read, the template the engine fitted and each of the outfit's hues as a dot in its own colour">
<div class="ring" aria-hidden="true"></div>
<svg viewBox="0 0 256 200" width="100%" aria-hidden="true">
<text x="14" y="22" class="band caption">hue ring, OKLCH</text>
<g data-harmony-example="">${sectors}<text x="14" y="194" class="band">example: ${esc(t.name)}</text></g>
<g class="yours-layer" data-yours-layer="harmony"></g>
<circle cx="${RING.cx}" cy="${RING.cy}" r="2" class="mark-fill" />
</svg>
</div>`;
}

function sharesInstrument(): string {
  const w = SCALE_X.to - SCALE_X.from;
  let x = SCALE_X.from;
  const dividers: string[] = [];
  const labels: string[] = [];
  SHARES_REFERENCE.forEach((s, i) => {
    labels.push(`<text x="${f1(x + (w * s) / 2)}" y="72" text-anchor="middle">${esc(s.toFixed(2))}</text>`);
    x += w * s;
    if (i < SHARES_REFERENCE.length - 1) dividers.push(`M${f1(x)} 38 V56`);
  });
  return `<div class="instrument-wrap">
<svg class="instrument" data-instrument="shares" viewBox="0 0 256 200" role="img" aria-label="The shares instrument: the 60-30-10 reference bar, and with a read, the outfit's colours by area beneath it">
<text x="14" y="26" class="band caption">the reference, ${esc(SHARES_REFERENCE.map((s) => s.toFixed(2)).join(" · "))}</text>
<rect x="14" y="38" width="${w}" height="18" rx="3" class="bar-ref" />
<path class="chalk" d="${dividers.join(" ")}" />
${labels.join("")}
<text x="14" y="112" class="band caption">yours, by area</text>
<g class="yours-layer" data-yours-layer="shares"></g>
<rect x="14" y="124" width="${w}" height="18" rx="3" class="bar-ref" />
<text x="14" y="194" class="yours" data-yours-label="shares"></text>
</svg>
</div>`;
}

function instrument(rule: RuleId): string {
  if (rule === "proportion") return proportionInstrument();
  if (rule === "harmony") return harmonyInstrument();
  if (rule === "shares") return sharesInstrument();
  return scaleInstrument(rule);
}

/** The live line under "Yours" before anything is dragged. */
function startNote(rule: RuleId): string {
  if (rule === "proportion") return proportionNote(proportionAt(0.38).r);
  const layout = SCALE_LAYOUT[rule];
  if (!layout) return "";
  return `Drag the handle: ${layout.map(({ id }) => scaleNote(scaleById(id), scaleById(id).start)).join(" · ")}.`;
}

// ---- Cards ----------------------------------------------------------------------

function drill(id: RuleId, e: RuleEntry): string {
  const edges = e.edges.map((x) => `<dt>${esc(x.name)}</dt><dd data-numeral>${esc(x.value)}</dd>`).join("");
  const sources = e.sources.map((s) => `<li>${s.url ? `<a href="${esc(s.url)}">${esc(s.label)}</a>` : esc(s.label)}</li>`).join("");
  return `<details class="drill" data-drill="${id}">
<summary>${esc(DRILL_SUMMARY)}</summary>
<div class="drill-body">
<p><b>Maths</b>${esc(e.maths)}</p>
<div><b>Edges</b><dl class="edges">${edges}</dl></div>
<div><b>Sources</b><ul class="sources">${sources}</ul></div>
${e.calibrated ? "" : `<p class="uncal-note"><b>Calibrated: no, first estimates</b>${esc(UNCALIBRATED_NOTE)}</p>`}
</div>
</details>`;
}

export function renderCard(id: RuleId): string {
  const e = RULEBOOK[id];
  const note = startNote(id);
  return `<article class="rule${id === "proportion" ? " hero" : ""}" id="rule-${id}" data-rule="${id}" aria-labelledby="r-${id}">
${instrument(id)}
<div class="rule-text">
<p class="rule-eyebrow eyebrow"><span>${esc(e.title)}</span>${e.calibrated ? "<span>calibrated</span>" : `<span class="uncal">${esc(UNCALIBRATED)}</span>`}</p>
<h2 id="r-${id}">${esc(e.rule)}</h2>
<p class="yours" data-yours="${id}"><b>Yours</b> <span class="yours-v" data-ratio hidden></span> <span class="state">not read yet</span></p>
${note ? `<p class="drag-note muted" data-note="${id}" aria-live="polite">${esc(note)}</p>` : ""}
</div>
${drill(id, e)}
</article>`;
}

/** The whole page under the bar: head, chip, the cards in reading order, foot. */
export function renderRulebook(): string {
  const ids = RULE_ORDER.filter((id) => id in RULEBOOK);
  return `<header class="page-head">
<p class="eyebrow">The rulebook · <span data-numeral>${esc(ENGINE_VERSION)}</span></p>
<h1>${esc(countWord(ids.length))} rules, each with its maths, its edges and its source.</h1>
<p class="lede">${esc(LEDE)}</p>
<p class="lede provenance">${esc(PROVENANCE)}</p>
<p class="yours-chip" id="yours-chip" aria-live="polite"><span class="chip-text">${esc(NO_READ_CHIP)}</span><a class="btn ghost small" href="/">Read a photo</a></p>
</header>
${ids.map(renderCard).join("\n")}
<footer class="sheet-foot rules-foot"><span>A voidvision production</span><a href="/privacy">Privacy</a><span data-numeral>${esc(ENGINE_VERSION)}</span></footer>`;
}
