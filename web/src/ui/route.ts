// What a read does with the address bar when its reveal ends (T3 re-review
// 3). The URL is Read's own: `/#r=<hash4>` names the read on screen. While
// Rules shows, the address bar is `/rules` and stays so; the read instead
// refreshes the Rulebook's "yours" chip and its Back link, so they name the
// read that just finished. A route change during the reveal (urlGen moved
// on) means the read is no longer the route showing, so it writes nothing.

export type ReadTail = "write-url" | "refresh-rules" | "none";

export function readTail(s: { onRules: boolean; urlGenAtStart: number; urlGen: number }): ReadTail {
  if (s.onRules) return "refresh-rules";
  return s.urlGenAtStart === s.urlGen ? "write-url" : "none";
}

// The `/rules` history entry records which read sat below it (`below`, a
// hash4, or null for none). A read that finishes on Rules needs its own
// `/#r=` entry under `/rules` when that is not already it, so browser Back
// and "Back to your reading" land on the same read (T3 review 4). In the
// plain Read to Rules flow the entry below is already this read: no extra
// history entry.
export function readBelowRules(state: unknown, hash4: string): boolean {
  return (state as { below?: unknown } | null)?.below !== hash4;
}
