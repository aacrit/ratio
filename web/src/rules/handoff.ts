// The last reading, handed from Read to Rules within one tab (design/spec.md,
// Rulebook: "Your last read in this tab is marked on each one"). It is the
// one thing Ratio keeps in the browser today, and it is small: the binned
// measurements and the reading's lines (numbers and short labels), never a
// pixel of the photo. It lives in sessionStorage, so it belongs to this tab
// and is gone when the tab closes; nothing in it is ever sent.
// web/privacy.html says so, and tests/privacy-page.test.ts pairs the claim
// with this file, the only one allowed to touch browser storage.
//
// Anything read back is checked field by field: a malformed or foreign value
// means no marker, never a wrong one.

import type { RuleId } from "../engine/rulebook";
import type { AdviceLine, Bins, LineState } from "../engine/rules";

export const LAST_READ_KEY = "ratio:last-read";

export interface LastReadLine {
  rule: RuleId;
  measured: string;
  state: LineState;
  borderline: boolean;
}

export interface LastRead {
  v: 1;
  engine: string;
  /** The reading hash (hex). */
  hash: string;
  source: "sample" | "photo";
  /** The tried look's title, or null for the outfit as worn. */
  look: string | null;
  /** The day it was read, YYYY-MM-DD (local). */
  day: string;
  bins: Bins;
  lines: LastReadLine[];
}

const RULE_IDS: readonly RuleId[] = ["proportion", "volume", "legline", "harmony", "value", "shares", "chroma"];
const STATES: readonly LineState[] = ["golden", "advice", "neutral"];
const MAX_SWATCHES = 8;

type Obj = Record<string, unknown>;
const isObj = (x: unknown): x is Obj => typeof x === "object" && x !== null && !Array.isArray(x);
const num = (x: unknown, lo: number, hi: number): x is number => typeof x === "number" && Number.isFinite(x) && x >= lo && x <= hi;
const str = (x: unknown, max: number): x is string => typeof x === "string" && x.length <= max;

function colour(x: unknown): { L: number; C: number; h: number } | null {
  if (!isObj(x) || !num(x.L, 0, 1) || !num(x.C, 0, 0.5) || !num(x.h, 0, 360)) return null;
  return { L: x.L, C: x.C, h: x.h };
}

function bins(x: unknown): Bins | null {
  if (!isObj(x)) return null;
  const proportion = x.proportion === null ? null : num(x.proportion, 0, 1) ? x.proportion : undefined;
  if (proportion === undefined || !num(x.waist, 0, 1)) return null;
  const top = colour(x.top);
  const bottom = colour(x.bottom);
  if (!top || !bottom || !Array.isArray(x.palette) || x.palette.length > MAX_SWATCHES) return null;
  const palette: Bins["palette"] = [];
  for (const s of x.palette) {
    const c = colour(s);
    if (!c || !isObj(s) || !num(s.share, 0, 1) || !num(s.y, 0, 1)) return null;
    palette.push({ ...c, share: s.share, y: s.y });
  }
  let fit: Bins["fit"] = null;
  if (x.fit !== null) {
    if (!isObj(x.fit) || !num(x.fit.top, 0, 5) || !num(x.fit.legs, 0, 5)) return null;
    fit = { top: x.fit.top, legs: x.fit.legs };
  }
  return { proportion, waist: x.waist, top, bottom, palette, fit };
}

function lines(x: unknown): LastReadLine[] | null {
  if (!Array.isArray(x) || x.length > RULE_IDS.length) return null;
  const out: LastReadLine[] = [];
  for (const l of x) {
    if (!isObj(l) || !RULE_IDS.includes(l.rule as RuleId) || !STATES.includes(l.state as LineState) || !str(l.measured, 80) || typeof l.borderline !== "boolean") return null;
    out.push({ rule: l.rule as RuleId, measured: l.measured, state: l.state as LineState, borderline: l.borderline });
  }
  return out;
}

/** The stored value, or null when it is absent, malformed, or not ours. Pure: the tests feed it strings. */
export function parseLastRead(raw: string | null | undefined): LastRead | null {
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 8_000) return null;
  let x: unknown;
  try {
    x = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!isObj(x) || x.v !== 1) return null;
  if (!str(x.engine, 40) || !/^ratio-engine\/\d+\.\d+\.\d+$/.test(x.engine)) return null;
  if (!str(x.hash, 128) || !/^[0-9a-f]{8,128}$/.test(x.hash)) return null;
  if (x.source !== "sample" && x.source !== "photo") return null;
  if (x.look !== null && !(str(x.look, 120) && x.look.length > 0)) return null;
  if (!str(x.day, 10) || !/^\d{4}-\d{2}-\d{2}$/.test(x.day)) return null;
  const b = bins(x.bins);
  const ls = lines(x.lines);
  if (!b || !ls) return null;
  return { v: 1, engine: x.engine, hash: x.hash, source: x.source, look: x.look, day: x.day, bins: b, lines: ls };
}

/** Today in the visitor's own calendar, YYYY-MM-DD. */
export function localDay(d = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/** Only the fields the Rulebook needs: the line's prose is left behind. */
export function lastReadOf(r: { engine: string; hash: string; source: LastRead["source"]; look: string | null; bins: Bins; lines: AdviceLine[] }): LastRead {
  return {
    v: 1,
    engine: r.engine,
    hash: r.hash,
    source: r.source,
    look: r.look,
    day: localDay(),
    bins: r.bins,
    lines: r.lines.map(({ rule, measured, state, borderline }) => ({ rule, measured, state, borderline })),
  };
}

// Browser storage can be missing or refuse (private windows, blocked site
// data, quota): every access is wrapped, and a refusal means no marker.
export function saveLastRead(r: LastRead): void {
  try {
    sessionStorage.setItem(LAST_READ_KEY, JSON.stringify(r));
  } catch {
    // The Rulebook simply shows no marker.
  }
}

export function loadLastRead(): LastRead | null {
  try {
    return parseLastRead(sessionStorage.getItem(LAST_READ_KEY));
  } catch {
    return null;
  }
}

export function clearLastRead(): void {
  try {
    sessionStorage.removeItem(LAST_READ_KEY);
  } catch {
    // Nothing to clear.
  }
}
