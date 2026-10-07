// T6: the agreement checks every reading must pass, shared by
// tests/advice-agrees.test.ts (fixtures and reproducers) and
// tests/advice-probe.test.ts (the reviewer's 4000-reading probe).
// problemsOf collects every disagreement as a sentence, so a probe of
// thousands of readings asserts once and stays fast.

import { expect } from "vitest";
import { SATURATED_CHROMA, isNeutral } from "../../web/src/engine/constants";
import { ACCENT_SHARE, type Look, accentOf, accentWords, pieceOf, pieces, suggestLooks } from "../../web/src/engine/looks";
import { measuredCopy } from "../../web/src/engine/measured";
import { byName, colourName } from "../../web/src/engine/names";
import { RULEBOOK } from "../../web/src/engine/rulebook";
import { type AdviceLine, type Bins, JUDGING_WORDS, bodyMeasureIn, pieceLightness, readBins } from "../../web/src/engine/rules";
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
  // Each sentence once: a reading repeats the Rule lines and many rows in every look.
  const texts = [...new Set(everyText(s))];
  // 1. Garment, never body; never a judging word.
  for (const t of texts) {
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
  if (keepsShoes(s.verdict)) for (const l of s.lines) if (/shoes nearer|darker shoes|\(shoes, a belt/i.test(l.text)) out.push(`${label}: keeps the shoes beside: ${l.text}`);
  //    The proportion line's shoe clause follows the leg line and carries its
  //    borderline mark (law 2: a clause that can flip is never settled).
  const prop = s.lines.find((l) => l.rule === "proportion")!;
  const leg = s.lines.find((l) => l.rule === "legline");
  if (/close in value too/.test(prop.text) && leg?.state !== "golden") out.push(`${label}: proportion says the shoes continue, the leg line does not`);
  if (/shoes contrast with it/.test(prop.text) && !(leg && leg.state !== "golden" && leg.state !== "unread")) out.push(`${label}: proportion says the shoes contrast, the leg line does not`);
  if (/The shoes (sit close in value too|contrast with it)/.test(prop.text)) {
    if (!/\(see Leg line below\)/.test(prop.text)) out.push(`${label}: the shoe clause does not point to the leg line`);
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
  // T9 (UX pass 4): a tailor's words, and numbers that agree.
  tailorProblems(s, texts, label, out);
  return out;
}

/** A row's short numeral for Volume ("1.70× · 0.25×"): the number beside the row's name, whose reference its Measured line names. */
const VOLUME_NUMERAL = /^(?:\d\.\d\d×|not read) · (?:\d\.\d\d×|not read)$/;

/** A verdict word: a row that is fine or on the mark says one sentence holding one. */
export const VERDICT_WORD = /\b(?:keep|works?|holds)\b/i;

/** What each rule's verdict must be about, so it is never bolted on ("The palette is warm-led. Keep it."). */
const VERDICT_SUBJECT: Record<AdviceLine["rule"], RegExp> = {
  proportion: /\b(?:break|column|length|division)\b/,
  volume: /\b(?:volumes?|pairing|balance|pair)\b/,
  legline: /\b(?:shoes|contrast|line)\b/,
  harmony: /\b(?:hues?|scheme|harmony|neutrals?)\b/,
  value: /\b(?:value|tone|light|dark|step)\b/,
  shares: /\b(?:colour|shares?|palette|column|split|lead)\b/,
  chroma: /\b(?:palette|voice|saturated)\b/,
};

/** The one-side caveat Volume may add after its verdict. */
const ONE_SIDE_CAVEAT = /^The upper piece's width was read on one side only/;

/**
 * Why a row that is fine or on the mark does not close on its own plain
 * verdict, or null when it does (Sam and Noor, UX pass 4; T9 review round 1):
 * exactly one sentence holds a verdict word, it is the last (only Volume's
 * one-side caveat may follow), it names the rule's subject rather than "it",
 * and the row offers no fix ("would", "if you want").
 */
export function verdictProblem(l: AdviceLine): string | null {
  const sentences = l.text.split(/(?<=\.)\s+(?=[A-Z])/).filter((x) => !(l.rule === "volume" && ONE_SIDE_CAVEAT.test(x)));
  const verdicts = sentences.filter((x) => VERDICT_WORD.test(x));
  if (verdicts.length !== 1) return `${verdicts.length} verdict sentences`;
  const v = verdicts[0];
  if (v !== sentences.at(-1)) return "the verdict is not the last sentence";
  // "it" with nothing after it is a verdict on nothing named ("Keep it.", "It works."); "Keep it light over dark." names its subject.
  if (/\bkeep it\.$|\bit (?:works|holds)\.$/i.test(v)) return `the verdict "${v}" says "it"`;
  if (!VERDICT_SUBJECT[l.rule].test(v)) return `the verdict "${v}" does not name the rule's subject`;
  if (/\bwould\b|\bif you want\b/i.test(l.text)) return "a fine row offers a fix";
  return null;
}

/**
 * The words that name each rule's cause in a look's reason, written out here
 * so the check does not trust the engine's own table (Mara, UX pass 4: navy
 * and oxblood moved the leg line, but no reason said so).
 */
const CAUSE_WORDS: Record<AdviceLine["rule"], RegExp> = {
  proportion: /moves the break|draws the break/,
  volume: /balance of volumes/,
  legline: /leg line runs on to the floor/,
  harmony: /read as one (?:analogous )?scheme|make a (?:split-)?complementary pair|so the harmony holds|so no hues can clash|the most forgiving harmony|a neutral sits with any hue/,
  value: /value then steps down|nearly one value|step in value .* small enough to hold|puts the darker value below|darker value below grounds the outfit/,
  shares: /shares then come close to 60-30-10|split the shares near the golden section|compete for the lead in the colour shares/,
  chroma: /one saturated colour then leads|compete at full strength|the other steps back/,
};

/** A move's identity: the same move offered in two looks is one move, said once each. */
const moveKey = (m: Look["moves"][number]) => (m.kind === "break" ? `b${m.to}` : `${m.kind}${"swatch" in m ? m.swatch : ""}:${m.L},${m.C},${m.h}`);

type Quote = { where: string; upper?: number; lower?: number; shoes?: number };

/** The lightness a line quotes for the upper piece, the lower piece and the shoes, if it quotes one. */
function quotedL(line: AdviceLine, bins: Bins): Quote[] {
  const n = (x: string | undefined) => (x === undefined ? undefined : Number(x));
  const out: Quote[] = [];
  const copy = measuredCopy(line, bins);
  if (line.rule === "legline") {
    const t = line.text.match(/the lower piece \((\d\.\d\d) and (\d\.\d\d)\)/);
    out.push({ where: "Leg line", lower: n(t?.[1]), shoes: n(t?.[2]) });
    const c = copy.match(/lower piece (\d\.\d\d), the shoes (\d\.\d\d)/);
    out.push({ where: "Leg line Measured", lower: n(c?.[1]), shoes: n(c?.[2]) });
  }
  if (line.rule === "value") {
    out.push({ where: "Value", upper: n(line.text.match(/upper (?:piece )?(?:\(lightness )?(\d\.\d\d)/)?.[1]), lower: n(line.text.match(/lower (?:piece )?(?:\(lightness )?(\d\.\d\d)/)?.[1]) });
    const c = copy.match(/^Pieces at their measured core: upper (\d\.\d\d), lower (\d\.\d\d)\./);
    out.push({ where: "Value Measured", upper: n(c?.[1]), lower: n(c?.[2]) });
  }
  return out;
}

function tailorProblems(s: Shown, texts: readonly string[], label: string, out: string[]): void {
  for (const t of texts) {
    // "Shoulder line" is the seam from the neck to the shoulder point, not a width (Mara).
    if (/shoulder line/i.test(t)) out.push(`${label}: "shoulder line" in: ${t}`);
    // The golden section is never shortened to "the section", nor counted "from below" (Mara).
    if (/(?<!golden )\bsection\b/i.test(t)) out.push(`${label}: "section" without "golden" in: ${t}`);
    if (/\bfrom below\b/i.test(t)) out.push(`${label}: "from below" in: ${t}`);
    // "Block" is not a garment (Mara: "keep the lower block narrow").
    if (/\bblock\b/i.test(t)) out.push(`${label}: "block" in: ${t}`);
    // A pointer says where (Sam: "the leg line says more").
    if (/says more/.test(t)) out.push(`${label}: a pointer that does not say where: ${t}`);
    // Neutrals have no temperature, said as such (Noor).
    if (/is no temperature/.test(t)) out.push(`${label}: "is no temperature" in: ${t}`);
  }
  // Every ratio names its reference (Noor: "lower piece 0.25× at the knee line").
  for (const t of texts) if (!VOLUME_NUMERAL.test(t)) for (const m of t.matchAll(/\d\.\d\d×(?! across the shoulders)/g)) out.push(`${label}: "${m[0]}" names no reference in: ${t}`);
  const readings: { name: string; lines: AdviceLine[]; bins: Bins }[] = [{ name: "worn", lines: s.lines, bins: s.bins }, ...s.looks.map((l) => ({ name: `look "${l.title}"`, lines: l.lines, bins: l.bins }))];
  for (const r of readings) {
    // A piece's lightness is one number wherever it is quoted (Mara: Leg line 0.32, Value 0.26).
    // The one source is the piece's measured core and the shoes' swatch (pieceLightness, T9 review round 1).
    const quotes = r.lines.flatMap((l) => quotedL(l, r.bins));
    const truth = pieceLightness(r.bins);
    for (const piece of ["upper", "lower", "shoes"] as const) {
      const said = quotes.filter((q) => q[piece] !== undefined);
      if (new Set(said.map((q) => q[piece])).size > 1) out.push(`${label}, ${r.name}: the ${piece} lightness differs: ${said.map((q) => `${q.where} ${q[piece]}`).join(", ")}`);
      for (const q of said) if (q[piece] !== Number((truth[piece] ?? NaN).toFixed(2))) out.push(`${label}, ${r.name}: ${q.where} quotes the ${piece} at ${q[piece]}, not its measured ${truth[piece]}`);
    }
    for (const l of r.lines) {
      // A row that is fine or on the mark closes on one plain verdict of its own (Sam, Noor).
      const why = l.state === "golden" || l.state === "neutral" ? verdictProblem(l) : null;
      if (why) out.push(`${label}, ${r.name}: ${l.rule} is ${stateLabel(l)}, ${why}: ${l.text}`);
    }
    // A half-read Volume measures nothing against the upper piece it did not read (Sam).
    const v = r.lines.find((l) => l.rule === "volume");
    if (v && r.bins.fit?.top === null) for (const t of [v.text, measuredCopy(v, r.bins)]) if (/× (?:its|the upper piece's)/.test(t)) out.push(`${label}, ${r.name}: volume measures against the unread upper piece: ${t}`);
  }
  // The proportion line's shoe clause points to the row by its name.
  const prop = s.lines.find((l) => l.rule === "proportion")!;
  if (/The shoes (sit close in value too|contrast with it)/.test(prop.text) && !/\(see Leg line below\)/.test(prop.text)) out.push(`${label}: the shoe clause does not say "see Leg line below": ${prop.text}`);
  // A look's reason names the rule it moves (Mara), and no two looks share a reason (Noor).
  for (const look of s.looks)
    for (const c of look.changes) if (!look.moves.some((m) => CAUSE_WORDS[c.rule].test(m.detail))) out.push(`${label}: "${look.title}" moves ${c.rule} (${c.from} to ${c.to}) but no reason names it: ${look.moves.map((m) => m.detail).join(" ")}`);
  // Reasons differ in substance, not only in the colour they name (T9 review round 1): compared with the move's colour name taken out.
  const reasons = new Map<string, string>();
  for (const look of s.looks)
    for (const m of look.moves) {
      const reason = m.detail.slice(m.detail.indexOf(": ") + 2);
      // At most two clauses, the reason and one clause on what it moves (T9 review round 1).
      if (reason.split("; ").length > 2) out.push(`${label}: "${m.detail}" has more than two clauses`);
      const bare = m.kind === "break" ? reason : reason.split(colourName(m.L, m.C, m.h)).join("_");
      const key = moveKey(m);
      const other = reasons.get(bare);
      if (other !== undefined && other !== key) out.push(`${label}: two looks share the reason "${bare}"`);
      reasons.set(bare, key);
    }
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
    // A piece's lightness as the lines quote it: the measured core for the upper and lower piece.
    const p = pieces(s.bins);
    const was = { ...s.bins.palette[m.swatch], L: m.swatch === p.lower ? s.bins.bottom.L : m.swatch === p.upper ? s.bins.top.L : s.bins.palette[m.swatch].L };
    // No title says one colour name twice ("Bottle green detail muted to bottle green").
    // Longer names are counted and taken out first, so "steel blue" does not count as a "blue".
    let rest = m.title.toLowerCase();
    for (const c of [...new Set([colourName(s.bins.palette[m.swatch].L, was.C, was.h), colourName(m.L, m.C, m.h)])].sort((x, y) => y.length - x.length)) {
      const parts = rest.split(c.toLowerCase());
      if (parts.length - 1 > 1) out.push(`${label}: "${m.title}" says ${c} ${parts.length - 1} times`);
      rest = parts.join("|");
    }
    // A smaller piece over an accent's share is a piece, not a detail.
    if (m.piece === "other" && /detail\b/.test(m.title) && was.share > ACCENT_SHARE) out.push(`${label}: "${m.title}" calls a ${was.share} share a detail`);
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

/** One lightness bin (rules.ts binColour). */
export const LIGHTNESS_BIN = 0.02;

/**
 * Law 2 for the lightness the lines read (T9 review round 1): each piece's
 * measured core and the shoes' swatch, nudged one bin either way. A line
 * whose state differs between the reading and a nudge is marked borderline
 * in at least one of the two, so a one-bin change never flips it silently.
 */
export function nudgeProblems(b: Bins, label: string): { problems: string[]; nudges: number; flips: number } {
  const worn = readBins(b);
  const shoes = pieces(b).shoes;
  const at = (v: number) => Number(Math.min(1, Math.max(0, v)).toFixed(2));
  const variants: [string, Bins][] = [];
  for (const d of [-LIGHTNESS_BIN, LIGHTNESS_BIN]) {
    const sign = d > 0 ? "+" : "";
    variants.push([`upper ${sign}${d}`, { ...b, top: { ...b.top, L: at(b.top.L + d) } }]);
    variants.push([`lower ${sign}${d}`, { ...b, bottom: { ...b.bottom, L: at(b.bottom.L + d) } }]);
    if (shoes >= 0) variants.push([`shoes ${sign}${d}`, { ...b, palette: b.palette.map((s, i) => (i === shoes ? { ...s, L: at(s.L + d) } : s)) }]);
  }
  const problems: string[] = [];
  let flips = 0;
  for (const [name, v] of variants) {
    const nudged = readBins(v);
    for (const a of worn) {
      const z = nudged.find((l) => l.rule === a.rule);
      if (!z || z.state === a.state) continue;
      flips++;
      if (!a.borderline && !z.borderline) problems.push(`${label}: ${a.rule} flips from ${a.state} to ${z.state} at ${name}, marked borderline in neither: "${a.text}" / "${z.text}"`);
    }
  }
  return { problems, nudges: variants.length, flips };
}
