// The Rulebook page (/rules): every rule renders from RULEBOOK with its
// sources, the instruments find bands exactly as the engine does, and the
// hand-off from Read ignores anything it cannot trust.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { TEMPLATES } from "../web/src/engine/colour-rules";
import { CONTRAST_EDGES, FIT_LEGS, FIT_TOP, LEG_LINE_EDGE, SATURATED_CHROMA, nearEdge } from "../web/src/engine/constants";
import { RULEBOOK, type RuleId } from "../web/src/engine/rulebook";
import { type Bins, ENGINE_VERSION, PROPORTION_BANDS, readBins } from "../web/src/engine/rules";
import { legFit, legLine, topFit } from "../web/src/engine/shape-rules";
import { LAST_READ_KEY, lastReadOf, parseLastRead } from "../web/src/rules/handoff";
import { HANDLE_HIT, PROPORTION_EDGES, PROPORTION_LABELS, RULE_ORDER, SCALES, SCALE_X, harmonyFit, offScale, proportionAt, proportionNote, scaleAt, scaleById, stripX, yoursValues } from "../web/src/rules/model";
import { SHARES_REFERENCE, VIBRATION } from "../web/src/engine/constants";
import { PROVENANCE, UNCALIBRATED, UNCALIBRATED_NOTE, esc, renderCard, renderRulebook } from "../web/src/rules/render";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (f: string) => readFileSync(path.join(root, f), "utf8");
const ids = Object.keys(RULEBOOK) as RuleId[];
const grid = (from: number, to: number, step: number) => Array.from({ length: Math.round((to - from) / step) + 1 }, (_, i) => Number((from + i * step).toFixed(4)));

const SAMPLE: Bins = {
  proportion: 0.64,
  waist: 0.38,
  top: { L: 0.93, C: 0.03, h: 105 },
  bottom: { L: 0.3, C: 0.07, h: 255 },
  palette: [
    { L: 0.93, C: 0.03, h: 105, share: 0.45, y: 0.3 },
    { L: 0.3, C: 0.07, h: 255, share: 0.35, y: 0.7 },
    { L: 0.19, C: 0, h: 0, share: 0.1, y: 0.5 },
    { L: 0.36, C: 0.11, h: 25, share: 0.1, y: 0.97 },
  ],
  fit: { top: 1.45, legs: 0.55 },
};

describe("the Rulebook renders from RULEBOOK", () => {
  const html = renderRulebook();

  it("shows every rule in the engine's rulebook, in reading order, and counts them in the title", () => {
    expect([...RULE_ORDER].sort()).toEqual([...ids].sort());
    const order = [...html.matchAll(/data-rule="(\w+)"/g)].map((m) => m[1]);
    expect(order).toEqual([...RULE_ORDER]);
    expect(html).toContain(`${ids.length === 7 ? "Seven" : ""} rules, each with its maths, its edges and its source.`);
  });

  it("each card carries its title, its rule sentence, its maths, every edge and every source (linked where it has a url)", () => {
    for (const id of ids) {
      const e = RULEBOOK[id];
      const card = renderCard(id);
      expect(card, id).toContain(`<h2 id="r-${id}">${esc(e.rule)}</h2>`);
      expect(card, id).toContain(esc(e.title));
      expect(card, id).toContain(esc(e.maths));
      for (const edge of e.edges) expect(card, `${id} ${edge.name}`).toContain(`<dt>${esc(edge.name)}</dt><dd data-numeral>${esc(edge.value)}</dd>`);
      expect(e.sources.length, id).toBeGreaterThan(0);
      for (const s of e.sources) expect(card, `${id} ${s.label}`).toContain(s.url ? `<a href="${esc(s.url)}">${esc(s.label)}</a>` : `<li>${esc(s.label)}</li>`);
    }
  });

  it("the drill is closed until opened, and says when the edges are set by hand", () => {
    for (const id of ids) {
      const card = renderCard(id);
      expect(card).toMatch(/<details class="drill" data-drill="\w+">/);
      expect(card).not.toMatch(/<details[^>]*\bopen\b/);
      expect(card.includes(esc(UNCALIBRATED_NOTE)), id).toBe(!RULEBOOK[id].calibrated);
      expect(card.includes(esc(UNCALIBRATED)), id).toBe(!RULEBOOK[id].calibrated);
    }
  });

  it("carries the provenance line, the engine version, and nothing the contract forbids", () => {
    expect(html).toContain(esc(PROVENANCE));
    expect(html).toContain(ENGINE_VERSION);
    for (const bad of ["undefined", "NaN", "TODO", "lorem", "__", "—"]) expect(html, bad).not.toContain(bad);
  });

  it("every instrument is labelled, and every live one has a keyboard control", () => {
    expect(html.match(/role="img" aria-label="[^"]+"/g)?.length).toBe(ids.length);
    for (const s of SCALES) expect(html, s.id).toMatch(new RegExp(`<input class="range-hidden" type="range" data-range="${s.id}"[^>]*aria-label="[^"]+"`));
    expect(html).toMatch(/<input class="range-hidden" type="range" data-range="proportion"[^>]*aria-label="[^"]+"/);
  });

  it("rules.html is a build input with the slot the build fills", () => {
    expect(read("web/rules.html")).toContain("<!--rulebook-->");
    expect(read("web/vite.config.ts")).toMatch(/rules: "rules\.html"/);
  });

  it("the harmony rule names every template the engine fits, in plain words (never 'split')", () => {
    const text = `${RULEBOOK.harmony.rule} ${RULEBOOK.harmony.maths}`;
    for (const t of TEMPLATES) expect(text).toContain(`${t.name} (${t.gloss})`);
    expect(text).not.toMatch(/\bsplit\b/);
  });
});

describe("the proportion instrument reads bands as the engine does", () => {
  it("every break the handle can reach: PROPORTION_BANDS for the band, nearEdge for the borderline, the same as readBins", () => {
    const stateOf = { "short-top": "neutral", golden: "golden", halves: "advice", "golden-long": "golden", "long-top": "advice" } as const;
    for (const r of grid(0.1, 0.9, 0.02)) {
      const p = proportionAt(r);
      const band = PROPORTION_BANDS.find((b) => r >= b.from && r < b.to)!;
      expect(p.band, String(r)).toBe(band.id);
      expect(p.onEdge, String(r)).toBe(nearEdge(r, PROPORTION_EDGES, 0.02));
      const line = readBins({ ...SAMPLE, proportion: r }, r)[0];
      expect(line.state, String(r)).toBe(stateOf[p.band]);
      expect(line.borderline, String(r)).toBe(p.onEdge);
    }
  });

  it("snaps to the engine's bin and stays on the figure", () => {
    expect(proportionAt(0.05).r).toBe(0.1);
    expect(proportionAt(0.97).r).toBe(0.9);
    expect(proportionAt(0.4499)).toMatchObject({ r: 0.44, band: "halves", onEdge: true });
    expect(proportionAt(0.383)).toMatchObject({ r: 0.38, band: "golden", label: "section", onEdge: false });
    expect(proportionAt(0.64)).toMatchObject({ band: "golden-long", label: "section, below" });
  });

  it("says the live value in plain words", () => {
    expect(proportionNote(0.46)).toBe("Drag the line: 0.46, halves.");
    expect(proportionNote(0.56)).toBe("Drag the line: 0.56, section, below, on the edge.");
  });
});

describe("the scale instruments read bands as the engine does", () => {
  it("volume: topFit and legFit, borderline at a half bin", () => {
    for (const v of grid(0.9, 1.8, 0.05)) {
      expect(scaleAt(scaleById("volume-top"), v).band).toBe(topFit(v));
      expect(scaleAt(scaleById("volume-top"), v).onEdge).toBe(nearEdge(v, FIT_TOP, 0.05));
    }
    for (const v of grid(0.2, 0.9, 0.05)) {
      expect(scaleAt(scaleById("volume-legs"), v).band).toBe(legFit(v));
      expect(scaleAt(scaleById("volume-legs"), v).onEdge).toBe(nearEdge(v, FIT_LEGS, 0.05));
    }
  });

  it("leg line: the band follows legLine's state and its borderline", () => {
    for (const gap of grid(0, 0.5, 0.02)) {
      const line = legLine(0.3, Number((0.3 + gap).toFixed(2)));
      const a = scaleAt(scaleById("legline"), gap);
      expect(a.band === "the line runs on", String(gap)).toBe(gap < LEG_LINE_EDGE);
      expect(line.state === "golden", String(gap)).toBe(gap < LEG_LINE_EDGE);
      expect(a.onEdge, String(gap)).toBe(line.borderline);
    }
  });

  it("value and chroma: the engine's edges", () => {
    for (const v of grid(0, 1, 0.02)) expect(scaleAt(scaleById("value"), v).band).toBe(v < CONTRAST_EDGES[0] ? "low" : v < CONTRAST_EDGES[1] ? "medium" : "high");
    expect(scaleAt(scaleById("chroma"), SATURATED_CHROMA)).toMatchObject({ band: "saturated", onEdge: true });
    expect(scaleAt(scaleById("chroma"), 0.05)).toMatchObject({ band: "muted", onEdge: false });
    // The chroma scale states only RULEBOOK's edge; a neutral is decided per colour by its lightness.
    expect(scaleById("chroma").edges).toEqual(RULEBOOK.chroma.edges.map((e) => e.value));
    expect(scaleAt(scaleById("chroma"), 0.01).band).toBe("muted");
  });

  it("every scale starts inside its range, on a step, with one band name per band", () => {
    for (const s of SCALES) {
      expect(s.bands.length).toBe(s.edges.length + 1);
      expect(s.start).toBeGreaterThanOrEqual(s.min);
      expect(s.start).toBeLessThanOrEqual(s.max);
      expect(Math.abs(s.start / s.step - Math.round(s.start / s.step))).toBeLessThan(1e-6);
    }
  });
});

describe("yours: the last read's values on each instrument", () => {
  it("takes every marker from the bins, measured the way the engine measures it", () => {
    const v = yoursValues(SAMPLE);
    const lines = readBins(SAMPLE);
    expect(v.proportion).toBe(0.64);
    expect(v.volumeTop).toBe(1.45);
    expect(v.volumeLegs).toBe(0.55);
    expect(`ΔL ${v.legline!.gap.toFixed(2)}`).toBe(lines.find((l) => l.rule === "legline")!.measured);
    expect(`range ${v.value!.range.toFixed(2)}`).toBe(lines.find((l) => l.rule === "value")!.measured);
    expect(v.shares.map((s) => s.share)).toEqual([0.45, 0.35, 0.1, 0.1]);
  });

  it("harmony: the template the engine names, and how far a hue sits outside", () => {
    const h = harmonyFit(SAMPLE.palette)!;
    const line = readBins(SAMPLE).find((l) => l.rule === "harmony")!;
    expect(h.fits).toBe(line.state === "golden");
    if (h.fits) expect(line.text).toContain(`the ${h.name} template`);
    expect(harmonyFit([{ L: 0.5, C: 0, h: 0, share: 1, y: 0.5 }])).toBeNull();
  });
});

describe("the hand-off from Read (sessionStorage) ignores bad data", () => {
  const good = lastReadOf({ engine: ENGINE_VERSION, hash: "12eb34cd56ef", source: "sample", look: "Navy trousers and oxblood shoes", bins: SAMPLE, lines: readBins(SAMPLE) });

  it("a stored reading comes back whole", () => {
    expect(LAST_READ_KEY).toBe("ratio:last-read");
    expect(parseLastRead(JSON.stringify(good))).toEqual(good);
    expect(parseLastRead(JSON.stringify({ ...good, look: null, bins: { ...SAMPLE, proportion: null, fit: null } }))).not.toBeNull();
  });

  it("absent, empty or not JSON: no marker", () => {
    for (const raw of [null, undefined, "", "{", "null", "[]", "42", '"x"']) expect(parseLastRead(raw as string | null), String(raw)).toBeNull();
  });

  it("malformed fields: no marker", () => {
    const bad: Record<string, unknown>[] = [
      { ...good, v: 2 },
      { ...good, engine: "other/1.0.0" },
      { ...good, hash: "<script>" },
      { ...good, source: "upload" },
      { ...good, look: "" },
      { ...good, day: "today" },
      { ...good, bins: { ...SAMPLE, proportion: 1.5 } },
      { ...good, bins: { ...SAMPLE, proportion: "0.5" } },
      { ...good, bins: { ...SAMPLE, top: { L: 0.5, C: 0 } } },
      { ...good, bins: { ...SAMPLE, palette: Array(9).fill(SAMPLE.palette[0]) } },
      { ...good, bins: { ...SAMPLE, palette: [{ ...SAMPLE.palette[0], share: -1 }] } },
      { ...good, bins: { ...SAMPLE, fit: { top: "wide", legs: 1 } } },
      { ...good, lines: [{ rule: "face", measured: "x", state: "golden", borderline: false }] },
      { ...good, lines: [{ rule: "value", measured: "x", state: "great", borderline: false }] },
      { ...good, lines: [{ rule: "value", measured: "x".repeat(200), state: "golden", borderline: false }] },
      { ...good, lines: "all" },
    ];
    for (const b of bad) expect(parseLastRead(JSON.stringify(b)), JSON.stringify(b).slice(0, 120)).toBeNull();
    expect(parseLastRead(JSON.stringify(good).replace("0.64", "NaN"))).toBeNull();
    expect(parseLastRead("x".repeat(9_000))).toBeNull();
  });

  it("keeps only what the Rulebook needs: anything else stored alongside is dropped, never shown", () => {
    const withExtra = { ...good, pixels: [1, 2, 3], bins: { ...SAMPLE, photo: "data:image/png;base64,AAAA" } };
    const back = parseLastRead(JSON.stringify(withExtra))!;
    expect(back).not.toHaveProperty("pixels");
    expect(back.bins).not.toHaveProperty("photo");
  });
});

describe("review fixes: one source for every number and label, handles that do not trap the scroll", () => {
  const html = renderRulebook();

  it("the 60-30-10 reference and the vibration rule come from constants.ts, in the engine's words and on the page", () => {
    expect(RULEBOOK.shares.rule).toContain(SHARES_REFERENCE.map((v) => v.toFixed(2)).join(" · "));
    expect(RULEBOOK.chroma.maths).toContain(`at least ${VIBRATION.minHueGap}° apart`);
    expect(RULEBOOK.chroma.maths).toContain(`within ${VIBRATION.maxLightnessGap} of each other`);
    expect(html).toContain(`complements within ${VIBRATION.maxLightnessGap} in lightness`);
    expect(html).toContain(`the reference, ${SHARES_REFERENCE.map((v) => v.toFixed(2)).join(" · ")}`);
    expect(read("web/src/engine/colour-rules.ts")).not.toMatch(/a - 0\.6\b|>= 150\b|< 0\.08\b/);
  });

  it("each proportion band has one short label, the same on the tape, in the note and to a screen reader", () => {
    for (const b of PROPORTION_BANDS) expect(html).toContain(`>${PROPORTION_LABELS[b.id]}</text>`);
    expect(proportionNote(0.64)).toContain(PROPORTION_LABELS["golden-long"]);
  });

  it("a colour is drawn as a neutral by the engine's isNeutral, not by where it sits on the scale", () => {
    const c = yoursValues(SAMPLE).chroma;
    expect(c[0]).toMatchObject({ C: 0.03, neutral: true }); // cream: under the neutral line at its lightness
    expect(c[2]).toMatchObject({ C: 0, neutral: true });
    expect(c[3]).toMatchObject({ C: 0.11, neutral: false });
  });

  it("the lightness strip's ticks sit on the gradient's real ends (L 0.10 to 0.98), labelled so", () => {
    expect(stripX(0.1)).toBe(SCALE_X.from);
    expect(stripX(0.98)).toBe(SCALE_X.to);
    expect(stripX(0.54)).toBeCloseTo((SCALE_X.from + SCALE_X.to) / 2, 6);
    expect(html).toContain(">0.10</text>");
    expect(html).toContain(">0.98</text>");
  });

  it("a value past a scale's end is labelled, so the handle and Yours never disagree silently", () => {
    expect(offScale(2.0, 0.9, 1.8)).toBe("above");
    expect(offScale(0.05, 0.1, 0.9)).toBe("below");
    expect(offScale(1.8, 0.9, 1.8)).toBeNull();
    expect(read("web/src/rules.ts")).toContain("past(offScale(value, s.min, s.max))");
  });

  it("every handle has a hit area that alone takes the pointer; the instruments let the page scroll", () => {
    expect(html.match(/class="hit"/g)?.length).toBe(SCALES.length + 1);
    expect(html).toContain(`r="${HANDLE_HIT}" class="hit"`);
    const css = read("web/src/rules.css");
    expect(css).toMatch(/\.instrument \{[^}]*touch-action: pan-y;/);
    expect(css).toMatch(/\.instrument \.hit \{[^}]*touch-action: none;/);
    expect(css.match(/touch-action: none;/g)?.length).toBe(1);
    expect(read("web/src/rules.ts")).toContain("if (!grab(p)) return;");
  });
});
