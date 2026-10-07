// T9 (R-09, UX pass 4, 2026-10-07): every line of a reading says what a
// tailor would say, and its numbers agree.
//
// - Volume's reference is "across the shoulders" (founder, 2026-10-07), so
//   it holds when the upper piece is not read, and every ratio names it.
// - A piece's lightness is one number in every line (rules.ts pieceLightness).
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
import { CLOSING_VERDICT, type Shown, problemsOf, show } from "./helpers/agrees";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));
const fixture = (id: "sample" | "p1" | "p2") => show(lock.fixtures[id].bins as Bins);
const line = (s: Shown, rule: AdviceLine["rule"]) => s.lines.find((l) => l.rule === rule)!;

describe("Volume: across the shoulders (Mara, founder decision)", () => {
  it("the sample's Measured line names the reference for both pieces (Noor)", () => {
    const s = fixture("sample");
    expect(measuredCopy(line(s, "volume"), s.bins)).toBe("Upper piece 1.70× across the shoulders on the rows no arm crosses, loose; lower piece 0.25× across the shoulders at the knee line, narrow.");
  });

  it("p1's half-read Volume measures against the span across the shoulders, never the upper piece it did not read (Sam)", () => {
    const s = fixture("p1");
    const v = line(s, "volume");
    expect(v.state).toBe("unread");
    expect(v.text).toBe("The lower piece reads narrow at the knee line (0.40× across the shoulders). An arm or a hand lies over the upper piece's edges, so its width was not read, and the balance of the two is not judged.");
    expect(measuredCopy(v, s.bins)).toBe("Upper piece not read: an arm or a hand lies over its edges on every row; lower piece 0.40× across the shoulders at the knee line, narrow.");
  });

  it("the Rulebook says plainly what the span is, and that it is read without the upper piece", () => {
    expect(RULEBOOK.volume.maths).toContain("across the shoulders, the garment spec sheet's term: plainly, the straight span between the two shoulder points the pose model marks");
    expect(RULEBOOK.volume.maths).toContain("It comes from the pose, not the cloth, so it is read even when the upper piece's own width is not.");
    for (const e of Object.values(RULEBOOK)) expect(`${e.rule} ${e.maths}`).not.toMatch(/shoulder line/i);
  });

  it("the lint allows only 'across the shoulders'", () => {
    expect(bodyMeasureIn("0.40× across the shoulders")).toBeNull();
    expect(bodyMeasureIn("0.40× the upper piece's shoulder line")).toBe("shoulder line");
  });
});

describe("one lightness per piece (Mara: Leg line 0.32, Value 0.26)", () => {
  it("p1 and p2 quote the lower piece's swatch in the leg line, the value line and both Measured lines", () => {
    for (const [id, lower] of [["p1", "0.32"], ["p2", "0.38"]] as const) {
      const s = fixture(id);
      expect(pieceLightness(s.bins).lower.toFixed(2)).toBe(lower);
      expect(line(s, "legline").text).toContain(`the lower piece (${lower} and`);
      expect(measuredCopy(line(s, "legline"), s.bins)).toContain(`lower piece ${lower},`);
      expect(line(s, "value").text).toMatch(new RegExp(`lower (piece \\(lightness )?${lower}`));
      expect(measuredCopy(line(s, "value"), s.bins)).toContain(`lower piece ${lower};`);
    }
  });

  it("p1's value row, read from the swatches, is a small step of dark over light: borderline, said, and fine", () => {
    // 0.18 over 0.32 is 0.14, within half a bin pair of the 0.15 advice edge: borderline, never flipped silently.
    const v = line(fixture("p1"), "value");
    expect(v.state).toBe("neutral");
    expect(v.borderline).toBe(true);
    expect(v.text).toMatch(/^Dark over light: the upper piece \(lightness 0\.18\) is darker than the lower piece \(lightness 0\.32\)/);
    expect(v.text).toMatch(/The step is small, so as worn it holds\.$/);
  });
});

describe("the golden section, named in full (Mara)", () => {
  it("the sample's headline and Proportion row say 'the golden section, counted from the floor', and keep no lower block", () => {
    const s = fixture("sample");
    expect(s.verdict).toContain("A long upper piece over a short lower one breaks near the golden section, counted from the floor, the second classical division.");
    expect(line(s, "proportion").text).toBe("The break sits near the golden section (0.382), counted from the floor: a long upper piece over a short lower one, the second classical division. Keep it.");
  });
});

describe("a pointer says where (Sam)", () => {
  it("p2's column points to the Leg line row by name", () => {
    expect(line(fixture("p2"), "proportion").text).toBe("Top and bottom read as one colour, so the eye runs head to foot without a break. The shoes contrast with it, so the column stops where the shoes begin (see Leg line below). A single column is the longest line an outfit can draw: keep it.");
  });
});

describe("a fine row closes on a plain verdict (Sam, Noor)", () => {
  it("every fine or on-the-mark row of the three fixtures and their looks ends in one", () => {
    for (const id of ["sample", "p1", "p2"] as const) {
      const s = fixture(id);
      for (const l of [s.lines, ...s.looks.map((k) => k.lines)].flat()) if (l.state === "golden" || l.state === "neutral") expect(l.text, `${id} ${l.rule}`).toMatch(CLOSING_VERDICT);
    }
  });

  it("p2's Value row is no longer only a problem, and Chroma says neutrals have no temperature", () => {
    const s = fixture("p2");
    expect(line(s, "value").text).not.toContain("the eye looks for edges elsewhere");
    expect(line(s, "chroma").text).toBe("Neutrals only, so the palette has no temperature. No colour is saturated, so value carries the outfit: a quiet choice that works.");
  });
});

describe("a look's reason names what it moves, and is its own (Mara, Noor)", () => {
  it("navy and oxblood: the oxblood's reason names the leg line and the one saturated note", () => {
    const look = fixture("sample").looks.find((l) => l.title === "Lower piece in navy + Shoes in oxblood")!;
    expect(look.changes.map((c) => c.rule).sort()).toEqual(["chroma", "legline"]);
    const oxblood = look.moves.find((m) => m.kind === "accent")!;
    expect(oxblood.detail).toBe("Shoes in oxblood: an oxblood accent of about a tenth gives the eye a place to rest; its value sits close to the lower piece's, so the leg line runs on to the floor; one saturated colour then leads, a single voice.");
  });

  it("the two shoe looks (oxblood, terracotta) give two reasons", () => {
    const s = fixture("sample");
    const reasons = s.looks.flatMap((l) => l.moves.filter((m) => m.kind === "accent").map((m) => m.detail.slice(m.detail.indexOf(": ") + 2)));
    expect(reasons).toHaveLength(2);
    expect(new Set(reasons).size).toBe(2);
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
    const p = problems(withText("value", "Light over dark (upper 0.94, lower 0.56): the weight sits low, and the eye looks for edges elsewhere."));
    expect(p.some((x) => x.includes("value is fine but ends without a verdict"))).toBe(true);
  });

  it("two lightness values for the lower piece", () => {
    const p = problems(withText("value", "Light over dark (upper 0.92, lower 0.50): the weight sits low. It works."));
    expect(p.some((x) => x.includes("the lower piece's lightness differs"))).toBe(true);
    expect(p.some((x) => x.includes("the upper piece's lightness differs"))).toBe(true);
  });

  it("a look whose reason does not name the rule it moves, and two looks with one reason", () => {
    const s = fixture("sample");
    const old = "an accent of about a tenth gives the eye a place to rest.";
    const looks = s.looks.map((l) => ({ ...l, moves: l.moves.map((m) => (m.kind === "accent" ? { ...m, detail: `${m.title}: ${old}` } : m)) }));
    const p = problems({ ...s, looks });
    expect(p.some((x) => x.includes("moves legline") && x.includes("no reason names it"))).toBe(true);
    expect(p.some((x) => x.includes(`two looks share the reason "${old}"`))).toBe(true);
  });

  it("a pointer that does not say where, and neutrals as a temperature", () => {
    const p = problems(withText("chroma", "No colour is at full saturation; the leg line says more. The palette is no temperature (neutrals only). It works."));
    expect(p.some((x) => x.includes("a pointer that does not say where"))).toBe(true);
    expect(p.some((x) => x.includes('"is no temperature"'))).toBe(true);
  });
});
