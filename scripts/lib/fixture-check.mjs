// The decisions scripts/fixture-hashes.mjs makes from its readings, kept
// pure so tests/fixture-check.test.ts can hold them to account without a
// browser (R3, docs/RISKS.md).

/**
 * Parses the script's arguments. `--allow-unsupported <browser>` (or
 * `=<browser>`, repeatable) is the reviewed, explicit way to let `--update`
 * record a browser the lock enforces as unsupported: never automatic.
 */
export function parseArgs(argv) {
  const out = { update: false, base: null, browsers: null, allowUnsupported: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--update") out.update = true;
    else if (a.startsWith("--browsers=")) out.browsers = a.slice("--browsers=".length).split(",").filter(Boolean);
    else if (a.startsWith("--allow-unsupported=")) out.allowUnsupported.push(...a.slice("--allow-unsupported=".length).split(",").filter(Boolean));
    else if (a === "--allow-unsupported") {
      const next = argv[i + 1];
      if (!next || next.startsWith("--")) throw new Error("fixture-hashes: --allow-unsupported needs a browser name");
      out.allowUnsupported.push(...next.split(",").filter(Boolean));
      i++;
    } else if (a.startsWith("--")) throw new Error(`fixture-hashes: unknown option "${a}"`);
    else if (out.base === null) out.base = a;
    else throw new Error(`fixture-hashes: unexpected argument "${a}"`);
  }
  return out;
}

/**
 * True when every fixture failed in this browser, all with the same error:
 * it cannot run the models at all, not a per-photo bug. Different errors on
 * different photos are bugs, never a known limit.
 */
export function allFailedAlike(resultsForBrowser, fixtureCount) {
  const results = Object.values(resultsForBrowser);
  if (results.length === 0 || results.length !== fixtureCount) return false;
  const errors = results.map((r) => r?.error);
  if (!errors.every((e) => typeof e === "string" && e.length > 0)) return false;
  return new Set(errors).size === 1;
}

/**
 * Different fixtures that came back with the same reading hash. Three
 * different photos cannot honestly share one reading: when they do, the
 * harness read the wrong photo (a restored reading, a stale tab), so both
 * the check and --update must fail on it.
 * @param {Record<string, { hash?: string, error?: string }>} byFixture
 * @returns {string[]} one line per collision
 */
export function duplicateHashes(byFixture) {
  const seen = new Map();
  const out = [];
  for (const [id, r] of Object.entries(byFixture)) {
    if (!r || r.error || typeof r.hash !== "string") continue;
    const prior = seen.get(r.hash);
    if (prior) out.push(`${prior} and ${id} gave the same hash ${r.hash}; different photos cannot share a reading, so the harness read the wrong photo`);
    else seen.set(r.hash, id);
  }
  return out;
}

/**
 * Browsers `--update` would turn from "ok" in the lock into unsupported
 * without the explicit flag. RISKS R3: a browser leaves agreement by a
 * reviewed decision only, never automatically.
 * @param {Record<string, string> | undefined} lockBrowsers
 * @param {string[]} nowUnsupported
 * @param {string[]} allowed
 */
export function refusedDowngrades(lockBrowsers, nowUnsupported, allowed) {
  return nowUnsupported.filter((b) => lockBrowsers?.[b] === "ok" && !allowed.includes(b));
}
