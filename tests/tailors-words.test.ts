// T9 (R-09, UX pass 4, 2026-10-07): every line of a reading says what a
// tailor would say, and its numbers agree.
//
// - Volume's reference is "across the shoulders" (founder, 2026-10-07), so
//   it holds when the upper piece is not read, and every ratio names it.
// - A piece's lightness is one number in every line: its measured core
//   (rules.ts pieceLightness), stable under a one-bin change (law 2).
// - The golden section is named in full, counted from the floor; no "block".
// - A pointer says where ("see Leg line below").
// - A row that is fine or on the mark closes on a plain verdict.
// - A look's reason names the rule it moves, and no two looks share one.
//
// Checked on the three fixtures' bins (fixtures.lock.json) and, through the
// shared checks in tests/helpers/agrees.ts, on the 4000-reading probe. The
// last block feeds the old copy through those checks, so each one is shown
// to catch the defect it is for.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { measuredCopy } from "../web/src/engine/measured";
import { type AdviceLine, type Bins, bodyMeasureIn, pieceLightness } from "../web/src/engine/rules";
import { RULEBOOK } from "../web/src/engine/rulebook";
import { type Shown, nudgeProblems, problemsOf, show, verdictProblem } from "./helpers/agrees";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));
const fixture = (id: "sample" | "p1" | "p2") => show(lock.fixtures[id].bins as Bins);
const line = (s: Shown, rule: AdviceLine["rule"]) => s.lines.find((l) => l.rule === rule)!;

describe("Volume: across the shoulders (Mara, founder decision)", () => {
  it("the sample's Measured line names the reference for both pieces (Noor)", () => {
    const s = fixture("sample");
    expect(measuredCopy(line(s, "volume"), s.bins)).toBe("Upper piece 1.70× across the shoulders on the rows no arm crosses, loose; lower piece at the knee line, 0.25× across the shoulders, narrow.");
  });

  it("p1's half-read Volume measures against the span across the shoulders, never the upper piece it did not read (Sam)", () => {
    const s = fixture("p1");
    const v = line(s, "volume");
    expect(v.state).toBe("unread");
    expect(v.text).toBe("The lower piece reads narrow at the knee line (0.40× across the shoulders). An arm or a hand lies over the upper piece's edges, so its width was not read, and the balance of the two is not judged.");
    expect(measuredCopy(v, s.bins)).toBe("Upper piece not read: an arm or a hand lies over its edges on every row; lower piece at the knee line, 0.40× across the shoulders, narrow.");
  });

  it("the Rulebook says plainly what the span is, and that it is read without the upper piece", () => {
    expect(RULEBOOK.volume.maths).toContain("as in \"1.00× across the shoulders\" (the garment spec sheet's term): plainly, the straight span between the two shoulder points the pose model marks");
    expect(RULEBOOK.volume.maths).toContain("It comes from the pose, not the cloth, so it is read even when the upper piece's own width is not.");
    for (const e of Object.values(RULEBOOK)) expect(`${e.rule} ${e.maths}`).not.toMatch(/shoulder line/i);
  });

  it("the lint allows 'across the shoulders' only as a ratio's reference", () => {
    expect(bodyMeasureIn("0.40× across the shoulders")).toBeNull();
    expect(bodyMeasureIn("the span across the shoulders")).not.toBeNull();
    expect(bodyMeasureIn("0.40× the upper piece's shoulder line")).toBe("shoulder line");
  });
});

describe("one lightness per piece (Mara: Leg line 0.32, Value 0.26)", () => {
  it("p1 and p2 quote the lower piece's measured core in the leg line, the value line and both Measured lines", () => {
    for (const [id, lower] of [["p1", "0.26"], ["p2", "0.36"]] as const) {
      const s = fixture(id);
      expect(pieceLightness(s.bins).lower.toFixed(2)).toBe(lower);
      expect(line(s, "legline").text).toContain(`the lower piece (${lower} and`);
      expect(measuredCopy(line(s, "legline"), s.bins)).toContain(`lower piece ${lower},`);
      expect(line(s, "value").text).toMatch(new RegExp(`lower (piece \\(lightness )?${lower}`));
      expect(measuredCopy(line(s, "value"), s.bins)).toContain(`lower ${lower}. Colours:`);
    }
  });

  it("the cores hold under a one-bin nudge: no line of the fixtures flips unmarked (T9 review round 1, law 2)", () => {
    for (const id of ["sample", "p1", "p2"] as const) expect(nudgeProblems(fixture(id).bins, id).problems).toEqual([]);
    // p2 read from the swatches flipped from one tone to dark over light at a one-bin change of the upper core; from the cores it holds.
    const p2 = fixture("p2").bins;
    for (const L of [0.32, 0.34, 0.36]) expect(show({ ...p2, top: { ...p2.top, L } }).lines.find((l) => l.rule === "value")!.text).toMatch(/one tonal shape/);
  });

  it("a small step of dark over light is fine and offers no fix", () => {
    const p1 = fixture("p1").bins;
    const v = show({ ...p1, top: { ...p1.top, L: 0.14 } }).lines.find((l) => l.rule === "value")!;
    expect(v.state).toBe("neutral");
    expect(v.text).toMatch(/^A small step of dark over light: the upper piece \(lightness 0\.14\) is a little darker than the lower piece \(lightness 0\.26\)\./);
    expect(v.text).not.toMatch(/would|darker lower piece/);
    expect(v.recolours).toBeUndefined();
  });
});

describe("the golden section, named in full (Mara)", () => {
  it("the sample's headline and Proportion row say 'the golden section, counted from the floor', and keep no lower block", () => {
    const s = fixture("sample");
    expect(s.verdict).toContain("A long upper piece over a short lower one breaks near the golden section, counted from the floor, the second classical division.");
    expect(line(s, "proportion").text).toBe("The break sits near the golden section (0.382), counted from the floor: a long upper piece over a short lower one, the second classical division. Keep the break where it is.");
  });
});

describe("a pointer says where (Sam)", () => {
  it("p2's column points to the Leg line row by name", () => {
    expect(line(fixture("p2"), "proportion").text).toBe("Top and bottom read as one colour, so the eye runs head to foot without a break. The shoes contrast with it, so the column stops where the shoes begin (see Leg line below). A single column is the longest line an outfit can draw: keep the column.");
  });
});

describe("a fine row closes on one plain verdict of its own (Sam, Noor, the verifier)", () => {
  it("every fine or on-the-mark row of the three fixtures and their looks has one", () => {
    for (const id of ["sample", "p1", "p2"] as const) {
      const s = fixture(id);
      for (const l of [s.lines, ...s.looks.map((k) => k.lines)].flat()) if (l.state === "golden" || l.state === "neutral") expect(verdictProblem(l), `${id} ${l.rule}: ${l.text}`).toBeNull();
    }
  });

  it("the verifier's three rows: shares says 60-30-10 once, the leg line commits, Volume keeps its caveat in two sentences", () => {
    expect(line(fixture("sample"), "shares").text).toBe("A dominant colour at 0.45 leads and the rest support it (60-30-10 is the reference). The lead holds.");
    expect(line(fixture("sample"), "legline").text).toBe("The shoes contrast with the lower piece (0.56 and 0.22), so the leg line stops at the shoes and they become a point of their own: a contrast that holds.");
    expect(line(fixture("p2"), "volume").text).toBe("Fitted over straight: moderate volumes that sit together, a quiet balance that works. The upper piece's width was read on one side only, as an arm lay on the other, so take it as a nudge.");
  });

  it("p2's Value row is no longer only a problem, and Chroma says neutrals have no temperature", () => {
    const s = fixture("p2");
    expect(line(s, "value").text).not.toContain("the eye looks for edges elsewhere");
    expect(line(s, "chroma").text).toBe("Neutrals only, so the palette has no temperature. No colour is saturated, so value carries the outfit: the quiet palette works.");
  });
});

describe("a look's reason names what it moves, and is its own (Mara, Noor)", () => {
  it("navy and oxblood: the oxblood's reason names the leg line and the one saturated note", () => {
    const look = fixture("sample").looks.find((l) => l.title === "Lower piece in navy + Shoes in oxblood")!;
    expect(look.changes.map((c) => c.rule).sort()).toEqual(["chroma", "legline"]);
    const oxblood = look.moves.find((m) => m.kind === "accent")!;
    expect(oxblood.detail).toBe("Shoes in oxblood: a small deep warm accent at 0.05 of the outfit, close in value to the lower piece, so the leg line runs on to the floor; one saturated colour then leads, a single voice.");
  });

  it("the two shoe looks (oxblood, terracotta) give two reasons that differ in substance, with the colour names taken out", () => {
    const s = fixture("sample");
    const reasons = s.looks.flatMap((l) => l.moves.filter((m) => m.kind === "accent").map((m) => m.detail.slice(m.detail.indexOf(": ") + 2).replace(/oxblood|terracotta/g, "_")));
    expect(reasons).toHaveLength(2);
    expect(new Set(reasons).size).toBe(2);
    // The share quoted is the one Colour shares shows (0.05), not "about a tenth".
    for (const r of reasons) expect(r).toContain("at 0.05 of the outfit");
  });
});

describe("the shared checks catch the old copy", () => {
  /** The sample's reading with one line's text, or one move's detail, set back to its 0.10.0 copy. */
  const withText = (rule: AdviceLine["rule"], text: string): Shown => {
    const s = fixture("sample");
    return { ...s, lines: s.lines.map((l) => (l.rule === rule ? { ...l, text } : l)) };
  };
  const problems = (s: Shown) => problemsOf(s, "old");

  it("'shoulder line' and a ratio with no reference", () => {
    const p = problems(withText("volume", "Loose over narrow: 1.70× its shoulder line over 0.25× at the knee line. Keep it."));
    expect(p.some((x) => x.includes('"shoulder line" in'))).toBe(true);
    expect(p.some((x) => x.includes('"0.25×" names no reference'))).toBe(true);
  });

  it("'the section', 'from below' and 'block'", () => {
    const p = problems(withText("proportion", "The break sits near the section from below. Keep the lower block narrow. Keep it."));
    expect(p.some((x) => x.includes('"section" without "golden"'))).toBe(true);
    expect(p.some((x) => x.includes('"from below"'))).toBe(true);
    expect(p.some((x) => x.includes('"block"'))).toBe(true);
  });

  it("a fine row that ends on a problem", () => {
    const p = problems(withText("value", "Light over dark (upper 0.92, lower 0.56): the weight sits low, and the eye looks for edges elsewhere."));
    expect(p.some((x) => x.includes("value is fine, 0 verdict sentences"))).toBe(true);
    // A verdict bolted on ("it"), and a verdict, a hedge, a verdict.
    expect(problems(withText("value", "Light over dark (upper 0.92, lower 0.56): the weight sits low. Keep it.")).some((x) => x.includes('says "it"'))).toBe(true);
    expect(problems(withText("legline", "The shoes contrast with the lower piece (0.56 and 0.22): a contrast that holds. Shoes nearer would run on, but as worn the contrast holds.")).some((x) => x.includes("2 verdict sentences"))).toBe(true);
  });

  it("two lightness values for the lower piece", () => {
    const p = problems(withText("value", "Light over dark (upper 0.94, lower 0.50): the weight sits low. Keep the order of light over dark."));
    expect(p.some((x) => x.includes("the lower lightness differs"))).toBe(true);
    expect(p.some((x) => x.includes("the upper lightness differs"))).toBe(true);
  });

  it("a look whose reason does not name the rule it moves, and two looks with one reason", () => {
    const s = fixture("sample");
    const old = "an accent of about a tenth gives the eye a place to rest.";
    // (Also caught: three clauses in one reason.)
    const looks = s.looks.map((l) => ({ ...l, moves: l.moves.map((m) => (m.kind === "accent" ? { ...m, detail: `${m.title}: ${old}` } : m)) }));
    const p = problems({ ...s, looks });
    expect(p.some((x) => x.includes("moves legline") && x.includes("no reason names it"))).toBe(true);
    expect(p.some((x) => x.includes(`two looks share the reason "${old}"`))).toBe(true);
  });

  it("a pointer that does not say where, and neutrals as a temperature", () => {
    const p = problems(withText("chroma", "No colour is at full saturation; the leg line says more. The palette is no temperature (neutrals only). The quiet palette works."));
    expect(p.some((x) => x.includes("a pointer that does not say where"))).toBe(true);
    expect(p.some((x) => x.includes('"is no temperature"'))).toBe(true);
  });
});
