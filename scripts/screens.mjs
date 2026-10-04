#!/usr/bin/env node
// Screenshots of the real build in a real browser, taken in CI so nobody's
// laptop has to run the models (founder, 2026-10-03: the machine is busy).
// It serves dist/, opens it in headless Chromium at phone and desktop widths,
// reads the sample painting, tries the first suggested look, moves the wipe,
// and saves a card. Every image lands in screens/ for the workflow to upload;
// the Chief of Staff brings them into Claude for review.
//
// Playwright is installed by the workflow only (npm install --no-save), so
// it is not a project dependency and never runs on a laptop by accident.

import { mkdirSync, writeFileSync } from "node:fs";
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

async function run(name, viewport) {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, colorScheme: "dark", acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (m) => m.type() === "error" && !/\/e\b|TensorFlow Lite|XNNPACK/.test(m.text()) && errors.push(m.text()));
  const shot = async (step) => {
    await page.screenshot({ path: path.join(out, `${name}-${step}.png`), fullPage: true });
    note(`${name}: ${step}`);
  };

  await page.goto(base, { waitUntil: "networkidle" });
  await shot("1-idle");

  await page.click("#try-sample");
  await page.waitForSelector("#reading-hash:not(:empty)", { timeout: 120_000 });
  await page.waitForTimeout(3500);
  await shot("2-read");
  note(`${name}: ${await page.textContent("#reading-hash")}`);
  note(`${name}: verdict: ${await page.textContent("#verdict")}`);
  for (const row of await page.$$eval(".row", (rs) => rs.map((r) => `${r.querySelector(".row-t")?.textContent} | ${r.querySelector(".row-n")?.textContent} | ${r.getAttribute("data-state")}`))) note(`${name}:   ${row}`);

  const looks = await page.$$(".look .btn");
  note(`${name}: looks offered: ${looks.length}`);
  for (const t of await page.$$eval(".look-title", (ts) => ts.map((t) => t.textContent))) note(`${name}:   look: ${t}`);
  if (looks.length) {
    await looks[0].click();
    await page.waitForTimeout(1600);
    await shot("3-try");
    if (await page.isVisible("#wipe")) {
      await page.fill("#wipe", "25");
      await page.dispatchEvent("#wipe", "input");
      await page.waitForTimeout(300);
      await shot("4-wipe");
    } else note(`${name}: the first look has no colour move, so no wipe`);
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
