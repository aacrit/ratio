// T6: the agreement checks every reading must pass, shared by
// tests/advice-agrees.test.ts (fixtures and reproducers) and
// tests/advice-probe.test.ts (the reviewer's 4000-reading probe).
// problemsOf collects every disagreement as a sentence, so a probe of
// thousands of readings asserts once and stays fast.

import { expect } from "vitest";
import { SATURATED_CHROMA, isNeutral } from "../../web/src/engine/constants";
import { type Look, accentOf, accentWords, pieceOf, pieces, suggestLooks } from "../../web/src/engine/looks";
import { measuredCopy } from "../../web/src/engine/measured";
import { byName, colourName } from "../../web/src/engine/names";
import { RULEBOOK } from "../../web/src/engine/rulebook";
import { type AdviceLine, type Bins, JUDGING_WORDS, bodyMeasureIn, readBins } from "../../web/src/engine/rules";
import { looksIntroOf, verdictOf } from "../../web/src/engine/verdict";
import { stateLabel } from "../../web/src/ui/rows";

export interface Shown {
  bins: Bins;
  lines: AdviceLine[];
  looks: Look[];
  verdict: string;
}

/** The full reading of a set of bins: lines, looks (each with its own re-read) and the verdict over them. */
export const show = (bins: Bins): Shown => {
  const lines = readBins(bins);
  const looks = suggestLooks(bins, lines);
  return { bins, lines, looks, verdict: verdictOf(lines, looks, bins) };
};

/** Every sentence a reading can put on screen: rows (title, state, number, Measured, Rule, advice), verdict, looks intro, each look's title and reasons, and each tried look's rows and verdict. */
export function everyText(s: Shown): string[] {
  const rowTexts = (lines: AdviceLine[], bins: Bins) => lines.flatMap((l) => [l.title, stateLabel(l), l.measured, measuredCopy(l, bins), RULEBOOK[l.rule].rule, l.text]);
  return [
    ...rowTexts(s.lines, s.bins),
    s.verdict,
    looksIntroOf(s.lines, s.looks.length),
    ...s.looks.flatMap((l) => [l.title, ...l.moves.map((m) => m.detail), ...l.keeps, ...rowTexts(l.lines, l.bins), verdictOf(l.lines, [], l.bins)]),
  ];
}

/** The verdict's keep sentence, if any ("Keep it as it is." is the no-change close, not a keep of one thing). */
export const keepOf = (verdict: string) => {
  const k = verdict.match(/Keep ([^.]+)\./)?.[1] ?? null;
  return k === "it as it is" ? null : k;
};
export const keepsShoes = (verdict: string) => {
  const k = keepOf(verdict);
  return k !== null && /shoes/.test(k);
};

/** The rule each "Keep …" sentence keeps, written out here so the check does not trust the verdict's own table. */
const KEEP_RULE: Record<string, AdviceLine["rule"]> = {
  "the break where it is": "proportion",
  "the balance of volumes": "volume",
  "the hues as they are": "harmony",
  "the order of light and dark": "value",
  "the one saturated note": "chroma",
  "the way the colours share the area": "shares",
  "the shoes near the lower piece's value": "legline",
};

/** The saturated colours, by name: what "the one saturated note" is. */
export const loudNames = (b: Bins) => byName(b.palette).filter((s) => !isNeutral(s) && s.C >= SATURATED_CHROMA).map((s) => s.name);

/**
 * Every keep sentence holds against the look the verdict offers and the
 * lines beside it. An accent kept: no move recolours its swatch, and no line
 * recolours it by name or, naming no colour, by the garment it is. A rule
 * kept: on the mark, and the look's line for it measures exactly what the
 * outfit does; the one saturated note stays the same colour; kept shoes are
 * not recoloured by the look, nor on their own by any line.
 */
function keepProblems(s: Shown, label: string, out: string[]): void {
  const kept = keepOf(s.verdict);
  if (kept === null) return;
  const look = s.looks[0];
  const accent = accentWords(s.bins);
  if (accent !== null && kept === accent) {
    const i = accentOf(s.bins);
    const p = pieces(s.bins);
    const piece = pieceOf(i, p);
    const name = colourName(s.bins.palette[i].L, s.bins.palette[i].C, s.bins.palette[i].h);
    for (const m of look?.moves ?? []) {
      if (m.kind === "recolour" && m.swatch === i) out.push(`${label}: "${s.verdict}" but the look recolours the accent (${m.title})`);
      if (m.kind === "accent" && i === p.shoes) out.push(`${label}: "${s.verdict}" but the look recolours the accent shoes (${m.title})`);
    }
    for (const l of s.lines)
      for (const r of l.recolours ?? []) {
        if (r.colour !== undefined && r.colour === name) out.push(`${label}: "${s.verdict}" but ${l.rule} recolours it by name: ${l.text}`);
        if (r.colour === undefined && r.garment === piece) out.push(`${label}: "${s.verdict}" but ${l.rule} recolours the ${piece} it is: ${l.text}`);
      }
    return;
  }
  const rule = KEEP_RULE[kept];
  if (!rule) return void out.push(`${label}: unknown keep "${kept}"`);
  const worn = s.lines.find((l) => l.rule === rule)!;
  if (worn.state !== "golden") out.push(`${label}: keeps ${rule}, which is not on the mark`);
  if (look) {
    const tried = look.lines.find((l) => l.rule === rule);
    if (tried?.measured !== worn.measured) out.push(`${label}: "${s.verdict}" but the look moves ${rule} from ${worn.measured} to ${tried?.measured}`);
    if (rule === "chroma" && loudNames(look.bins).join() !== loudNames(s.bins).join()) out.push(`${label}: "${s.verdict}" but the look changes which colour is saturated`);
    if (rule === "legline" && look.moves.some((m) => m.kind === "accent" || (m.kind === "recolour" && m.piece === "shoes"))) out.push(`${label}: "${s.verdict}" but the look recolours the shoes`);
  }
  if (rule === "legline") for (const l of s.lines) for (const r of l.recolours ?? []) if (r.garment === "shoes" && !r.matched) out.push(`${label}: keeps the shoes but ${l.rule} recolours them`);
}

/** Every disagreement in a reading, as sentences; empty when every line agrees. */
export function problemsOf(s: Shown, label: string): string[] {
  const out: string[] = [];
  // 1. Garment, never body; never a judging word.
  for (const t of everyText(s)) {
    const body = bodyMeasureIn(t);
    if (body) out.push(`${label}: body word "${body}" in: ${t}`);
    const lower = t.toLowerCase();
    for (const w of JUDGING_WORDS) if (lower.includes(w)) out.push(`${label}: judging word "${w}" in: ${t}`);
  }
  // 2. Not judged is never fine: a line whose number holds "not read" is unread.
  for (const l of [s.lines, ...s.looks.map((x) => x.lines)].flat()) {
    if (l.measured.includes("not read") && l.state !== "unread") out.push(`${label}: ${l.rule} ${l.measured} is ${l.state}`);
    if (l.state === "unread" && /fine/.test(stateLabel(l))) out.push(`${label}: ${l.rule} not judged but shown as fine`);
  }
  // 3. The verdict never keeps what a line or its look changes: every keep sentence.
  keepProblems(s, label, out);
  //    No look on offer takes a line off the mark (review round 2: a value
  //    look that darkened only the lower piece broke the leg line).
  for (const look of s.looks)
    for (const l of s.lines)
      if (l.state === "golden" && look.lines.find((x) => x.rule === l.rule)?.state !== "golden") out.push(`${label}: the look "${look.title}" takes ${l.rule} off the mark`);
  if (keepsShoes(s.verdict)) for (const l of s.lines) if (/shoes nearer|darker shoes|\(shoes, a belt/.test(l.text)) out.push(`${label}: keeps the shoes beside: ${l.text}`);
  //    The proportion line's shoe clause follows the leg line and carries its
  //    borderline mark (law 2: a clause that can flip is never settled).
  const prop = s.lines.find((l) => l.rule === "proportion")!;
  const leg = s.lines.find((l) => l.rule === "legline");
  if (/close in value too/.test(prop.text) && leg?.state !== "golden") out.push(`${label}: proportion says the shoes continue, the leg line does not`);
  if (/shoes contrast with it/.test(prop.text) && !(leg && leg.state !== "golden" && leg.state !== "unread")) out.push(`${label}: proportion says the shoes contrast, the leg line does not`);
  if (/The shoes (sit close in value too|contrast with it)/.test(prop.text)) {
    if (!/the leg line says more\.$/.test(prop.text)) out.push(`${label}: the shoe clause does not point to the leg line`);
    if (prop.borderline !== leg?.borderline) out.push(`${label}: proportion borderline ${prop.borderline}, leg line ${leg?.borderline}`);
  }
  if (/Keep the shoes close in value/.test(prop.text)) out.push(`${label}: the old shoe clause`);
  //    No line keeps the shoes while another recolours them on their own
  //    (darkening the pair together keeps the line, so it may be offered).
  const legKeeps = leg !== undefined && (leg.state === "golden" || /keep it\.$/.test(leg.text));
  if (legKeeps) for (const l of s.lines) if (l !== leg) for (const r of l.recolours ?? []) if (r.garment === "shoes" && !r.matched) out.push(`${label}: ${l.rule} recolours shoes the leg line keeps: ${l.text}`);
  //    A value row that darkens the shoes to match never sits beside a look that moves the leg line off the mark.
  const value = s.lines.find((l) => l.rule === "value");
  if (value?.recolours?.some((r) => r.matched) && leg?.state === "golden")
    for (const look of s.looks) if (look.lines.find((x) => x.rule === "legline")?.state !== "golden") out.push(`${label}: value darkens the shoes to match but "${look.title}" breaks the leg line`);
  // 4. Harmony's number never shows Matsuda's letter.
  const harmony = s.lines.find((l) => l.rule === "harmony");
  if (harmony && /^[iIVLYXT] ·/.test(harmony.measured)) out.push(`${label}: harmony shows a letter: ${harmony.measured}`);
  // 5. Every move in a look says why, in its own words, and the why is true.
  for (const look of s.looks) {
    for (const m of look.moves) if (!/^[^:]+: .+\.$/.test(m.detail)) out.push(`${label}: ${look.title}: no reason in "${m.detail}"`);
    if (look.moves.length > 1 && new Set(look.moves.map((m) => m.detail)).size !== look.moves.length) out.push(`${label}: ${look.title}: a reason repeated`);
    reasonProblems(s, look, label, out);
  }
  return out;
}

/**
 * Each claim a look's reason makes, checked against the swatch it changes
 * and the look's own re-read (review round 3: "a deep neutral takes the hue
 * out" over a grey with no hue).
 */
function reasonProblems(s: Shown, look: Look, label: string, out: string[]): void {
  const names = new Set(byName(s.bins.palette).map((x) => x.name));
  const leg = look.lines.find((l) => l.rule === "legline");
  if (/\bAccent\b/.test(look.title)) out.push(`${label}: "${look.title}" names a piece only "Accent"`);
  for (const m of look.moves) {
    const say = (why: string) => out.push(`${label}: "${m.detail}" ${why}`);
    if (m.kind !== "recolour") continue;
    const was = s.bins.palette[m.swatch];
    if (/takes the hue out/.test(m.detail) && isNeutral(was)) say("but the piece was already a neutral");
    const anchor = m.detail.match(/(?:takes the hue of|sits beside|sits opposite|sits nearly opposite) the (.+?) in the outfit/)?.[1];
    if (anchor !== undefined && !names.has(anchor)) say(`but the outfit has no ${anchor}`);
    if (/keeps its value|the same value/.test(m.detail) && m.L !== was.L) say(`but the lightness moves from ${was.L} to ${m.L}`);
    if (/darker below|a darker value|a deeper neutral/.test(m.detail) && !(m.L < was.L)) say(`but it is not darker (${was.L} to ${m.L})`);
    if (/darker below|grounds the outfit/.test(m.detail) && m.piece !== "lower") say("but it is not the lower piece");
    if (/read as one line|the leg line runs on/.test(m.detail) && leg?.state !== "golden") say("but the look's leg line is not on the mark");
    if (/steps back|muted/.test(m.detail) && !(m.C < was.C)) say(`but the chroma does not drop (${was.C} to ${m.C})`);
  }
}

/** Asserts a reading agrees, listing every disagreement found. */
export function agrees(s: Shown, label: string): void {
  expect(problemsOf(s, label)).toEqual([]);
}
