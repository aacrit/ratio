#!/usr/bin/env node
// Lighthouse on the built page, mobile, in CI (the screens workflow): the
// first screen must be app-grade (founder, 2026-10-04). Performance and
// accessibility must each score at least 95 or the job fails. Two runs,
// best of two, because a shared runner adds a few points of noise to the
// throttled metrics; the report of the better run lands in screens/ with
// the screenshots.
//
// Lighthouse is installed by the workflow only (npm install --no-save) and
// drives the Chromium that Playwright installed (CHROME_PATH).

import { spawnSync } from "node:child_process";
import { mkdirSync, readFileSync, renameSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repoRoot, "screens");
mkdirSync(out, { recursive: true });
const url = process.argv[2] ?? "http://localhost:4173/";
const TARGET = { performance: 0.95, accessibility: 0.95 };
const RUNS = 2;

function once(i) {
  const file = path.join(out, `lighthouse-${i}.json`);
  const cli = path.join(repoRoot, "node_modules", "lighthouse", "cli", "index.js");
  const r = spawnSync(
    process.execPath,
    [cli, url, "--output=json", `--output-path=${file}`, "--only-categories=performance,accessibility", "--form-factor=mobile", "--quiet", "--chrome-flags=--headless=new --no-sandbox --disable-gpu --disable-dev-shm-usage"],
    { cwd: repoRoot, stdio: "inherit", env: process.env },
  );
  if (r.status !== 0) throw new Error(`lighthouse exited ${r.status}`);
  const report = JSON.parse(readFileSync(file, "utf8"));
  const score = (c) => report.categories[c].score;
  const ms = (id) => Math.round(report.audits[id]?.numericValue ?? NaN);
  return {
    file,
    performance: score("performance"),
    accessibility: score("accessibility"),
    metrics: { fcp: ms("first-contentful-paint"), lcp: ms("largest-contentful-paint"), tti: ms("interactive"), tbt: ms("total-blocking-time"), si: ms("speed-index"), cls: report.audits["cumulative-layout-shift"]?.numericValue },
    failing: Object.values(report.audits).filter((a) => a.score !== null && a.score < 0.9 && a.scoreDisplayMode === "binary").map((a) => a.id),
  };
}

const runs = [];
for (let i = 1; i <= RUNS; i++) runs.push(once(i));
const best = runs.reduce((a, b) => (b.performance + b.accessibility > a.performance + a.accessibility ? b : a));
renameSync(best.file, path.join(out, "lighthouse.json"));

const pct = (s) => Math.round(s * 100);
for (const r of runs) console.log(`lighthouse: run ${r.file.slice(-6, -5)}: performance ${pct(r.performance)}, accessibility ${pct(r.accessibility)}; FCP ${r.metrics.fcp} ms, LCP ${r.metrics.lcp} ms, TTI ${r.metrics.tti} ms, TBT ${r.metrics.tbt} ms, SI ${r.metrics.si} ms, CLS ${r.metrics.cls}`);
console.log(`lighthouse: best of ${RUNS} (mobile, simulated throttling): performance ${pct(best.performance)}, accessibility ${pct(best.accessibility)}`);
if (best.failing.length) console.log(`lighthouse: failing audits: ${best.failing.join(", ")}`);

const under = Object.entries(TARGET).filter(([c, t]) => best[c] < t);
if (under.length) {
  console.error(`lighthouse: under target: ${under.map(([c, t]) => `${c} ${pct(best[c])} < ${pct(t)}`).join(", ")}`);
  process.exit(1);
}
console.log("lighthouse: on target");
