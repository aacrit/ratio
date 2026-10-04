// The last reading, handed from Read to Rules within one tab (design/spec.md,
// Rulebook: "Your last read in this tab is marked on each one"). It is the
// one thing Ratio keeps in the browser today, and it is small: the binned
// measurements and the reading's lines (numbers and short labels), never a
// pixel of the photo (plus a tried look's title). It lives in sessionStorage:
// kept for this tab's session, which a browser that restores or duplicates
// the tab carries over too; Clear on the Rulebook removes it. Nothing in it
// is ever sent.
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

/** One reading: its hash, its bins and its lines' labels. */
export interface Reading {
  hash: string;
  bins: Bins;
  lines: LastReadLine[];
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
  /**
   * The outfit as worn, kept beside a tried look (look not null), so the
   * Rulebook marks the as-worn read first and the look as a second marker
   * (Noor, 2026-10-04). Absent when look is null: then bins and lines are
   * the outfit as worn.
   */
  worn?: Reading;
}

/** The outfit as worn, whichever reading was stored. */
export const wornOf = (r: LastRead): Reading => r.worn ?? { hash: r.hash, bins: r.bins, lines: r.lines };
/** The tried look, or null. */
export const lookOf = (r: LastRead): (Reading & { title: string }) | null => (r.look !== null && r.worn ? { title: r.look, hash: r.hash, bins: r.bins, lines: r.lines } : null);

/**
 * A tried look keeps the outfit as worn beside it: the read stores the
 * outfit as worn first (look null), and each look after it carries that
 * reading on. Pure: the tests feed it values.
 */
export function withWorn(next: LastRead, prev: LastRead | null): LastRead {
  if (next.look === null || next.worn || !prev || prev.source !== next.source || prev.engine !== next.engine) return next;
  return { ...next, worn: wornOf(prev) };
}

const RULE_IDS: readonly RuleId[] = ["proportion", "volume", "legline", "harmony", "value", "shares", "chroma"];
const STATES: readonly LineState[] = ["golden", "advice", "neutral", "unread"];
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
    const part = (v: unknown) => (v === null ? null : num(v, 0, 5) ? v : undefined);
    if (!isObj(x.fit)) return null;
    const top = part(x.fit.top), legs = part(x.fit.legs);
    if (top === undefined || legs === undefined || (top === null && legs === null)) return null;
    fit = { top, legs };
  }
  const out: Bins = { proportion, waist: x.waist, top, bottom, palette, fit };
  if (x.fitWhy !== undefined) {
    if (x.fitWhy !== "arms") return null;
    out.fitWhy = "arms";
  }
  if (x.fitOneSide !== undefined) {
    if (x.fitOneSide !== true) return null;
    out.fitOneSide = true;
  }
  if (x.shoesWhy !== undefined) {
    if (x.shoesWhy !== "cut_off" && x.shoesWhy !== "floor") return null;
    out.shoesWhy = x.shoesWhy;
  }
  if (x.front !== undefined) {
    if (x.front !== true) return null;
    out.front = true;
  }
  return out;
}

function reading(x: unknown): Reading | null {
  if (!isObj(x) || !str(x.hash, 128) || !/^[0-9a-f]{8,128}$/.test(x.hash)) return null;
  const b = bins(x.bins);
  const ls = lines(x.lines);
  return b && ls ? { hash: x.hash, bins: b, lines: ls } : null;
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
  if (typeof raw !== "string" || raw.length === 0 || raw.length > 16_000) return null;
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
  const out: LastRead = { v: 1, engine: x.engine, hash: x.hash, source: x.source, look: x.look, day: x.day, bins: b, lines: ls };
  if (x.worn !== undefined) {
    const w = reading(x.worn);
    // The as-worn reading rides only beside a look.
    if (!w || x.look === null) return null;
    out.worn = w;
  }
  return out;
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
    sessionStorage.setItem(LAST_READ_KEY, JSON.stringify(withWorn(r, r.look === null ? null : loadLastRead())));
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
