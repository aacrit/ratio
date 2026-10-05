#!/usr/bin/env node
// R3 enforcer ("Golden hashes for the fixture photos in Chromium, Firefox
// and WebKit", docs/RISKS.md): reads the same three fixtures in all three
// engines and fails the gate the moment they disagree, with each other or
// with the pinned truth in fixtures.lock.json.
//
// The fixtures are the first-visit sample (Napoleon, staged like the models
// by scripts/fetch-models.mjs) and the two UX-pass photos p1/p2
// (scripts/screens.mjs), all pinned by URL and SHA-256 and never committed.
//
// Each fixture is read through the real UI path: the photo file input, the
// real read worker, the real models. The reading this script compares is
// the same one law 2 (CLAUDE.md) is about: the hash over ENGINE_VERSION and
// the bins (web/src/engine/hash.ts). Rather than scrape the DOM for the
// numbers, it reads the "last read" the app already hands itself for the
// Rulebook page (web/src/rules/handoff.ts, sessionStorage key
// "ratio:last-read"): the same bins, parsed back through that file's own
// validator, so a malformed reading cannot pass as a match by accident.
//
// Usage:
//   node scripts/fixture-hashes.mjs [base-url]
//     [--update]                 rewrite the lock; only when every browser
//                                 that can run agrees with every other
//     [--browsers=chromium,...]  which engines to launch (default: all
//                                 three; local smoke runs should pass
//                                 --browsers=chromium only, never update)
//
// Playwright is its own launch here (npm install --no-save playwright in
// the workflow), never an MCP browser session.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, firefox, webkit } from "playwright";
import { SAMPLES } from "./fetch-models.mjs";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const lockPath = path.join(repoRoot, "fixtures.lock.json");

const args = process.argv.slice(2);
const update = args.includes("--update");
const base = args.find((a) => !a.startsWith("--")) ?? "http://localhost:4173";
const browsersArg = args.find((a) => a.startsWith("--browsers="));
const ENGINES = { chromium, firefox, webkit };
const browserNames = browsersArg ? browsersArg.slice("--browsers=".length).split(",").filter(Boolean) : ["chromium", "firefox", "webkit"];
for (const b of browserNames) if (!(b in ENGINES)) throw new Error(`fixture-hashes: unknown browser "${b}"`);

// By URL and SHA-256, same pins scripts/screens.mjs uses for p1/p2, and the
// same sample fetch-models.mjs stages for the first visit. Never in git.
export const FIXTURES = {
  sample: { url: SAMPLES["napoleon.jpg"].url, sha256: SAMPLES["napoleon.jpg"].sha256 },
  p1: {
    url: "https://upload.wikimedia.org/wikipedia/commons/7/74/140111-Stacie-Anaka.jpg",
    sha256: "1572c1bdfe4dce1ca0b0a248dfa775c8ce23bd78d29d80c2668dbfb90a61bc58",
  },
  p2: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/20140118115458IMG_4996_-_Yukicon_2014_-_matiast1.jpg/960px-20140118115458IMG_4996_-_Yukicon_2014_-_matiast1.jpg",
    sha256: "25ad81fea0000ff70bd86f3908cb32969368f1c587d9963ae02786e3dfb732ae",
  },
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Downloads and pins one fixture, caching it under .cache/fixtures/. Throws plainly when offline. */
async function stageFixture(id) {
  const { url, sha256: pin } = FIXTURES[id];
  const file = path.join(repoRoot, ".cache", "fixtures", `${id}.jpg`);
  if (existsSync(file) && sha256(readFileSync(file)) === pin) return file;
  let res;
  try {
    res = await fetch(url, { headers: { "user-agent": "ratio-ci/1 (+https://ratio.voidvision.org)" } });
  } catch (e) {
    throw new Error(`fixture "${id}" could not be downloaded (offline?): ${url}: ${e.message}`);
  }
  if (!res.ok) throw new Error(`fixture "${id}" could not be downloaded: ${url} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const got = sha256(buf);
  if (got !== pin) throw new Error(`fixture "${id}": sha256 ${got}, pinned ${pin} (the file at ${url} has changed)`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return file;
}

/** Reads one fixture in one open page and returns the reading handoff.ts already validates (web/src/rules/handoff.ts). */
async function readFixture(page, file) {
  await page.goto(base, { waitUntil: "networkidle" });
  await page.setInputFiles("#photo", file);
  await Promise.race([
    page.waitForSelector("#reading-hash:not(:empty)", { timeout: 150_000 }),
    page.waitForSelector('#read-status[data-state="error"]', { timeout: 150_000 }),
  ]);
  const errorText = await page.evaluate(() => document.getElementById("read-status")?.getAttribute("data-state") === "error" ? document.getElementById("read-status")?.textContent ?? "read failed" : null);
  if (errorText) throw new Error(errorText);
  const raw = await page.evaluate(() => sessionStorage.getItem("ratio:last-read"));
  if (!raw) throw new Error("no reading handed to sessionStorage (ratio:last-read) after a completed read");
  const last = JSON.parse(raw);
  // A human-readable extra for the diff: palette names and the verdict line.
  const paletteLabel = await page.getAttribute(".palette", "aria-label").catch(() => null);
  const verdict = await page.textContent("#verdict").catch(() => null);
  return { engine: last.engine, hash: last.hash, bins: last.bins, lines: last.lines, paletteLabel, verdict };
}

/**
 * A console message as text, with every argument serialised where it lives
 * (page or worker): an Error's name, message and stack, never the
 * "JSHandle@object" Firefox and WebKit print for a non-primitive.
 */
async function describeConsole(m) {
  const parts = await Promise.all(
    m.args().map((h) =>
      h
        .evaluate((v) => {
          if (v instanceof Error) return `${v.name}: ${v.message}${v.stack ? `\n${v.stack}` : ""}`;
          if (v && typeof v === "object") {
            try {
              return JSON.stringify(v, Object.getOwnPropertyNames(v));
            } catch {
              return String(v);
            }
          }
          return String(v);
        })
        .catch(() => null),
    ),
  );
  return parts.length && parts.every((p) => p !== null) ? parts.join(" ") : m.text();
}

/**
 * What the read worker (and the page) can offer MediaPipe: tasks-vision
 * uploads every input image as a WebGL2 texture, on the CPU delegate too
 * (vision.ts), from an OffscreenCanvas when it is given one in a worker.
 */
async function probeCapabilities(page) {
  const probe = () => {
    const out = { where: typeof document === "undefined" ? "worker" : "page", offscreenCanvas: typeof OffscreenCanvas !== "undefined" };
    try {
      out.offscreenWebgl2 = out.offscreenCanvas ? !!new OffscreenCanvas(1, 1).getContext("webgl2") : false;
    } catch (e) {
      out.offscreenWebgl2 = `throws ${e}`;
    }
    return out;
  };
  const seen = [];
  for (const target of [...page.workers(), page]) {
    seen.push(await target.evaluate(probe).catch((e) => ({ where: "?", error: String(e) })));
  }
  const ua = await page.evaluate(() => navigator.userAgent).catch(() => "?");
  return `${seen.map((s) => `${s.where}: OffscreenCanvas ${s.offscreenCanvas ? "yes" : "no"}, WebGL2 on it ${s.offscreenWebgl2 === true ? "yes" : s.offscreenWebgl2 || "no"}`).join("; ")} (${process.platform}, ${ua})`;
}

/**
 * Diagnostic: the browser's own decode of the file (no colour conversion),
 * as a short SHA-256 of its RGBA pixels. When two engines disagree, equal
 * digests put the cause after decoding (the models or our arithmetic),
 * different ones put it in the decoder.
 */
async function decodeDigest(page, file) {
  const b64 = readFileSync(file).toString("base64");
  return page
    .evaluate(async (b64) => {
      const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
      const bitmap = await createImageBitmap(new Blob([bytes], { type: "image/jpeg" }), { imageOrientation: "from-image", colorSpaceConversion: "none" });
      const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(bitmap, 0, 0);
      const data = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" }).data;
      const digest = new Uint8Array(await crypto.subtle.digest("SHA-256", data));
      return `${bitmap.width}x${bitmap.height} ${[...digest.slice(0, 6)].map((x) => x.toString(16).padStart(2, "0")).join("")}`;
    }, b64)
    .catch((e) => `decode failed: ${e.message}`);
}

/** True when every fixture failed with the same kind of error in this browser: it cannot run the models at all, not a per-photo bug. */
function allFailedAlike(resultsForBrowser) {
  const errors = Object.values(resultsForBrowser).map((r) => r.error);
  return errors.every((e) => e) && new Set(errors).size <= Object.keys(FIXTURES).length && errors.length === Object.keys(FIXTURES).length;
}

function deepDiff(a, b, prefix = "") {
  const out = [];
  if (a === b) return out;
  if (typeof a !== typeof b || a === null || b === null || typeof a !== "object") {
    if (JSON.stringify(a) !== JSON.stringify(b)) out.push(`${prefix || "(value)"}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`);
    return out;
  }
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const k of keys) out.push(...deepDiff(a[k], b[k], prefix ? `${prefix}.${k}` : k));
  return out;
}

async function main() {
  console.log(`fixture-hashes: base ${base}, browsers ${browserNames.join(", ")}${update ? ", --update" : ""}`);

  let files;
  try {
    files = Object.fromEntries(await Promise.all(Object.keys(FIXTURES).map(async (id) => [id, await stageFixture(id)])));
  } catch (e) {
    // Never a silent pass: no fixtures, no verdict.
    console.error(`fixture-hashes: ${e.message}`);
    process.exit(1);
  }

  /** @type {Record<string, Record<string, any>>} */
  const results = {};
  /** @type {Record<string, string>} */
  const probes = {};
  for (const name of browserNames) {
    const browser = await ENGINES[name].launch();
    try {
      const context = await browser.newContext({ viewport: { width: 1280, height: 900 } });
      // The static preview has no Worker, so /e (the reading_completed count,
      // CLAUDE.md) would answer 404 on every read: answered here as the
      // Worker does, so the log carries only real failures.
      await context.route("**/e", (route) => route.fulfill({ status: 204 }));
      const page = await context.newPage();
      // Diagnostic only: when a browser cannot run the models, the page's own
      // console and uncaught errors say why (a WASM instantiation failure, a
      // missing capability, a blocked fetch), printed so a known limit in the
      // lock is backed by a real reason, never a guess.
      const onConsole = async (m) => {
        if (m.type() !== "error") return;
        console.log(`fixture-hashes: ${name} console: ${await describeConsole(m)}`);
      };
      page.on("console", onConsole);
      // The read runs in a module worker: its console reaches the page in
      // Chromium only, so each worker is listened to as well.
      page.on("worker", (w) => w.on("console", onConsole));
      page.on("pageerror", (e) => console.log(`fixture-hashes: ${name} pageerror: ${e.stack ?? e}`));
      // A 404 names its URL, so a missing file is never a mystery in the log.
      context.on("response", (r) => { if (r.status() >= 400) console.log(`fixture-hashes: ${name} ${r.status()} ${r.url()}`); });
      context.on("requestfailed", (r) => r.url().endsWith("/e") || console.log(`fixture-hashes: ${name} request failed: ${r.url()} (${r.failure()?.errorText})`));
      results[name] = {};
      for (const [id, file] of Object.entries(files)) {
        try {
          results[name][id] = await readFixture(page, file);
          results[name][id].decoded = await decodeDigest(page, file);
        } catch (e) {
          results[name][id] = { error: e.message };
        }
      }
      // When nothing read, ask the read worker itself what it has: the
      // reason recorded in the lock is then a measured capability, never the
      // visitor-facing copy.
      if (Object.values(results[name]).every((r) => r.error)) probes[name] = await probeCapabilities(page);
    } finally {
      await browser.close();
    }
  }

  // Full readings, always printed: the record a maintainer needs to hand-verify
  // a diagnosis, and what bootstraps fixtures.lock.json the first time (read
  // the JSON back out of the CI log and pass it to --update's output, or copy
  // it straight into the lock when every browser's line below is identical).
  for (const name of browserNames) {
    for (const [id, r] of Object.entries(results[name])) {
      console.log(`fixture-hashes: reading ${name}/${id}: ${r.error ? `ERROR: ${r.error}` : JSON.stringify({ engine: r.engine, hash: r.hash, bins: r.bins, lines: r.lines, paletteLabel: r.paletteLabel })}`);
      if (r.decoded) console.log(`fixture-hashes: decoded ${name}/${id}: ${r.decoded}`);
    }
  }

  const lock = existsSync(lockPath) ? JSON.parse(readFileSync(lockPath, "utf8")) : null;
  const engineNow = Object.values(results).flatMap((r) => Object.values(r)).find((r) => r.engine)?.engine ?? null;

  // A browser that cannot run the models at all (R3's known-limit clause).
  // Checking, it fails the run unless fixtures.lock.json already records it
  // as "unsupported: <reason>" (a reviewed decision, visible in the diff):
  // a browser the lock enforces never drops out of agreement silently.
  let failed = false;
  const problems = [];
  const unsupported = {};
  for (const name of browserNames) {
    if (allFailedAlike(results[name])) {
      const reason = probes[name] ?? Object.values(results[name])[0]?.error ?? "could not run the models";
      unsupported[name] = `unsupported: ${reason}`;
      const recorded = lock?.browsers?.[name];
      if (!update && !(typeof recorded === "string" && recorded.startsWith("unsupported:"))) {
        failed = true;
        problems.push(`${name}: could not run any fixture, and fixtures.lock.json enforces it (${reason})`);
      } else console.warn(`fixture-hashes: ${name} could not run any fixture (${reason}); ${update ? "will be recorded" : "recorded"} as a known limit, excluded from agreement`);
    }
  }
  const supported = browserNames.filter((n) => !unsupported[n]);
  if (supported.length === 0) {
    console.error(`fixture-hashes: no browser could run the models; nothing to verify${problems.length ? `\n${problems.map((p) => `  - ${p}`).join("\n")}` : ""}`);
    process.exit(1);
  }

  // A browser that failed only some fixtures (not all alike) is a real bug, never a known limit.
  for (const name of supported) {
    for (const [id, r] of Object.entries(results[name])) {
      if (r.error) {
        failed = true;
        problems.push(`${name}/${id}: failed to read: ${r.error}`);
      }
    }
  }

  const newFixtures = {};
  for (const id of Object.keys(FIXTURES)) {
    const byBrowser = Object.fromEntries(supported.map((n) => [n, results[n][id]]).filter(([, r]) => !r.error));
    const names = Object.keys(byBrowser);
    if (names.length === 0) continue;
    const first = byBrowser[names[0]];
    for (const n of names.slice(1)) {
      const other = byBrowser[n];
      if (other.hash !== first.hash) {
        failed = true;
        problems.push(`${id}: ${names[0]} and ${n} disagree (hash ${first.hash} vs ${other.hash})`);
        problems.push(...deepDiff(first.bins, other.bins, `${id}.bins`).map((l) => `  ${l}`));
      }
    }
    newFixtures[id] = { ...FIXTURES[id], engine: first.engine, hash: first.hash, bins: first.bins, lines: first.lines, paletteLabel: first.paletteLabel };

    if (lock && !update) {
      const locked = lock.fixtures?.[id];
      if (locked) {
        if (lock.engine !== engineNow) {
          failed = true;
          problems.push(`${id}: engine bumped (lock has "${lock.engine}", code has "${engineNow}") but fixtures.lock.json was not updated; run \`node scripts/fixture-hashes.mjs --update\``);
        } else if (locked.hash !== first.hash) {
          failed = true;
          problems.push(`${id}: a hash changed without an engine bump (lock ${locked.hash}, now ${first.hash})`);
          problems.push(...deepDiff(locked.bins, first.bins, `${id}.bins`).map((l) => `  ${l}`));
        }
      } else {
        failed = true;
        problems.push(`${id}: no entry in fixtures.lock.json; run \`node scripts/fixture-hashes.mjs --update\``);
      }
    }
  }

  if (problems.length) console.error(`fixture-hashes: disagreement found\n${problems.map((p) => `  - ${p}`).join("\n")}`);

  if (update) {
    if (failed) {
      console.error("fixture-hashes: --update refused; the browsers above do not agree, so there is nothing true to write");
      process.exit(1);
    }
    // Browsers not run here keep what the lock said about them (WebKit is
    // read on the macOS runner only, see .github/workflows/gate.yml).
    const browsers = { ...(lock?.browsers ?? {}), ...Object.fromEntries([...supported.map((n) => [n, "ok"]), ...Object.entries(unsupported)]) };
    const next = { engine: engineNow, fixtures: newFixtures, browsers };
    writeFileSync(lockPath, JSON.stringify(next, null, 2) + "\n");
    console.log(`fixture-hashes: fixtures.lock.json updated (engine ${engineNow}, ${Object.keys(newFixtures).length} fixtures, browsers: ${Object.keys(next.browsers).join(", ")})`);
    return;
  }

  if (!lock) {
    console.error("fixture-hashes: no fixtures.lock.json to compare against; run with --update once all browsers agree");
    process.exit(1);
  }

  if (failed) process.exit(1);
  console.log(`fixture-hashes: ${Object.keys(FIXTURES).length} fixtures agree across ${supported.join(", ")}${Object.keys(unsupported).length ? ` (known limit: ${Object.keys(unsupported).join(", ")})` : ""}`);
}

main();
