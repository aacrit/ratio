// R3's harness decisions (scripts/lib/fixture-check.mjs), held without a
// browser: a restored reading can never pass as three fixtures agreeing,
// "failed alike" means the same error, and --update never drops a browser
// the lock enforces unless told to by name.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { allFailedAlike, duplicateHashes, parseArgs, refusedDowngrades } from "../scripts/lib/fixture-check.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("duplicateHashes", () => {
  it("passes three different hashes", () => {
    expect(duplicateHashes({ sample: { hash: "a" }, p1: { hash: "b" }, p2: { hash: "c" } })).toEqual([]);
  });
  it("fails when two fixtures share a hash (the restored-reading bug)", () => {
    const out = duplicateHashes({ sample: { hash: "3abefce9f147" }, p1: { hash: "3abefce9f147" }, p2: { hash: "3abefce9f147" } });
    expect(out).toHaveLength(2);
    expect(out[0]).toContain("sample and p1");
  });
  it("ignores failed fixtures", () => {
    expect(duplicateHashes({ sample: { error: "x" }, p1: { error: "x" } })).toEqual([]);
  });
  it("holds for the committed lock", () => {
    const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));
    expect(duplicateHashes(lock.fixtures)).toEqual([]);
  });
});

describe("allFailedAlike", () => {
  it("is true only when every fixture failed with the same error", () => {
    expect(allFailedAlike({ a: { error: "no webgl" }, b: { error: "no webgl" }, c: { error: "no webgl" } }, 3)).toBe(true);
  });
  it("is false for different errors", () => {
    expect(allFailedAlike({ a: { error: "no webgl" }, b: { error: "decode" }, c: { error: "no webgl" } }, 3)).toBe(false);
  });
  it("is false when any fixture read", () => {
    expect(allFailedAlike({ a: { error: "x" }, b: { hash: "h" }, c: { error: "x" } }, 3)).toBe(false);
  });
  it("is false when a fixture is missing", () => {
    expect(allFailedAlike({ a: { error: "x" }, b: { error: "x" } }, 3)).toBe(false);
  });
});

describe("refusedDowngrades", () => {
  it("refuses turning an ok browser unsupported without the flag", () => {
    expect(refusedDowngrades({ webkit: "ok" }, ["webkit"], [])).toEqual(["webkit"]);
  });
  it("allows it when named by --allow-unsupported", () => {
    expect(refusedDowngrades({ webkit: "ok" }, ["webkit"], ["webkit"])).toEqual([]);
  });
  it("allows a browser the lock already records as unsupported, or does not list", () => {
    expect(refusedDowngrades({ webkit: "unsupported: x" }, ["webkit", "firefox"], [])).toEqual([]);
  });
});

describe("parseArgs", () => {
  it("reads both forms of --allow-unsupported without taking the browser for the base url", () => {
    expect(parseArgs(["http://x", "--update", "--allow-unsupported", "webkit", "--allow-unsupported=firefox"])).toEqual({
      update: true,
      base: "http://x",
      browsers: null,
      allowUnsupported: ["webkit", "firefox"],
    });
  });
  it("refuses unknown options and a bare --allow-unsupported", () => {
    expect(() => parseArgs(["--updat"])).toThrow();
    expect(() => parseArgs(["--allow-unsupported"])).toThrow();
  });
});
