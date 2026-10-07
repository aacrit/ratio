// T6 (UX pass 3, R-09): every line a reading shows agrees with the other
// lines and names the garment, never the body.
//
// - No line, Measured copy, verdict, look or look reason makes a body part
//   the thing measured (BODY_MEASURE_WORDS).
// - A rule that was not judged never shows "fine".
// - The verdict never keeps a piece any line, or the look it offers, asks to
//   change; the proportion line's shoe clause follows the leg line.
// - The Harmony row shows the plain template name.
// - Every move in a look carries its own reason.
//
// Checked on the three committed fixtures' bins (fixtures.lock.json, the
// readings Mara, Noor and Sam saw) and on a seeded grid of bins.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import type { BinnedSwatch } from "../web/src/engine/colour-rules";
import { binShares } from "../web/src/engine/constants";
import { type Look, suggestLooks } from "../web/src/engine/looks";
import { measuredCopy } from "../web/src/engine/measured";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { type AdviceLine, BODY_MEASURE_WORDS, type Bins, JUDGING_WORDS, readBins } from "../web/src/engine/rules";
import { changedGarments, looksIntroOf, verdictOf } from "../web/src/engine/verdict";
import { STATE_WORDS, stateLabel } from "../web/src/ui/rows";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));
const fixtureBins = (id: "sample" | "p1" | "p2"): Bins => lock.fixtures[id].bins as Bins;

interface Shown {
  bins: Bins;
  lines: AdviceLine[];
  looks: Look[];
  verdict: string;
}

const show = (bins: Bins): Shown => {
  const lines = readBins(bins);
  const looks = suggestLooks(bins, lines);
  return { bins, lines, looks, verdict: verdictOf(lines, looks, bins) };
};

/** Every sentence a reading can put on screen: rows (title, state, number, Measured, Rule, advice), verdict, looks intro, each look's title and reasons, and each tried look's rows and verdict. */
function everyText(s: Shown): string[] {
  const rowTexts = (lines: AdviceLine[], bins: Bins) => lines.flatMap((l) => [l.title, stateLabel(l), l.measured, measuredCopy(l, bins), RULEBOOK[l.rule].rule, l.text]);
  return [
    ...rowTexts(s.lines, s.bins),
    s.verdict,
    looksIntroOf(s.lines, s.looks.length),
    ...s.looks.flatMap((l) => [l.title, ...l.moves.map((m) => m.detail), ...l.keeps, ...rowTexts(l.lines, l.bins), verdictOf(l.lines, [], l.bins)]),
  ];
}

/** The verdict's keep sentence, if any. */
const keepOf = (verdict: string) => verdict.match(/Keep ([^.]+)\./)?.[1] ?? null;
const keepsShoes = (verdict: string) => {
  const k = keepOf(verdict);
  return k !== null && /shoes/.test(k);
};

/** The checks every reading must pass, on the fixtures and on the grid. */
function agrees(s: Shown, label: string): void {
  const all = everyText(s);
  // 1. Garment, never body.
  for (const t of all) {
    for (const w of BODY_MEASURE_WORDS) expect(t.toLowerCase(), `${label}: "${w}" in: ${t}`).not.toContain(w);
    for (const w of JUDGING_WORDS) expect(t.toLowerCase(), `${label}: "${w}" in: ${t}`).not.toContain(w);
  }
  // 2. Not judged is never fine: a line whose number holds "not read" is unread.
  for (const l of [s.lines, ...s.looks.map((x) => x.lines)].flat()) {
    if (l.measured.includes("not read")) expect(l.state, `${label}: ${l.rule} ${l.measured}`).toBe("unread");
    if (l.state === "unread") expect(stateLabel(l)).not.toMatch(/fine/);
  }
  // 3. The verdict never keeps a piece a line or its look changes.
  const changed = changedGarments(s.lines, s.looks[0]);
  if (keepsShoes(s.verdict)) {
    expect(changed.has("shoes"), `${label}: ${s.verdict} / ${s.lines.filter((l) => l.asks?.includes("shoes")).map((l) => l.text).join(" | ")}`).toBe(false);
    for (const l of s.lines) expect(l.text, label).not.toMatch(/shoes nearer|darker shoes|\(shoes, a belt/);
  }
  //    The proportion line's shoe clause follows the leg line.
  const prop = s.lines.find((l) => l.rule === "proportion")!;
  const leg = s.lines.find((l) => l.rule === "legline");
  if (/close in value too/.test(prop.text)) expect(leg?.state, label).toBe("golden");
  if (/shoes contrast with it/.test(prop.text)) expect(leg && leg.state !== "golden" && leg.state !== "unread", label).toBe(true);
  expect(prop.text).not.toMatch(/Keep the shoes close in value/);
  //    No line keeps the shoes while another asks to change them.
  const legKeeps = leg !== undefined && (leg.state === "golden" || /keep it\.$/.test(leg.text));
  if (legKeeps) for (const l of s.lines) if (l !== leg) expect(l.asks ?? [], `${label}: ${l.rule} asks shoes while the leg line keeps them`).not.toContain("shoes");
  // 4. Harmony's number never shows Matsuda's letter.
  const harmony = s.lines.find((l) => l.rule === "harmony");
  if (harmony) expect(harmony.measured, label).not.toMatch(/^[iIVLYXT] ·/);
  // 5. Every move in a look says why, in its own words.
  for (const look of s.looks) {
    for (const m of look.moves) expect(m.detail, `${label}: ${look.title}`).toMatch(/^[^:]+: .+\.$/);
    if (look.moves.length > 1) expect(new Set(look.moves.map((m) => m.detail)).size, `${label}: ${look.title}`).toBe(look.moves.length);
  }
}

describe("the UX pass 3 fixtures (fixtures.lock.json bins)", () => {
  for (const id of ["sample", "p1", "p2"] as const) {
    it(`${id}: every line agrees and names the garment`, () => agrees(show(fixtureBins(id)), id));
  }

  it("Volume names the garment: no 'each leg', no 'shoulder width' (Mara)", () => {
    for (const id of ["sample", "p1", "p2"] as const) {
      const s = show(fixtureBins(id));
      const v = s.lines.find((l) => l.rule === "volume")!;
      const copy = measuredCopy(v, s.bins);
      expect(v.text + copy).not.toMatch(/each leg|shoulder width|torso/i);
      expect(copy).toMatch(/lower piece/);
    }
    const p2 = show(fixtureBins("p2"));
    const v = p2.lines.find((l) => l.rule === "volume")!;
    expect(measuredCopy(v, p2.bins)).toBe("Upper piece 0.90× its shoulder line, read on one side, on the rows no arm crosses, fitted; lower piece 0.45× at the knee line, straight.");
  });

  it("p1 (Noor, hash 0429): keeps the coral shoes, and the leg line keeps them too", () => {
    const s = show(fixtureBins("p1"));
    expect(s.verdict).toContain("Keep the coral shoes.");
    const leg = s.lines.find((l) => l.rule === "legline")!;
    expect(leg.text).not.toMatch(/nearer/);
    expect(leg.text).toMatch(/accent, so the contrast is the point: keep it\.$/);
    expect(leg.asks).toBeUndefined();
  });

  it("p1: the half-read Volume row says 'not judged', never 'fine' (Sam, Noor)", () => {
    const s = show(fixtureBins("p1"));
    const v = s.lines.find((l) => l.rule === "volume")!;
    expect(v.measured).toBe("not read · 0.40×");
    expect(v.state).toBe("unread");
    expect(stateLabel(v)).toBe(STATE_WORDS.unread);
    expect(STATE_WORDS.unread).toBe("not judged");
    expect(v.text).toMatch(/balance of the two is not judged/);
  });

  it("p1: the Harmony row shows the plain name, 'analogous', not Matsuda's 'V' (Mara)", () => {
    const h = show(fixtureBins("p1")).lines.find((l) => l.rule === "harmony")!;
    expect(h.measured).toBe("analogous · 345° 35°");
  });

  it("p2 (Mara, hash ed6c): one column over contrasting shoes says so, and never says to keep the shoes close", () => {
    const s = show(fixtureBins("p2"));
    const prop = s.lines.find((l) => l.rule === "proportion")!;
    const leg = s.lines.find((l) => l.rule === "legline")!;
    expect(leg.state).toBe("neutral");
    expect(leg.text).toMatch(/contrast/);
    expect(prop.text).toMatch(/The shoes contrast with it, so the column stops where the shoes begin/);
    expect(prop.text).not.toMatch(/Keep the shoes/);
    // "Works" and the looks' "No rule asks for a change" stay true: no rule gives advice.
    expect(s.lines.some((l) => l.state === "advice")).toBe(false);
    expect(s.verdict).toMatch(/^Works\./);
    expect(keepsShoes(s.verdict)).toBe(false);
  });

  it("sample (Mara, Looks): each swap in a look carries its own reason", () => {
    const s = show(fixtureBins("sample"));
    const two = s.looks.filter((l) => l.moves.length > 1);
    for (const look of s.looks) for (const m of look.moves) expect(m.detail).toMatch(/: /);
    for (const look of two) {
      const reasons = look.moves.map((m) => m.detail.split(": ")[1]);
      expect(new Set(reasons).size).toBe(reasons.length);
    }
    // The navy lower piece is explained by navy's reason, not the accent's.
    for (const look of s.looks)
      for (const m of look.moves) if (m.kind === "recolour") expect(m.detail).not.toMatch(/accent of about a tenth/);
  });
});

describe("a seeded grid of readings: no two lines disagree", () => {
  // mulberry32: the same 300 readings every run.
  const rand = (() => {
    let a = 0x7a6;
    return () => {
      a |= 0;
      a = (a + 0x6d2b79f5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  })();
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(rand() * xs.length)];

  function randomBins(): Bins {
    const n = 2 + Math.floor(rand() * 4);
    const ys = [0.2, 0.3, 0.6, 0.7, 0.95];
    const raw: Omit<BinnedSwatch, "share">[] = [];
    for (let i = 0; i < n; i++) {
      const neutral = rand() < 0.4;
      raw.push({ L: pick([0.14, 0.2, 0.32, 0.45, 0.56, 0.66, 0.8, 0.94]), C: neutral ? 0 : pick([0.04, 0.07, 0.1, 0.12, 0.15]), h: neutral ? 0 : pick([5, 35, 80, 150, 215, 255, 300, 345]), y: i === n - 1 && rand() < 0.8 ? 0.95 : pick(ys.slice(0, 4)) });
    }
    const weights = raw.map((_, i) => (i === raw.length - 1 && raw[i].y > 0.9 ? 0.05 + rand() * 0.1 : 0.2 + rand()));
    const total = weights.reduce((a, b) => a + b, 0);
    const shares = binShares(weights.map((w) => w / total));
    const palette = raw.map((s, i) => ({ ...s, share: shares[i] })).sort((p, q) => q.share - p.share);
    const body = palette.filter((s) => s.y < 0.9);
    const upper = body.find((s) => s.y < 0.4) ?? body[0] ?? palette[0];
    const lower = body.find((s) => s.y >= 0.4) ?? upper;
    const fitPart = (xs: number[]) => (rand() < 0.2 ? null : pick(xs));
    const fit = rand() < 0.15 ? null : { top: fitPart([1.0, 1.2, 1.3, 1.5, 1.7]), legs: fitPart([0.3, 0.4, 0.5, 0.55, 0.7, 0.9]) };
    const b: Bins = {
      proportion: upper === lower || rand() < 0.15 ? null : pick([0.2, 0.36, 0.44, 0.5, 0.56, 0.62, 0.72, 0.8]),
      waist: pick([0.36, 0.38, 0.4]),
      top: { L: upper.L, C: upper.C, h: upper.h },
      bottom: { L: lower.L, C: lower.C, h: lower.h },
      palette,
      fit: fit && fit.top === null && fit.legs === null ? null : fit,
    };
    if (rand() < 0.25) b.front = true;
    if (b.fit && b.fit.top === null && rand() < 0.5) b.fitWhy = "arms";
    if (!b.fit && rand() < 0.5) b.fitWhy = "arms";
    if (b.fit?.top !== null && b.fit !== null && rand() < 0.2) b.fitOneSide = true;
    if (!palette.some((s) => s.y > 0.9) && rand() < 0.5) b.shoesWhy = pick(["cut_off", "floor"] as const);
    return b;
  }

  it("300 readings: garment words only, not judged is never fine, no keep against a change, shoe clauses agree, every move has its reason", () => {
    let keptShoes = 0, columnClauses = 0, halfRead = 0;
    for (let i = 0; i < 300; i++) {
      const s = show(randomBins());
      agrees(s, `grid #${i}`);
      if (keepsShoes(s.verdict)) keptShoes++;
      if (/The shoes (sit close in value too|contrast with it)/.test(s.lines[0].text)) columnClauses++;
      if (s.lines.some((l) => l.rule === "volume" && l.state === "unread")) halfRead++;
    }
    // The grid reaches the cases the properties are about.
    expect(keptShoes).toBeGreaterThan(5);
    expect(columnClauses).toBeGreaterThan(5);
    expect(halfRead).toBeGreaterThan(5);
    // Each reading suggests looks (every candidate re-read by the rulebook): a few seconds in all.
  }, 60_000);
});
