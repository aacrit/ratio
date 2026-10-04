// The Rulebook page (design/spec.md, Rulebook). The cards are already in the
// HTML, rendered from RULEBOOK at build time (rules/render.ts); this script
// makes the instruments live (a handle follows the hand one to one, the
// numeral and the band follow at once: no count, it is your hand), marks
// the visitor's last read from this tab (rules/handoff.ts) on each one, and
// counts `rule_opened` once per rule per visit when a drill is opened.

import type { RuleId } from "./engine/rulebook";
import { ENGINE_VERSION } from "./engine/rules";
import { sendEvent } from "./events";
import { reducedMotion } from "./motion";
import { SATURATED_CHROMA, nearEdge, shownColour } from "./engine/constants";
import { type LastRead, type Reading, clearLastRead, loadLastRead, localDay, lookOf, wornOf } from "./rules/handoff";
import {
  HANDLE_HIT,
  PROPORTION_RANGE,
  PROP_GEOM,
  RING,
  SCALE_LAYOUT,
  SCALE_X,
  type ScaleDef,
  type YoursValues,
  huePoint,
  keyStep,
  pairText,
  proportionAt,
  proportionNote,
  propY,
  scaleAt,
  scaleById,
  scaleNote,
  scaleX,
  offScale,
  sectorPath,
  stripX,
  yoursValues,
} from "./rules/model";
import { STATE_WORDS } from "./ui/rows";
import { setupTabs } from "./ui/tabs";

const SVG = "http://www.w3.org/2000/svg";
const page = document.getElementById("rulebook");

function svgEl<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, text?: string): SVGElementTagNameMap[K] {
  const el = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, String(v));
  if (text !== undefined) el.textContent = text;
  return el;
}

const lch = (s: { L: number; C: number; h: number }) => {
  // A neutral is drawn with no chroma (engine/constants.ts shownColour).
  const c = shownColour(s);
  return `oklch(${c.L.toFixed(3)} ${c.C.toFixed(3)} ${c.h})`;
};
const f1 = (n: number) => n.toFixed(1);
/** A marker beyond the instrument's ends says so: the handle stops at the end, "Yours" keeps the real value. */
const past = (side: "below" | "above" | null) => (side ? ", past the end" : "");

/** Crossing an edge flashes the band's name for --dur-fast (never under reduced motion). */
function flash(root: Element, band: number): void {
  if (reducedMotion()) return;
  const t = root.querySelector(`[data-band="${band}"]`);
  if (!t) return;
  t.classList.remove("flash");
  void (t as SVGElement).getBoundingClientRect();
  t.classList.add("flash");
}

/** Where a pointer is in an SVG's own units (the instruments scale with their width). */
function svgPoint(svg: SVGSVGElement, e: { clientX: number; clientY: number }): { x: number; y: number } {
  const r = svg.getBoundingClientRect();
  const vb = svg.viewBox.baseVal;
  return { x: ((e.clientX - r.left) / r.width) * vb.width, y: ((e.clientY - r.top) / r.height) * vb.height };
}

type Point = { x: number; y: number };

/**
 * A drag that starts only on a handle: `grab` says whether a press landed
 * within the handle's hit area (HANDLE_HIT). A press anywhere else is the
 * page's (a thumb scrolling past, touch-action: pan-y), never a new value.
 * The arrow keys on the range control are the other way to move it.
 */
function bindDrag(svg: SVGSVGElement, grab: (p: Point) => boolean, onPoint: (p: Point) => void): void {
  let down = false;
  svg.addEventListener("pointerdown", (e) => {
    const p = svgPoint(svg, e);
    if (!grab(p)) return;
    down = true;
    svg.setPointerCapture(e.pointerId);
    onPoint(p);
  });
  // Touch: touch-action on an SVG child is not honoured everywhere, so a
  // touch that lands on a handle claims the gesture here; any other touch
  // stays the page's scroll (the reviewer's note on PR #8).
  svg.addEventListener(
    "touchstart",
    (e) => {
      const t = e.touches[0];
      if (t && grab(svgPoint(svg, t))) e.preventDefault();
    },
    { passive: false },
  );
  svg.addEventListener("pointermove", (e) => down && onPoint(svgPoint(svg, e)));
  const up = () => (down = false);
  svg.addEventListener("pointerup", up);
  svg.addEventListener("pointercancel", up);
}

// ---- Proportion -------------------------------------------------------------------

function setupProportion(): (r: number) => void {
  const svg = page?.querySelector<SVGSVGElement>('[data-instrument="proportion"]');
  const handle = svg?.querySelector<SVGGElement>('[data-handle="proportion"]');
  const readout = svg?.querySelector<SVGTextElement>('[data-readout="proportion"]');
  const range = page?.querySelector<HTMLInputElement>('[data-range="proportion"]');
  const note = page?.querySelector<HTMLElement>('[data-note="proportion"]');
  if (!svg || !handle || !readout || !range || !note) return () => {};
  let band = proportionAt(Number(range.value)).band;
  let at = proportionAt(Number(range.value)).r;
  const set = (raw: number) => {
    const p = proportionAt(raw);
    at = p.r;
    handle.setAttribute("transform", `translate(0 ${f1(propY(p.r))})`);
    readout.textContent = pairText(p.r);
    note.textContent = proportionNote(p.r);
    range.value = String(p.r);
    range.setAttribute("aria-valuetext", `${pairText(p.r)}, ${p.label}${p.onEdge ? ", on the edge" : ""}`);
    if (p.band !== band) {
      const order = ["short-top", "golden", "halves", "golden-long", "long-top"];
      flash(svg, order.indexOf(p.band));
      band = p.band;
    }
  };
  range.addEventListener("input", () => set(Number(range.value)));
  // The tape is vertical: the arrows move the break the way they point
  // (a range control's own keys would move it the other way).
  range.addEventListener("keydown", (e) => {
    const step = keyStep(e.key, true);
    if (step === null) return;
    e.preventDefault();
    set(step === "min" ? PROPORTION_RANGE.min : step === "max" ? PROPORTION_RANGE.max : at + step * PROPORTION_RANGE.step);
  });
  // The handle is the break line itself, from the tape to its knob.
  const grab = ({ x, y }: Point) => Math.abs(y - propY(at)) <= 16 && x >= PROP_GEOM.tapeX - 8 && x <= PROP_GEOM.handleEnd + HANDLE_HIT;
  bindDrag(svg, grab, ({ y }) => set((y - PROP_GEOM.crown) / (PROP_GEOM.sole - PROP_GEOM.crown)));
  return set;
}

// ---- Scales -----------------------------------------------------------------------

function setupScales(rule: RuleId): Map<string, (v: number) => void> {
  const setters = new Map<string, (v: number) => void>();
  const layout = SCALE_LAYOUT[rule];
  const svg = page?.querySelector<SVGSVGElement>(`[data-instrument="${rule}"]`);
  const note = page?.querySelector<HTMLElement>(`[data-note="${rule}"]`);
  if (!layout || !svg || !note) return setters;
  const values = new Map<string, number>();
  const writeNote = () => (note.textContent = `Drag the handle: ${layout.map(({ id }) => scaleNote(scaleById(id), values.get(id) ?? scaleById(id).start)).join(" · ")}.`);
  for (const { id } of layout) {
    const s = scaleById(id);
    const group = svg.querySelector(`[data-scale="${id}"]`);
    const handle = svg.querySelector<SVGGElement>(`[data-handle="${id}"]`);
    const range = page?.querySelector<HTMLInputElement>(`[data-range="${id}"]`);
    if (!group || !handle || !range) continue;
    let band = scaleAt(s, s.start).band;
    values.set(id, s.start);
    const set = (raw: number) => {
      const a = scaleAt(s, raw);
      values.set(id, a.v);
      handle.setAttribute("transform", `translate(${f1(scaleX(s, a.v))} 0)`);
      range.value = String(a.v);
      range.setAttribute("aria-valuetext", scaleNote(s, a.v));
      writeNote();
      if (a.band !== band) {
        flash(group, s.bands.indexOf(a.band));
        band = a.band;
      }
    };
    range.addEventListener("input", () => set(Number(range.value)));
    setters.set(id, set);
  }
  // A drag moves the scale whose handle was pressed.
  let active: string | null = null;
  const grab = (p: Point) => {
    const hit = layout.find(({ id, y }) => {
      const s = scaleById(id);
      return Math.hypot(p.x - scaleX(s, values.get(id) ?? s.start), p.y - y) <= HANDLE_HIT;
    });
    active = hit?.id ?? null;
    return active !== null;
  };
  bindDrag(svg, grab, (p) => {
    if (!active) return;
    const s = scaleById(active);
    setters.get(active)?.(s.min + ((p.x - SCALE_X.from) / (SCALE_X.to - SCALE_X.from)) * (s.max - s.min));
  });
  return setters;
}

// ---- Drills: rule_opened, once per rule per visit -----------------------------------

function setupDrills(): void {
  const counted = new Set<string>();
  page?.querySelectorAll<HTMLDetailsElement>("details[data-drill]").forEach((d) => {
    d.addEventListener("toggle", () => {
      const id = d.dataset.drill ?? "";
      if (!d.open || counted.has(id)) return;
      counted.add(id);
      sendEvent("rule_opened");
    });
  });
}

// ---- Yours: the last read in this tab --------------------------------------------

const NOT_READ: Partial<Record<RuleId, string>> = {
  volume: "not read as worn: the fabric widths were not measured in this photo.",
  legline: "not read as worn: the shoes were not found in the frame.",
};

/** Why a rule was not read as worn, from the reading's own reasons when it has one. */
function notRead(rule: RuleId, worn: Reading): string {
  if (rule === "volume" && worn.bins.fitWhy === "arms") return "not read as worn: an arm or a hand lies over the upper piece on every row.";
  if (rule === "legline" && worn.bins.shoesWhy === "cut_off") return "not read as worn: the frame cuts the shoes off.";
  if (rule === "legline" && worn.bins.shoesWhy === "floor") return "not read as worn: the shoes merge with the floor.";
  return NOT_READ[rule] ?? "not read as worn in this photo.";
}

/** The "Yours" line under each card: the outfit as worn, and a tried look's value after it. */
function yoursLines(last: LastRead | null, v: YoursValues | null): void {
  const worn = last ? wornOf(last) : null;
  const look = last ? lookOf(last) : null;
  page?.querySelectorAll<HTMLElement>("[data-yours]").forEach((p) => {
    const rule = p.dataset.yours as RuleId;
    const valueEl = p.querySelector<HTMLElement>(".yours-v");
    const stateEl = p.querySelector<HTMLElement>(".state");
    if (!valueEl || !stateEl) return;
    delete p.dataset.state;
    const line = worn?.lines.find((l) => l.rule === rule);
    if (!worn || !line || line.state === "unread") {
      valueEl.hidden = true;
      valueEl.textContent = "";
      stateEl.textContent = worn ? notRead(rule, worn) : "not read yet";
      return;
    }
    valueEl.hidden = false;
    valueEl.textContent = line.measured;
    let words = line.borderline ? `${STATE_WORDS[line.state]}, borderline` : STATE_WORDS[line.state];
    if (rule === "harmony" && v?.harmony?.fits && v.harmony.hues.length > 1) words += ` · ${v.harmony.name}`;
    const tried = look?.lines.find((l) => l.rule === rule);
    if (tried && tried.measured !== line.measured) words += `; the look: ${tried.measured}, ${STATE_WORDS[tried.state]}`;
    stateEl.textContent = words;
    if (line.borderline) p.dataset.state = "borderline";
    else if (line.state === "golden") p.dataset.state = "golden";
  });
}

function clearMarks(): void {
  page?.querySelectorAll(".yours-layer").forEach((g) => g.replaceChildren());
  page?.querySelectorAll("[data-yours-label]").forEach((t) => (t.textContent = ""));
  page?.querySelectorAll<SVGGElement>("[data-harmony-example]").forEach((g) => g.removeAttribute("display"));
}

function layer(id: string): SVGGElement | null {
  return page?.querySelector<SVGGElement>(`[data-yours-layer="${id}"]`) ?? null;
}

function scaleMark(id: string, value: number, look = false): void {
  const g = layer(id);
  const s: ScaleDef = scaleById(id);
  const y = SCALE_LAYOUT[s.rule]?.find((l) => l.id === id)?.y;
  if (!g || y === undefined) return;
  const x = scaleX(s, value);
  // As worn: a verdigris tick labelled "yours". A tried look: a dashed chalk tick labelled "look", a line lower.
  if (look) g.append(svgEl("path", { d: `M${f1(x)} ${y + 8} V${y + 18}`, class: "chalk dashed" }), svgEl("text", { x: f1(Math.max(34, Math.min(222, x))), y: y + 42, "text-anchor": "middle" }, `look ${s.format(value)}${past(offScale(value, s.min, s.max))}`));
  else g.append(svgEl("path", { d: `M${f1(x)} ${y + 10} V${y + 16}`, class: "mark" }), svgEl("text", { x: f1(Math.max(34, Math.min(222, x))), y: y + 31, "text-anchor": "middle", class: "yours" }, `yours ${s.format(value)}${past(offScale(value, s.min, s.max))}`));
}

function stripTick(id: string, L: number, cls: string): number {
  const x = stripX(L);
  layer(`${id}-strip`)?.append(svgEl("path", { d: `M${f1(x)} 118 V138`, class: cls }));
  return x;
}

function bracket(id: string, a: number, b: number): void {
  layer(`${id}-strip`)?.append(svgEl("path", { d: `M${f1(a)} 152 H${f1(b)} M${f1(a)} 148 V156 M${f1(b)} 148 V156`, class: "mark" }));
}

function label(rule: RuleId, worn: Reading): void {
  const t = page?.querySelector(`[data-yours-label="${rule}"]`);
  const line = worn.lines.find((l) => l.rule === rule);
  if (t && line && line.state !== "unread") t.textContent = `yours: ${line.measured}`;
}

/** A tried look's values as a second marker on the proportion tape and the scales, beside the outfit as worn. */
function lookMarks(look: YoursValues, worn: YoursValues): void {
  const pg = layer("proportion");
  if (pg && look.proportion !== null && look.proportion !== worn.proportion) {
    const y = propY(look.proportion);
    const yoursY = worn.proportion === null ? null : propY(worn.proportion);
    const ly = yoursY !== null && Math.abs(yoursY - y) < 14 ? (y > yoursY ? y + 14 : y - 8) : y + 3;
    pg.append(svgEl("path", { d: `M100 ${f1(y)} H128`, class: "chalk dashed" }), svgEl("text", { x: 96, y: f1(ly), "text-anchor": "end" }, `look ${look.proportion.toFixed(2)}`));
  }
  if (look.volumeTop !== null && look.volumeTop !== worn.volumeTop) scaleMark("volume-top", look.volumeTop, true);
  if (look.volumeLegs !== null && look.volumeLegs !== worn.volumeLegs) scaleMark("volume-legs", look.volumeLegs, true);
  if (look.legline && look.legline.gap !== worn.legline?.gap) scaleMark("legline", look.legline.gap, true);
  if (look.value && look.value.range !== worn.value?.range) scaleMark("value", look.value.range, true);
}

function marks(last: Reading, v: YoursValues): void {
  clearMarks();
  // Proportion: a fixed verdigris tick beside the tape, its label clear of the band names.
  const pg = layer("proportion");
  if (pg && v.proportion !== null) {
    const y = propY(v.proportion);
    const names = Array.from(page?.querySelectorAll<SVGTextElement>('[data-instrument="proportion"] text.band') ?? []).map((t) => Number(t.getAttribute("y")));
    const near = names.find((ny) => Math.abs(ny - (y + 3)) < 12);
    const ly = near === undefined ? y + 3 : near > y ? near - 12 : near + 12;
    pg.append(svgEl("path", { d: `M100 ${f1(y)} H128`, class: "mark" }), svgEl("text", { x: 96, y: f1(ly), "text-anchor": "end", class: "yours" }, `yours ${v.proportion.toFixed(2)}${past(offScale(v.proportion, PROPORTION_RANGE.min, PROPORTION_RANGE.max))}`));
  }
  if (v.volumeTop !== null) scaleMark("volume-top", v.volumeTop);
  if (v.volumeLegs !== null) scaleMark("volume-legs", v.volumeLegs);
  if (v.legline) {
    scaleMark("legline", v.legline.gap);
    const a = stripTick("legline", v.legline.lower, "tape");
    const b = stripTick("legline", v.legline.shoes, "tape");
    bracket("legline", Math.min(a, b), Math.max(a, b));
  }
  label("legline", last);
  if (v.value) {
    scaleMark("value", v.value.range);
    const xs = v.value.ls.map((L) => stripTick("value", L, "tape"));
    bracket("value", Math.min(...xs), Math.max(...xs));
  }
  label("value", last);
  // Chroma: each colour as a dot in its own colour on the scale, the handle above them.
  const cg = layer("chroma");
  const cs = scaleById("chroma");
  for (const c of v.chroma) {
    // A neutral is the engine's call (isNeutral at the colour's lightness), not a band on this scale.
    const onEdge = !c.neutral && nearEdge(c.C, [SATURATED_CHROMA], cs.borderlineBin);
    cg?.append(svgEl("circle", { cx: f1(scaleX(cs, c.C)), cy: 56, r: 5, fill: lch(c), class: c.neutral ? "dot neutral" : onEdge ? "dot red-ring" : "dot" }));
  }
  label("chroma", last);
  // Shares: the outfit's bar in its own colours, under the reference.
  const sg = layer("shares");
  let x = SCALE_X.from;
  const w = SCALE_X.to - SCALE_X.from;
  // Shares sum to 1.00 (largest remainder); the bar is still scaled to its own total so it never overruns.
  const total = v.shares.reduce((t, s) => t + s.share, 0) || 1;
  v.shares.forEach((s, i) => {
    const sw = (w * s.share) / Math.max(1, total);
    sg?.append(svgEl("rect", { x: f1(x), y: 124, width: f1(Math.max(0, sw)), height: 18, fill: lch(s) }));
    if (i < 3 && sw >= 18) sg?.append(svgEl("text", { x: f1(x + sw / 2), y: 158, "text-anchor": "middle" }, s.share.toFixed(2)));
    x += sw;
  });
  label("shares", last);
  // Harmony: the fitted template's sectors and each hue as a dot in its own colour.
  const hg = layer("harmony");
  const h = v.harmony;
  if (hg && h) {
    page?.querySelector('[data-harmony-example]')?.setAttribute("display", "none");
    for (const [off, wd] of h.sectors) hg.append(svgEl("path", { d: sectorPath(h.rot + off - wd / 2, h.rot + off + wd / 2), class: "sector" }));
    for (const hue of h.hues) {
      const p = huePoint(hue.h);
      hg.append(svgEl("circle", { cx: f1(p.x), cy: f1(p.y), r: 8, fill: lch(hue), class: "dot" }));
      if (hue.outside > 0) {
        hg.append(svgEl("circle", { cx: f1(p.x), cy: f1(p.y), r: 11, class: "red" }));
        const right = p.x >= RING.cx;
        hg.append(svgEl("text", { x: f1(p.x + (right ? 14 : -14)), y: f1(p.y + 4), "text-anchor": right ? "start" : "end", class: "red" }, `${Math.round(hue.h)}°, ${hue.outside}° outside`));
      }
    }
    hg.append(svgEl("text", { x: 14, y: 194, class: "yours" }, h.hues.length < 2 ? "yours: one hue with neutrals" : `yours: ${h.fits ? h.name : `nearest, ${h.name}`}`));
  }
}

// ---- The chip and the whole "yours" state ------------------------------------------

function setupYours(proportion: (r: number) => void, scales: Map<string, (v: number) => void>): void {
  const chip = document.getElementById("yours-chip");
  if (!chip) return;
  const initial = Array.from(chip.childNodes, (n) => n.cloneNode(true));

  const show = (last: LastRead | null) => {
    // The outfit as worn is marked first; a tried look is the second marker.
    const worn = last ? wornOf(last) : null;
    const look = last ? lookOf(last) : null;
    const v = worn ? yoursValues(worn.bins) : null;
    yoursLines(last, v);
    if (!last || !worn || !v) {
      clearMarks();
      chip.replaceChildren(...initial.map((n) => n.cloneNode(true)));
      delete chip.dataset.read;
      return;
    }
    marks(worn, v);
    if (look) lookMarks(yoursValues(look.bins), v);
    // The handles start at your values.
    if (v.proportion !== null) proportion(v.proportion);
    if (v.volumeTop !== null) scales.get("volume-top")?.(v.volumeTop);
    if (v.volumeLegs !== null) scales.get("volume-legs")?.(v.volumeLegs);
    if (v.legline) scales.get("legline")?.(v.legline.gap);
    if (v.value) scales.get("value")?.(v.value.range);

    const dot = document.createElement("span");
    dot.className = "dot";
    dot.setAttribute("aria-hidden", "true");
    const what = document.createElement("span");
    const source = last.source === "sample" ? "the sample" : "your photo";
    what.textContent = `Your last read: ${source}, as worn${look ? `; the look ${look.title.charAt(0).toLowerCase()}${look.title.slice(1)} is the dashed mark` : ""}`;
    const meta = document.createElement("span");
    meta.dataset.numeral = "";
    meta.textContent = `${worn.hash.slice(0, 4)} · ${last.day === localDay() ? "today" : last.day}`;
    const parts: Node[] = [dot, what, meta];
    if (last.engine !== ENGINE_VERSION) {
      const old = document.createElement("span");
      old.className = "muted";
      old.textContent = `read with ${last.engine}; the rulebook is now ${ENGINE_VERSION.replace("ratio-engine/", "")}`;
      parts.push(old);
    }
    const clear = document.createElement("button");
    clear.type = "button";
    clear.className = "btn ghost small";
    clear.textContent = "Clear";
    clear.addEventListener("click", () => {
      clearLastRead();
      show(null);
      chip.querySelector<HTMLElement>("a")?.focus();
    });
    chip.replaceChildren(...parts, clear);
    chip.dataset.read = "";
  };
  show(loadLastRead());
}

// ---- Arrival: the cards are put down 80 ms apart on first paint ---------------------

function arrive(): void {
  page?.querySelectorAll<HTMLElement>(".rule").forEach((card, i) => card.style.setProperty("--i", String(Math.min(i, 6))));
  requestAnimationFrame(() => page?.classList.add("in"));
}

setupTabs();
arrive();
const proportion = setupProportion();
const scales = new Map<string, (v: number) => void>();
for (const rule of Object.keys(SCALE_LAYOUT) as RuleId[]) setupScales(rule).forEach((set, id) => scales.set(id, set));
setupDrills();
setupYours(proportion, scales);
