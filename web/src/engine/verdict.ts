// The plain verdict: a few sentences in everyday words above every number,
// so a visitor knows at once whether the outfit works and the one change
// worth making (the shopper user-sim, 2026-10-04: "is that good?"). It
// speaks of the outfit, never the person, and it adds nothing the rules did
// not say.
//
// Engine 0.7.0 (Noor, UX pass 2: "the headline barely varies between
// photos"): the verdict is written from the leading measurement, not a
// fixed template. It opens with how many changes the rules ask for, then
// says what leads (the first rule with advice, else the first on the mark)
// and by how much in words, then what to keep (the outfit's accent, or the
// next rule on the mark), then the best look. Deterministic: a pure
// function of the lines, the bins and the looks.

import { type Look, type Move, accentWords } from "./looks";
import { colourName } from "./names";
import type { AdviceLine, Bins } from "./rules";
import { PROPORTION_BANDS, tuckable } from "./rules";
import { topFit, legFit } from "./shape-rules";

const PIECE_WORDS = { upper: "the top", lower: "the lower piece", shoes: "shoes", other: "an accent" } as const;

/** One move in everyday words: "a front tuck", "navy for the lower piece", "oxblood shoes". */
export function plainMove(m: Move): string {
  if (m.kind === "break") return m.title.startsWith("Belt") ? "a belt at the waist" : "a front tuck, if the top tucks";
  const name = colourName(m.L, m.C, m.h);
  if (m.kind === "accent") return `${name} shoes`;
  return m.piece === "shoes" ? `${name} shoes` : `${name} for ${PIECE_WORDS[m.piece]}`;
}

const listed = (parts: string[]) => (parts.length <= 1 ? parts.join("") : `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}`);
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The rules in the order they lead a verdict: shape first, then colour, the leg line last. */
const LEAD_ORDER: readonly AdviceLine["rule"][] = ["proportion", "volume", "harmony", "value", "chroma", "shares", "legline"];

const byOrder = (lines: AdviceLine[]) => [...lines].sort((a, b) => LEAD_ORDER.indexOf(a.rule) - LEAD_ORDER.indexOf(b.rule));

/** How far into its band a measurement sits, in words. */
const degree = (line: AdviceLine, firm: string) => (line.borderline ? "right at the edge, a near thing" : firm);

/** What a line says about the outfit, in one plain sentence (no degrees, no scores). */
export function leadSentence(line: AdviceLine, bins: Bins | undefined): string | null {
  switch (line.rule) {
    case "proportion": {
      const r = bins ? bins.proportion : line.measured === "one column" ? null : Number(line.measured.split(" ")[0]);
      if (line.measured === "one column" || r === null) return "One colour runs head to foot, the longest line an outfit can draw.";
      const band = (PROPORTION_BANDS.find((b) => r >= b.from && r < b.to) ?? PROPORTION_BANDS[PROPORTION_BANDS.length - 1]).id;
      if (band === "halves") return `The upper piece ends near the middle of the figure, ${degree(line, Math.abs(r - 0.5) <= 0.02 ? "squarely in halves" : "in halves")}${bins?.front ? ", and it opens down the front" : ""}.`;
      if (band === "long-top") return "The upper piece covers most of the figure, leaving the break little to divide.";
      if (band === "golden") return `The break sits near ${Math.abs(r - 1 / 3) < Math.abs(r - 0.382) ? "a third" : "the golden section"} of the height, ${degree(line, "the classic division")}.`;
      if (band === "golden-long") return `A long upper piece over a short lower one breaks near the section from below, ${degree(line, "the second classical division")}.`;
      return "The break sits high, so the lower block carries the length.";
    }
    case "volume": {
      if (line.state === "unread" || !bins?.fit || bins.fit.top === null || bins.fit.legs === null) return null;
      const pair = `${topFit(bins.fit.top)} over ${legFit(bins.fit.legs)}`;
      if (line.state === "advice") return `${cap(pair)}: two full volumes with nothing to anchor them.`;
      if (line.state === "golden") return `${cap(pair)}: one full volume against one fitted, the classic balance.`;
      return `${cap(pair)}: volumes that sit together quietly.`;
    }
    case "harmony":
      if (line.state === "advice") return "One hue sits outside the scheme the others share.";
      if (line.measured === "neutrals") return "Every piece is a neutral, so the outfit is composed by value.";
      if (!line.measured.includes("·")) return "One colour among neutrals, the most forgiving scheme.";
      return `The hues share one classic scheme, ${degree(line, "comfortably inside it")}.`;
    case "value":
      if (line.state === "advice") return "Dark over light puts the visual weight high.";
      if (bins && Math.abs(bins.bottom.L - bins.top.L) <= 0.08) return "The upper and lower pieces sit at one tone, so the figure reads as one shape.";
      return bins && bins.top.L > bins.bottom.L ? "Light over dark grounds the figure." : "The values sit close enough to read calmly.";
    case "chroma":
      if (line.state === "advice") return line.text.includes("vibrate") ? "Two near-complements at one lightness vibrate where they meet." : "Several saturated colours compete as equals.";
      if (line.state === "golden") return "One saturated colour leads, a single voice.";
      return "No colour is at full strength, so value carries the outfit.";
    case "shares":
      if (line.state === "advice") return "Two colours share the outfit almost equally, so none leads.";
      if (line.state === "golden") return "The colours share the area like a composed palette, one leading.";
      return null;
    case "legline":
      if (line.state === "unread") return null;
      return line.state === "golden" ? "The shoes carry the leg line to the floor." : "The shoes end the leg line at the ankle, a point of their own.";
  }
}

/** What to keep: the outfit's accent first, then the first other rule on the mark. */
function keepSentence(lines: AdviceLine[], lead: AdviceLine | undefined, bins: Bins | undefined): string | null {
  const accent = bins ? accentWords(bins) : null;
  if (accent) return `Keep ${accent}.`;
  const keep = byOrder(lines).find((l) => l.state === "golden" && l !== lead);
  if (!keep) return null;
  const words: Record<AdviceLine["rule"], string> = {
    proportion: "the break where it is",
    volume: "the balance of volumes",
    harmony: "the hues as they are",
    value: "the order of light and dark",
    chroma: "the one saturated note",
    shares: "the way the colours share the area",
    legline: "the shoes near the lower piece's value",
  };
  return `Keep ${words[keep.rule]}.`;
}

/**
 * The line over the looks. With no look to offer it never claims the
 * reading is all fine when a rule gives advice (p1 of UX pass 2: a zipped
 * jacket at halves, where the advice is a shorter piece, not a move).
 */
export function looksIntroOf(lines: AdviceLine[], count: number): string {
  if (count > 0) return `${count === 1 ? "One look" : `${count} looks`} the rules prefer, judged by the same rulebook. Try one on the photo.`;
  if (lines.some((l) => l.state === "advice")) return "No look here improves the reading without breaking another rule. The advice in the reading below says what would.";
  return "The rules would change nothing here. Every reading is on the mark or fine, so the look stands as it is.";
}

/** The change a rule's advice asks for, in a few plain words, for a verdict with no look to name. */
export function changeWords(line: AdviceLine, bins: Bins | undefined): string {
  switch (line.rule) {
    case "proportion": {
      const r = bins?.proportion ?? null;
      const longTop = r !== null && r >= 0.7;
      if (bins && !tuckable(bins)) return "a shorter upper piece, ending near the waist";
      return longTop ? "a belt at the waist" : "a front tuck, if the upper piece tucks";
    }
    case "volume":
      return bins && !tuckable(bins) ? "a narrower leg" : "a tuck, if the upper piece tucks, or a narrower leg";
    case "harmony":
      return "a neutral, or a neighbouring hue, for the colour outside the scheme";
    case "value":
      return "a darker lower piece or darker shoes";
    case "chroma":
      return "one colour at full strength and the others muted";
    case "shares":
      return "one colour taking the lead, near 0.60 of the outfit";
    case "legline":
      return "shoes nearer the lower piece's value";
  }
}

export function verdictOf(lines: AdviceLine[], looks: Look[], bins?: Bins): string {
  const advice = byOrder(lines.filter((l) => l.state === "advice"));
  const changes = advice.length;
  const opening = changes === 0 ? "Works." : changes === 1 ? "Works, with one change worth making." : `${changes === 2 ? "Two" : "A few"} changes would help.`;
  // The leading measurement: the first rule with advice, else the first on the mark, else the first said.
  const candidates = changes ? advice : byOrder(lines.filter((l) => l.state === "golden"));
  let lead: AdviceLine | undefined;
  let sentence: string | null = null;
  for (const l of [...candidates, ...byOrder(lines)]) {
    sentence = leadSentence(l, bins);
    if (sentence) {
      lead = l;
      break;
    }
  }
  const keep = keepSentence(lines, lead, bins);
  const best = looks[0];
  // With no look to offer, the verdict still names the change the leading advice asks for.
  const tryIt = best
    ? `${changes === 0 ? "For one more note, try" : "Try"} ${listed(best.moves.map(plainMove))}.`
    : changes > 0
      ? `The change: ${changeWords(advice[0], bins)}.`
      : !keep
        ? "Keep it as it is."
        : null;
  return [opening, sentence, keep, tryIt].filter((x): x is string => !!x).join(" ");
}
