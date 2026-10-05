// T3 re-review 3: the pure decisions behind two fixes. The browser-level
// regressions (a failed re-read of a different aspect ratio, a read that
// finishes on Rules, the Face/Card cloth on Rules) are asserted in
// scripts/screens.mjs, which drives the real build.

import { describe, expect, it } from "vitest";
import { readBelowRules, readTail } from "../web/src/ui/route";
import { type RowLike, rowOpen, syncRowsExpanded } from "../web/src/ui/rows";

describe("readTail: what a finished read does with the address bar", () => {
  it("writes /#r= only on Read, and only when no route change happened mid-reveal", () => {
    expect(readTail({ onRules: false, urlGenAtStart: 3, urlGen: 3 })).toBe("write-url");
    expect(readTail({ onRules: false, urlGenAtStart: 3, urlGen: 5 })).toBe("none");
  });

  it("never writes /#r= over /rules: a read that finishes while Rules shows refreshes the Rulebook's chip and Back link instead", () => {
    expect(readTail({ onRules: true, urlGenAtStart: 3, urlGen: 3 })).toBe("refresh-rules");
    expect(readTail({ onRules: true, urlGenAtStart: 3, urlGen: 4 })).toBe("refresh-rules");
  });
});

describe("readBelowRules: Back from Rules lands on the read the Back link names", () => {
  it("asks for the new read's entry under /rules when the entry below names another read, or none", () => {
    expect(readBelowRules({ route: "rules", below: "6e48" }, "ef1b")).toBe(true);
    expect(readBelowRules({ route: "rules", below: null }, "ef1b")).toBe(true);
    expect(readBelowRules(null, "ef1b")).toBe(true);
  });

  it("adds nothing in the plain Read to Rules flow, where the entry below already names this read", () => {
    expect(readBelowRules({ route: "rules", below: "ef1b" }, "ef1b")).toBe(false);
  });
});

/** A row with a head button that records its aria-expanded. */
function fakeRow(opened: boolean, expanded: string) {
  const head = { expanded, setAttribute: (_n: string, v: string) => (head.expanded = v) };
  const row: RowLike & { head: typeof head } = { dataset: opened ? { open: "" } : {}, querySelector: () => head, head };
  return row;
}

describe("Compact keeps every row head's aria-expanded true to what shows", () => {
  it("a row is open outside Compact, and in Compact only once opened", () => {
    expect(rowOpen(false, false)).toBe(true);
    expect(rowOpen(false, true)).toBe(true);
    expect(rowOpen(true, false)).toBe(false);
    expect(rowOpen(true, true)).toBe(true);
  });

  it("toggling Compact on re-says unopened rows as collapsed, opened rows as expanded", () => {
    const rows = [fakeRow(false, "true"), fakeRow(true, "true")];
    syncRowsExpanded(rows, true);
    expect(rows.map((r) => r.head.expanded)).toEqual(["false", "true"]);
  });

  it("toggling Compact off re-says every row as expanded", () => {
    const rows = [fakeRow(false, "false"), fakeRow(true, "true")];
    syncRowsExpanded(rows, false);
    expect(rows.map((r) => r.head.expanded)).toEqual(["true", "true"]);
  });
});
