#!/usr/bin/env node
// Screenshots of the real build in a real browser, taken in CI so nobody's
// laptop has to run the models (founder, 2026-10-03: the machine is busy).
// It serves dist/, opens it in headless Chromium at phone and desktop widths,
// reads the sample painting, tries the first suggested look, moves the wipe,
// and saves a card. The Rulebook (/rules) is shot before the read and after
// it, when the read is marked on its instruments ("yours"), with a drill
// open and the keyboard on the proportion instrument; then the Face tab's
// "not yet built" drop cloth. Every image lands in screens/ for the workflow to upload;
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

  // The Rulebook before any read: every instrument at its band's middle.
  const rulesUrl = new URL("/rules", base).href;
  await page.goto(rulesUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(900);
  note(`${name}: rulebook: ${await page.$$eval(".rule", (r) => r.length)} rule cards; chip: ${(await page.textContent("#yours-chip"))?.trim()}`);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  if (overflow > 0) errors.push(`/rules scrolls sideways by ${overflow} px`);
  await shot("0-rules");

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
  note(`${name}: others line: ${(await page.isVisible("#others-note")) ? await page.textContent("#others-note") : "(none)"}`);
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

  // A look the photo does not show (a tuck, or a recolour refused as
  // doubtful): the chalk figure alone, and its saved card says the photo is
  // as worn (the verifier saw a card save fail after such a look).
  let chalkOnly = false;
  for (let i = 0; i < looks.length && !chalkOnly; i++) {
    if (phone) {
      await snap("full");
      await page.waitForTimeout(500);
    }
    await looks[i].click();
    await page.waitForTimeout(1800);
    const pressed = (await looks[i].getAttribute("aria-pressed")) === "true";
    if (!pressed || (await page.isVisible("#wipe"))) continue;
    chalkOnly = true;
    note(`${name}: chalk-only look ${i + 1}: ${await page.textContent(".trying-title")} | ${await page.textContent(".trying-note")}`);
    await shot("5b-chalk");
    if (phone) {
      await snap("full");
      await page.waitForTimeout(500);
    }
    const [chalkCard] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#save-card")]);
    await chalkCard.saveAs(path.join(out, `${name}-5c-card-chalk.png`));
    note(`${name}: card saved after a chalk-only look (${chalkCard.suggestedFilename()})`);
  }
  if (!chalkOnly) note(`${name}: every look changes the photo, so no chalk-only card`);

  // The Rulebook after the read: the last read in this tab marked on each instrument.
  // rule_opened is counted from the moment the page loads: none on load, one per rule opened.
  let ruleOpened = 0;
  page.on("request", (r) => {
    if (new URL(r.url()).pathname === "/e" && (r.postData() ?? "").includes("rule_opened")) ruleOpened++;
  });
  await page.goto(rulesUrl, { waitUntil: "networkidle" });
  await page.waitForTimeout(1200);
  note(`${name}: rulebook chip: ${(await page.textContent("#yours-chip"))?.replace(/\s+/g, " ").trim()}`);
  for (const y of await page.$$eval("[data-yours]", (ps) => ps.map((p) => `${p.getAttribute("data-yours")}: ${p.textContent?.replace(/\s+/g, " ").trim()}`))) note(`${name}:   ${y}`);
  await shot("6-rules-yours");
  // The keyboard moves the break; the drill opens (rule_opened).
  await page.focus('[data-range="proportion"]');
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowDown");
  note(`${name}: after 5 x ArrowDown: ${await page.textContent('[data-note="proportion"]')}`);
  // A press on an instrument away from its handle is the page's, never a new value.
  const before = await page.textContent('[data-note="volume"]');
  const vol = await page.$('[data-instrument="volume"]');
  await vol?.scrollIntoViewIfNeeded();
  const box = await vol?.boundingBox();
  if (box) await page.mouse.click(box.x + box.width - 6, box.y + box.height - 6);
  const after = await page.textContent('[data-note="volume"]');
  note(`${name}: press away from the volume handles leaves it: ${before === after}`);
  if (before !== after) errors.push("a press away from a handle moved the volume instrument");
  if (ruleOpened !== 0) errors.push(`rule_opened sent ${ruleOpened} times on load`);
  await page.click("#rule-proportion summary");
  await page.waitForTimeout(400);
  const firstOpen = ruleOpened;
  // Close and open the same drill again: still counted once for this visit.
  await page.click("#rule-proportion summary");
  await page.click("#rule-proportion summary");
  await page.waitForTimeout(400);
  note(`${name}: rule_opened on load 0, after the first open ${firstOpen}, after reopening the same drill ${ruleOpened}`);
  if (firstOpen !== 1) errors.push(`rule_opened sent ${firstOpen} times on opening a drill (want 1)`);
  if (ruleOpened !== 1) errors.push(`rule_opened sent again on reopening the same drill (${ruleOpened})`);
  await page.screenshot({ path: path.join(out, `${name}-7-rules-drill.png`), fullPage: false });
  note(`${name}: 7-rules-drill`);
  // A surface not built yet opens its drop cloth, never a dead tab.
  await page.click('.tabs [data-soon="face"]');
  await page.waitForTimeout(600);
  note(`${name}: face tab: ${await page.textContent("#soon-title")}`);
  await page.screenshot({ path: path.join(out, `${name}-8-face-soon.png`), fullPage: false });
  note(`${name}: 8-face-soon`);

  if (errors.length) note(`${name}: page errors:\n  ${errors.join("\n  ")}`);
  await browser.close();
  return errors.length;
}

const failures = (await run("phone", { width: 375, height: 812 })) + (await run("desktop", { width: 1280, height: 900 }));
writeFileSync(path.join(out, "log.txt"), log.join("\n") + "\n");
// A page error is a finding to review, never a silent pass; the job fails so it shows.
process.exit(failures ? 1 : 0);
