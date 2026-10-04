// A fast unit check for R3's engine-version rule (law 2, docs/RISKS.md): the
// full three-browser comparison (scripts/fixture-hashes.mjs, the
// `determinism` CI job) is slow, so a bumped ENGINE_VERSION with a stale
// lock fails here first, in the same `npm run test` step the quick `gate`
// job already runs.

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ENGINE_VERSION } from "../web/src/engine/rules";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lock = JSON.parse(readFileSync(path.join(repoRoot, "fixtures.lock.json"), "utf8"));

describe("fixtures.lock.json tracks ENGINE_VERSION", () => {
  it("has an engine field", () => {
    expect(typeof lock.engine).toBe("string");
  });

  it("matches the engine the code ships (run `node scripts/fixture-hashes.mjs --update` after an ENGINE_VERSION bump)", () => {
    expect(lock.engine, `fixtures.lock.json says "${lock.engine}" but web/src/engine/rules.ts ships "${ENGINE_VERSION}". Run \`node scripts/fixture-hashes.mjs --update\` (all three browsers must agree) and commit the result.`).toBe(ENGINE_VERSION);
  });

  it("has an entry for every committed fixture", () => {
    for (const id of ["sample", "p1", "p2"]) {
      expect(lock.fixtures, `fixtures.lock.json is missing "${id}"`).toHaveProperty(id);
      expect(typeof lock.fixtures[id].hash).toBe("string");
      expect(typeof lock.fixtures[id].sha256).toBe("string");
    }
  });
});
