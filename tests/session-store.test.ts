// The session store (web/src/session.ts): insertion, trimming, stepping and
// hash-prefix lookup are pure and DOM-free. Founder, 2026-10-04 (the photo
// is never stored): this session's reads are now a plain in-memory array,
// with no browser storage of any kind, so the stateful half (addSessionRead,
// isFirstOfSession, stepping and selecting) runs here too, not only in a
// browser (scripts/screens.mjs).

import { describe, expect, it } from "vitest";
import type { Read } from "../web/src/read";
import {
  addSessionRead,
  currentSessionIndex,
  currentSessionRead,
  findByHashPrefix,
  findSessionReadByHash4,
  insertRead,
  selectSessionRead,
  sessionReads,
  stepIndex,
  stepSessionRead,
  stripOf,
} from "../web/src/session";

const entry = (id: string) => ({ id });
/** Just enough of a Read for addSessionRead, which only ever looks at `hash`. */
const fakeRead = (hash: string) => ({ hash }) as unknown as Read;

describe("insertRead", () => {
  it("appends a new id at the end", () => {
    expect(insertRead([entry("a"), entry("b")], entry("c"))).toEqual([entry("a"), entry("b"), entry("c")]);
  });

  it("replaces an existing id in place of dropping it, moving it to the end (most recent last)", () => {
    expect(insertRead([entry("a"), entry("b")], entry("a"))).toEqual([entry("b"), entry("a")]);
  });

  it("drops the oldest once past max", () => {
    const kept = [entry("a"), entry("b"), entry("c")];
    expect(insertRead(kept, entry("d"), 3)).toEqual([entry("b"), entry("c"), entry("d")]);
  });

  it("never exceeds max even by one", () => {
    let kept: { id: string }[] = [];
    for (let i = 0; i < 20; i++) kept = insertRead(kept, entry(String(i)), 8);
    expect(kept.length).toBe(8);
    expect(kept[kept.length - 1]).toEqual(entry("19"));
  });

  it("re-adding the same id (the same photo, read again) does not grow the list: the length alone can never tell a second read of the same photo from the session's first read", () => {
    const afterFirst = insertRead([], entry("a"));
    const afterSecond = insertRead(afterFirst, entry("a"));
    expect(afterSecond.length).toBe(afterFirst.length);
    // This is exactly why session.ts's addSessionRead decides "is this the
    // session's first read" from the list's length *before* calling
    // insertRead, never from the length afterward.
  });
});

describe("stepIndex", () => {
  it("clamps at the start and the end rather than wrapping", () => {
    expect(stepIndex(3, 0, -1)).toBe(0);
    expect(stepIndex(3, 2, 1)).toBe(2);
  });

  it("steps by one in either direction", () => {
    expect(stepIndex(3, 1, -1)).toBe(0);
    expect(stepIndex(3, 1, 1)).toBe(2);
  });

  it("is -1 for an empty list", () => {
    expect(stepIndex(0, 0, 1)).toBe(-1);
  });
});

describe("findByHashPrefix", () => {
  it("finds the read whose id starts with the fragment's hash4", () => {
    const kept = [entry("12eb34"), entry("89f0aa")];
    expect(findByHashPrefix(kept, "89f0")).toBe(1);
  });

  it("is -1 for no match or an empty prefix", () => {
    const kept = [entry("12eb34")];
    expect(findByHashPrefix(kept, "zzzz")).toBe(-1);
    expect(findByHashPrefix(kept, "")).toBe(-1);
  });
});

describe("stripOf", () => {
  it("keeps at most the last `max`, oldest first", () => {
    const kept = ["a", "b", "c", "d", "e", "f"].map(entry);
    expect(stripOf(kept, 5)).toEqual(kept.slice(1));
  });

  it("returns everything when there are fewer than max", () => {
    const kept = [entry("a"), entry("b")];
    expect(stripOf(kept, 5)).toEqual(kept);
  });
});

// This page's own in-memory session (addSessionRead and friends): one
// sequential story, since the state is module-level, not a fresh value per
// test. Hashes here are unique to this describe block so earlier tests'
// vitest module instance (each test file gets its own) cannot bleed in.
describe("addSessionRead, this page's in-memory session", () => {
  it("the first read of the page is isFirstOfSession; a second read of it again is not", () => {
    const first = addSessionRead(fakeRead("aaaa1111"), null);
    expect(first.isFirstOfSession).toBe(true);
    expect(sessionReads().map((r) => r.id)).toEqual(["aaaa1111"]);
    expect(currentSessionRead()?.id).toBe("aaaa1111");

    // The exact same photo, read again: insertRead's de-duplication keeps
    // the list at length 1, but this is not the page's first read.
    const again = addSessionRead(fakeRead("aaaa1111"), null);
    expect(again.isFirstOfSession).toBe(false);
    expect(sessionReads().length).toBe(1);
  });

  it("a genuinely new read is not isFirstOfSession once something is already kept, is found by its hash prefix, and stepping/selecting moves the current one", () => {
    addSessionRead(fakeRead("bbbb2222"), "a sample credit");
    const third = addSessionRead(fakeRead("cccc3333"), null);
    expect(third.isFirstOfSession).toBe(false);
    expect(sessionReads().map((r) => r.id)).toEqual(["aaaa1111", "bbbb2222", "cccc3333"]);
    expect(currentSessionRead()?.id).toBe("cccc3333");
    expect(currentSessionIndex()).toBe(2);

    expect(findSessionReadByHash4("bbbb")).toBe(1);
    expect(selectSessionRead(1)?.id).toBe("bbbb2222");
    expect(currentSessionRead()?.id).toBe("bbbb2222");

    expect(stepSessionRead(-1)?.id).toBe("aaaa1111");
    expect(stepSessionRead(-1)?.id).toBe("aaaa1111"); // clamped at the start: [ at the end does nothing
    expect(stepSessionRead(1)?.id).toBe("bbbb2222");
  });
});
