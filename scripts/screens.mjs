#!/usr/bin/env node
// Screenshots of the real build in a real browser, taken in CI so nobody's
// laptop has to run the models (founder, 2026-10-03: the machine is busy).
// It serves dist/, opens it in headless Chromium at phone and desktop widths,
// reads the sample painting, tries the first suggested look, moves the wipe,
// and saves a card. Every image lands in screens/ for the workflow to upload;
// the Chief of Staff brings them into Claude for review.
//
// The page is an app frame (design/BRAND.md, Stage and sheet): on the phone
// the reading rides a sheet with three resting places. The sheet listens
// for a `ratio:snap` event (its test hook), which this script uses to put
// the sheet where a finger would before each step.
//
// Playwright is installed by the workflow only (npm install --no-save), so
// it is not a project dependency and never runs on a laptop by accident.

import { mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repoRoot, "screens");
const base = process.argv[2] ?? "http://localhost:4173";
mkdirSync(out, { recursive: true });

const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};

// What the page ships: every script and style in dist/assets, by size.
try {
  const assets = path.join(repoRoot, "dist", "assets");
  const kb = (n) => `${(n / 1024).toFixed(1)} kB`;
  for (const f of readdirSync(assets).filter((f) => /\.(js|css)$/.test(f)).sort()) note(`asset: ${f} ${kb(statSync(path.join(assets, f)).size)}`);
} catch {
  // No dist: the sizes are a courtesy, not a check.
}

async function run(name, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  // The preview server has no Worker, so the count endpoints (/e, /feedback)
  // answer 404 here; any other failed request is a finding.
  page.on("response", (r) => {
    if (r.status() >= 400 && !/^\/(e|feedback)$/.test(new URL(r.url()).pathname)) errors.push(`${r.status()} ${r.url()}`);
  });
  page.on("console", (m) => m.type() === "error" && !/Failed to load resource|TensorFlow Lite|XNNPACK/.test(m.text()) && errors.push(m.text()));
  const shot = async (step) => {
    await page.screenshot({ path: path.join(out, `${name}-${step}.png`), fullPage: true });
    note(`${name}: ${step}`);
  };
  const snap = (to) => page.evaluate((to) => document.getElementById("sheet")?.dispatchEvent(new CustomEvent("ratio:snap", { detail: to })), to);
  const phone = viewport.width < 1024;

  const t0 = Date.now();
  await page.goto(base, { waitUntil: "networkidle" });
  const nav = await page.evaluate(() => {
    const n = performance.getEntriesByType("navigation")[0];
    return n ? { interactive: Math.round(n.domInteractive), contentLoaded: Math.round(n.domContentLoadedEventEnd), load: Math.round(n.loadEventEnd) } : null;
  });
  note(`${name}: first screen: domInteractive ${nav?.interactive} ms, DOMContentLoaded ${nav?.contentLoaded} ms, load ${nav?.load} ms (wall ${Date.now() - t0} ms, no throttling)`);
  await shot("1-idle");

  const tRead = Date.now();
  await page.click("#try-sample");
  await page.waitForSelector("#reading-hash:not(:empty)", { timeout: 120_000 });
  note(`${name}: sample read in ${Date.now() - tRead} ms (models download included on a cold run)`);
  await page.waitForTimeout(3500);
  await shot("2-read");
  note(`${name}: ${await page.textContent("#reading-hash")}`);
  note(`${name}: hero: ${await page.textContent("#hero-n")} (${await page.textContent("#hero-eyebrow")})`);
  note(`${name}: verdict: ${await page.textContent("#verdict")}`);
  for (const row of await page.$$eval(".row", (rs) => rs.map((r) => `${r.querySelector(".row-t")?.textContent} | ${r.querySelector(".row-n")?.textContent} | ${r.getAttribute("data-state")}`))) note(`${name}:   ${row}`);

  const looks = await page.$$(".look .btn");
  note(`${name}: looks offered: ${looks.length}`);
  for (const t of await page.$$eval(".look-title", (ts) => ts.map((t) => t.textContent))) note(`${name}:   look: ${t}`);
  // Try each look in turn: screenshot the first, and the wipe on the first
  // look that changes the photo. On the phone the looks sit lower in the
  // sheet, so it is raised to full to press one; trying it drops the sheet
  // to half on its own so the photo and the wipe are in view.
  for (let i = 0; i < looks.length; i++) {
    if (phone) {
      await snap("full");
      await page.waitForTimeout(500);
    }
    await looks[i].click();
    await page.waitForTimeout(1800);
    if (i === 0) await shot("3-try");
    if (await page.isVisible("#wipe")) {
      await page.fill("#wipe", "25");
      await page.dispatchEvent("#wipe", "input");
      await page.waitForTimeout(300);
      await shot("4-wipe");
      note(`${name}: wipe shown on look ${i + 1}`);
      break;
    }
    if (i === looks.length - 1) note(`${name}: no look changes the photo, so no wipe`);
  }

  if (phone) {
    await snap("full");
    await page.waitForTimeout(500);
  }
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#save-card")]);
  await download.saveAs(path.join(out, `${name}-5-card.png`));
  note(`${name}: card saved (${download.suggestedFilename()})`);

  if (errors.length) note(`${name}: page errors:\n  ${errors.join("\n  ")}`);
  await browser.close();
  return errors.length;
}

const failures = (await run("phone", { width: 375, height: 812 })) + (await run("desktop", { width: 1280, height: 900 }));
writeFileSync(path.join(out, "log.txt"), log.join("\n") + "\n");
// A page error is a finding to review, never a silent pass; the job fails so it shows.
process.exit(failures ? 1 : 0);
