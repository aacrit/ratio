// This session's reads (T3, R-09: "my read is gone. Again."). Kept in
// memory only: never written to disk in any form, not IndexedDB, not
// localStorage (founder, 2026-10-04: "never store the photo" - law 1 stays
// absolute). Read -> Rules -> Read restores with no re-measure because
// Rules now opens inside this same page (no navigation, nothing unloads);
// a genuine reload has nothing in memory to restore from, and falls back to
// the small, photo-free lastRead hand-off instead (rules/handoff.ts,
// main.ts's chalk-figure restore).
//
// The pure array logic (insert, trim, step, find) is exported separately so
// it is a unit test rather than a browser script (tests/session-store.test.ts).

import type { Read } from "./read";

export const MAX_KEPT = 8;
export const MAX_STRIP = 5;

export interface SessionRead {
  /** The reading hash: one entry per outfit read, like the wardrobe. */
  id: string;
  at: number;
  sourceCredit: string | null;
  read: Read;
}

/** Adds or replaces an entry by id, oldest dropped past `max`. */
export function insertRead<T extends { id: string }>(kept: readonly T[], entry: T, max = MAX_KEPT): T[] {
  const next = kept.filter((k) => k.id !== entry.id);
  next.push(entry);
  return next.length > max ? next.slice(next.length - max) : next;
}

/** The next index stepping `direction` through the list, clamped to its ends (never wraps). */
export function stepIndex(length: number, current: number, direction: -1 | 1): number {
  if (length <= 0) return -1;
  return Math.max(0, Math.min(length - 1, current + direction));
}

/** The index of the read whose hash starts with this (URL-fragment-sized) prefix, or -1. */
export function findByHashPrefix<T extends { id: string }>(kept: readonly T[], prefix: string): number {
  if (!prefix) return -1;
  return kept.findIndex((k) => k.id.startsWith(prefix));
}

/** The strip shows at most the `max` most recent reads, oldest first. */
export function stripOf<T>(kept: readonly T[], max = MAX_STRIP): T[] {
  return kept.slice(Math.max(0, kept.length - max));
}

export const hash4 = (hash: string): string => hash.slice(0, 4);

// ---- This page's session, in memory only -------------------------------------------

let kept: SessionRead[] = [];
let current = -1;

export function sessionReads(): readonly SessionRead[] {
  return kept;
}

export function currentSessionRead(): SessionRead | null {
  return kept[current] ?? null;
}

export function currentSessionIndex(): number {
  return current;
}

export function selectSessionRead(index: number): SessionRead | null {
  if (index < 0 || index >= kept.length) return null;
  current = index;
  return kept[current];
}

export function stepSessionRead(direction: -1 | 1): SessionRead | null {
  return selectSessionRead(stepIndex(kept.length, current, direction));
}

export function findSessionReadByHash4(prefix: string): number {
  return findByHashPrefix(kept, prefix);
}

export interface AddedRead {
  entry: SessionRead;
  /**
   * True only for the very first read this page has ever kept. Reading the
   * identical photo again later is not this: the session was never
   * actually empty, it only looks that way from `insertRead`'s
   * de-duplication by hash, so this is decided before that runs, not from
   * the list's length afterward.
   */
  isFirstOfSession: boolean;
}

/** Adds a freshly read outfit to this page's in-memory session. Never touches disk. */
export function addSessionRead(read: Read, sourceCredit: string | null): AddedRead {
  const isFirstOfSession = kept.length === 0;
  const entry: SessionRead = { id: read.hash, at: Date.now(), sourceCredit, read };
  kept = insertRead(kept, entry);
  current = kept.findIndex((k) => k.id === entry.id);
  return { entry, isFirstOfSession };
}
