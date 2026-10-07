#!/usr/bin/env node
// Screenshots of the real build in a real browser, taken in CI so nobody's
// laptop has to run the models (founder, 2026-10-03: the machine is busy).
// It serves dist/, opens it in headless Chromium at phone and desktop widths,
// reads the sample painting, tries the first suggested look, moves the wipe,
// and saves a card. The Rulebook (/rules) is shot before the read and after
// it, when the read is marked on its instruments ("yours"), with a drill
// open and the keyboard on the proportion instrument; then the Face tab's
// "not yet built" drop cloth. Heavy use (T3) is shot too: the read menu, a
// failed re-read, a read finishing on Rules, the session strip, the
// shortcuts sheet, Compact on and the Card tab's preview. Every image lands in screens/ for the workflow to upload;
// the Chief of Staff brings them into Claude for review.
//
// The page is an app frame (design/BRAND.md, Stage and sheet): on the phone
// the reading rides a sheet with three resting places. The sheet listens
// for a `ratio:snap` event (its test hook), which this script uses to put
// the sheet where a finger would before each step.
//
// Playwright is installed by the workflow only (npm install --no-save), so
// it is not a project dependency and never runs on a laptop by accident.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
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

// The UX pass 2 photos (2026-10-04), read on every pull request so the
// reading can be checked against what a stylist sees on real photos.
// CC-licensed, from Wikimedia Commons, pinned by URL and SHA-256 and
// downloaded into .cache/ by this script: never in git, never served.
// p1: Calebrw, "140111-Stacie-Anaka.jpg", CC BY-SA 3.0. p2: Matias
// Tukiainen, "20140118115458IMG 4996 - Yukicon 2014 - matiast1.jpg"
// (the 960px rendition), CC BY 2.0.
const PHOTOS = {
  p1: {
    url: "https://upload.wikimedia.org/wikipedia/commons/7/74/140111-Stacie-Anaka.jpg",
    sha256: "1572c1bdfe4dce1ca0b0a248dfa775c8ce23bd78d29d80c2668dbfb90a61bc58",
  },
  p2: {
    url: "https://upload.wikimedia.org/wikipedia/commons/thumb/0/0d/20140118115458IMG_4996_-_Yukicon_2014_-_matiast1.jpg/960px-20140118115458IMG_4996_-_Yukicon_2014_-_matiast1.jpg",
    sha256: "25ad81fea0000ff70bd86f3908cb32969368f1c587d9963ae02786e3dfb732ae",
  },
};

async function photo(id) {
  const { url, sha256 } = PHOTOS[id];
  const file = path.join(repoRoot, ".cache", "photos", `${id}.jpg`);
  const sum = (buf) => createHash("sha256").update(buf).digest("hex");
  if (existsSync(file) && sum(readFileSync(file)) === sha256) return file;
  const res = await fetch(url, { headers: { "user-agent": "ratio-ci/1 (+https://ratio.voidvision.org)" } });
  if (!res.ok) throw new Error(`${id}: ${url} answered ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (sum(buf) !== sha256) throw new Error(`${id}: sha256 ${sum(buf)}, pinned ${sha256}`);
  mkdirSync(path.dirname(file), { recursive: true });
  writeFileSync(file, buf);
  return file;
}

/** Reads one pinned photo on the page and logs what the reading says: the verdict, every row, the palette and the looks. */
async function readPhotoShot(page, name, id, snap, phone, errors) {
  let file;
  try {
    file = await photo(id);
  } catch (e) {
    errors.push(`photo ${id} could not be staged: ${e.message}`);
    return;
  }
  await page.goto(base, { waitUntil: "networkidle" });
  await page.setInputFiles("#photo", file);
  await page.waitForSelector("#reading-hash:not(:empty)", { timeout: 120_000 });
  await page.waitForTimeout(3500);
  note(`${name}: ${id}: ${await page.textContent("#reading-hash")}`);
  note(`${name}: ${id}: verdict: ${await page.textContent("#verdict")}`);
  note(`${name}: ${id}: palette: ${await page.getAttribute(".palette", "aria-label")}`);
  if (phone) {
    await snap("full");
    await page.waitForTimeout(500);
  }
  // Open every row so the shot shows Measured, Rule and Advice.
  for (const row of await page.$$eval(".row", (rs) => rs.map((r) => `${r.querySelector(".row-t")?.textContent} | ${r.querySelector(".row-n")?.textContent} | ${r.getAttribute("data-state")} | ${r.querySelector(".row-b")?.textContent?.replace(/\s+/g, " ").trim()}`))) note(`${name}: ${id}:   ${row}`);
  for (const t of await page.$$eval(".look", (ls) => ls.map((l) => `${l.querySelector(".look-title")?.textContent} | ${l.querySelector(".look-moves")?.textContent} | ${[...l.querySelectorAll(".look-changes li")].map((c) => c.textContent).join("; ")}`))) note(`${name}: ${id}:   look: ${t}`);
  if ((await page.$$(".look")).length === 0) note(`${name}: ${id}:   looks: ${await page.textContent(".looks-intro")}`);
  await shot(page, name, `9-${id}`);
}

const shot = async (page, name, step) => {
  await page.screenshot({ path: path.join(out, `${name}-${step}.png`), fullPage: true });
  note(`${name}: ${step}`);
};

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

  // T3 re-review: leaving for Rules while the first read's full signature is
  // still revealing must not strand Read inert when you come back. The hash
  // (and so the look buttons, already disabled for the reveal) exist the
  // moment it is set above, well before the multi-second signature finishes,
  // so clicking Rules here lands well inside it.
  await page.click("#rules-tab");
  await page.waitForTimeout(100);
  await page.click("#read-tab");
  // The reveal keeps running in the background regardless of which route is
  // visible; give it time to actually finish before judging the result.
  await page.waitForFunction(() => document.body.dataset.revealing === undefined, { timeout: 5_000 }).catch(() => {});
  // The hero counts up from 0 (ui/count.ts sets data-counting while it
  // does): wait for the count to land, then hold it to the value measured,
  // which the first row states in full, so a mid-count "0.00 : 0.00" fails.
  await page.waitForSelector("#hero-n:not(:empty):not([data-counting])", { timeout: 5_000 }).catch(() => {});
  const heroAfterRaceBack = (await page.textContent("#hero-n"))?.trim();
  const firstRowMeasured = (await page.textContent(".row .row-n"))?.trim();
  const firstLookDisabledAfterRaceBack = await page.$eval(".look .btn", (b) => b.disabled).catch(() => null);
  note(`${name}: Rules during the first read's reveal, then back: hero "${heroAfterRaceBack}" (first row measured "${firstRowMeasured}"), Try it disabled: ${firstLookDisabledAfterRaceBack}`);
  if (!heroAfterRaceBack) errors.push("leaving for Rules during the first read's reveal left the hero numeral empty on return");
  else if (heroAfterRaceBack !== firstRowMeasured) errors.push(`leaving for Rules during the first read's reveal left the hero at "${heroAfterRaceBack}", not the measured "${firstRowMeasured}"`);
  if (firstLookDisabledAfterRaceBack !== false) errors.push("leaving for Rules during the first read's reveal left Try it disabled on return");

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
  let wipeShown = false;
  for (let i = 0; i < looks.length; i++) {
    if (phone) {
      await snap("full");
      await page.waitForTimeout(500);
    }
    await looks[i].click();
    await page.waitForTimeout(1800);
    if (i === 0) await shot("3-try");
    note(`${name}: look ${i + 1} note: ${await page.textContent(".trying-note")}`);
    if (await page.isVisible("#wipe")) {
      // The look must really change the photo: the stage at the wipe's two
      // ends (all as worn, all the look) must differ in its pixels.
      const at = async (v) => {
        await page.fill("#wipe", v);
        await page.dispatchEvent("#wipe", "input");
        await page.waitForTimeout(400);
        return page.evaluate(() => {
          const c = document.getElementById("figure");
          return Array.from(c.getContext("2d").getImageData(0, 0, c.width, c.height).data);
        });
      };
      const worn = await at("100");
      const tried = await at("0");
      let moved = 0;
      for (let p = 0; p < worn.length; p += 4) if (Math.abs(worn[p] - tried[p]) + Math.abs(worn[p + 1] - tried[p + 1]) + Math.abs(worn[p + 2] - tried[p + 2]) > 24) moved++;
      note(`${name}: look ${i + 1} changes ${moved} of ${worn.length / 4} stage pixels`);
      if (moved < 1000) continue;
      await page.fill("#wipe", "25");
      await page.dispatchEvent("#wipe", "input");
      await page.waitForTimeout(300);
      await shot("4-wipe");
      note(`${name}: wipe shown on look ${i + 1}`);
      wipeShown = true;
      break;
    }
  }
  // A regression guard: on the sample, at least one look must change the
  // photo. If none does, try-on is off and the job fails.
  if (!wipeShown) {
    note(`${name}: no look changes the photo`);
    errors.push("no suggested look changes the sample photo (try-on regression)");
  }

  if (phone) {
    await snap("full");
    await page.waitForTimeout(500);
  }
  const [download] = await Promise.all([page.waitForEvent("download", { timeout: 30_000 }), page.click("#save-card")]);
  await download.saveAs(path.join(out, `${name}-5-card.png`));
  note(`${name}: card saved (${download.suggestedFilename()})`);
  await page.waitForTimeout(1700); // the button's text (and the note) resets 1.6 s after
  const saveNoteText = await page.textContent("#save-note");
  note(`${name}: #save-note after a download: "${saveNoteText}"`);
  if (!saveNoteText?.includes(download.suggestedFilename())) errors.push(`#save-note did not confirm the download (was "${saveNoteText}")`);

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

  // Back to the outfit as worn before the next checks, so they read the
  // baseline reading's hand-off to the Rulebook, not whatever look was last tried.
  if (await page.isVisible(".trying-back")) {
    await page.click(".trying-back");
    await page.waitForTimeout(600);
  }

  // T3 founder decision (the photo is never stored): Rules opens in-app, no
  // page load, so Read -> Rules -> Read restores with no re-measure because
  // nothing ever unloads. The tab, not a goto.
  const hashBefore = (await page.textContent("#reading-hash"))?.trim();
  const verdictBefore = (await page.textContent("#verdict"))?.trim();
  // A real navigation (unlike history.pushState, which also fires
  // framenavigated, so that event is not a reliable signal here) tears down
  // the page's JS realm: a marker set on window would not survive it.
  await page.evaluate(() => (window.__t3NoReload = true));
  await page.click("#rules-tab");
  await page.waitForTimeout(500);
  const inAppPath = await page.evaluate(() => location.pathname);
  const survivedReload = await page.evaluate(() => window.__t3NoReload === true);
  const backVisible = await page.isVisible("#back-to-read");
  note(`${name}: in-app Rules: path ${inAppPath}, no reload: ${survivedReload}, "Back to your reading" visible: ${backVisible}`);
  if (inAppPath !== "/rules") errors.push(`clicking the Rules tab did not reach /rules in-app (path: ${inAppPath})`);
  if (!survivedReload) errors.push("the Rules tab caused a real page reload, not an in-app switch");
  if (!backVisible) errors.push('"Back to your reading" did not appear on Rules after a read');
  await page.click("#back-to-read");
  await page.waitForTimeout(500);
  const resultHidden = await page.isHidden("#result");
  const hashAfter = (await page.textContent("#reading-hash"))?.trim();
  const verdictAfter = (await page.textContent("#verdict"))?.trim();
  note(`${name}: Read -> Rules -> Read (in-app): result hidden ${resultHidden}, hash ${hashBefore} -> ${hashAfter}`);
  if (resultHidden || hashAfter !== hashBefore || verdictAfter !== verdictBefore) errors.push("Read -> Rules -> Read did not restore the same read with no re-measure");

  // A row's "Why?" link opens Rules in-app at that rule's card, scrolled to
  // and focused - and the read underneath must survive it, the same as any
  // other in-app route change (T3 re-review: "Why? links do a full navigation").
  await page.click(".row-why");
  await page.waitForTimeout(500);
  const whyPath = await page.evaluate(() => location.pathname);
  const whyFocusedRule = await page.evaluate(() => document.activeElement?.closest(".rule")?.id ?? null);
  await page.click("#back-to-read");
  await page.waitForTimeout(500);
  const resultHiddenAfterWhy = await page.isHidden("#result");
  const hashAfterWhy = (await page.textContent("#reading-hash"))?.trim();
  note(`${name}: Why? link: path ${whyPath}, focused rule card: ${whyFocusedRule}; read survives: result hidden ${resultHiddenAfterWhy}, hash unchanged: ${hashAfterWhy === hashAfter}`);
  if (whyPath !== "/rules") errors.push(`a Why? link did not reach /rules in-app (path: ${whyPath})`);
  if (!whyFocusedRule) errors.push("a Why? link did not focus its rule card on the Rulebook");
  if (resultHiddenAfterWhy || hashAfterWhy !== hashAfter) errors.push("clicking a Why? link did not preserve the read underneath it");

  // Back/forward between Read and Rules, and between reads, work through popstate.
  await page.click("#rules-tab");
  await page.waitForTimeout(400);
  await page.goBack();
  await page.waitForTimeout(400);
  const afterBack = await page.evaluate(() => location.pathname);
  const readVisibleAfterBack = await page.isHidden("#rulebook-view");
  await page.goForward();
  await page.waitForTimeout(400);
  const afterForward = await page.evaluate(() => location.pathname);
  note(`${name}: back/forward Read <-> Rules: back -> ${afterBack} (Rulebook hidden: ${readVisibleAfterBack}), forward -> ${afterForward}`);
  if (afterBack !== "/" || !readVisibleAfterBack) errors.push("back from Rules did not restore Read in-app");
  if (afterForward !== "/rules") errors.push("forward did not return to Rules");
  await page.goBack();
  await page.waitForTimeout(400);

  // The read menu: the bar's one action opens a small popover (Choose a
  // photo, Use the camera, Try the sample) instead of the picker directly,
  // so the sample and the camera stay reachable after the first read too.
  await page.click("#read-another");
  await page.waitForSelector("#read-menu:not([hidden])", { timeout: 5_000 });
  const menuOpened = await page.isVisible("#read-menu");
  note(`${name}: read menu opens from the bar's action: ${menuOpened}`);
  await page.waitForTimeout(300); // the menu's entrance transition
  await page.screenshot({ path: path.join(out, `${name}-3m-read-menu.png`), fullPage: false });
  note(`${name}: 3m-read-menu`);
  if (!menuOpened) errors.push("the read menu did not open from the bar's action");
  // Arrow keys move within it.
  const firstFocused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  await page.keyboard.press("ArrowDown");
  const secondFocused = await page.evaluate(() => document.activeElement?.textContent?.trim());
  note(`${name}: read menu: opens focused on "${firstFocused}", ArrowDown moves to "${secondFocused}"`);
  if (firstFocused !== "Choose a photo") errors.push(`the read menu did not open focused on "Choose a photo" (was "${firstFocused}")`);
  if (secondFocused === firstFocused) errors.push("ArrowDown did not move focus within the read menu");
  // Escape closes it and returns focus to the trigger.
  await page.keyboard.press("Escape");
  await page.waitForTimeout(300);
  const menuClosedByEscape = await page.isHidden("#read-menu");
  const focusBackOnTrigger = await page.evaluate(() => document.activeElement?.id === "read-another");
  note(`${name}: Escape closes the read menu: ${menuClosedByEscape}, focus back on the trigger: ${focusBackOnTrigger}`);
  if (!menuClosedByEscape || !focusBackOnTrigger) errors.push("Escape did not close the read menu and return focus to its trigger");

  // A cancelled file picker keeps the read: the menu's "Choose a photo"
  // only opens the picker; nothing clears unless a file actually arrives.
  await page.click("#read-another");
  await page.waitForSelector("#read-menu:not([hidden])", { timeout: 5_000 });
  await page.click('#read-menu [data-action="choose"]');
  await page.waitForTimeout(500);
  const resultHiddenAfterCancel = await page.isHidden("#result");
  const hashAfterCancel = (await page.textContent("#reading-hash"))?.trim();
  note(`${name}: a cancelled picker: result hidden ${resultHiddenAfterCancel}, hash unchanged: ${hashAfterCancel === hashAfter}`);
  if (resultHiddenAfterCancel || hashAfterCancel !== hashAfter) errors.push("cancelling the file picker did not keep the current read");

  // The second read of a session appears settled at once, skipping the full
  // plumb/chalk/count signature. Measuring itself (CPU inference) takes real,
  // variable time regardless of this, so only the reveal (document.body's
  // data-revealing window, set around Figure.play) is timed, not the whole
  // read. Reached through the actual UI this time: open the menu, "Try the
  // sample". It reads.
  await page.click("#read-another");
  await page.waitForSelector("#read-menu:not([hidden])", { timeout: 5_000 });
  await page.click('#read-menu [data-action="sample"]');
  await page.waitForFunction(() => document.body.dataset.revealing !== undefined, { timeout: 120_000 });
  const tReveal = Date.now();
  await page.waitForFunction(() => document.body.dataset.revealing === undefined, { timeout: 10_000 });
  const revealMs = Date.now() - tReveal;
  note(`${name}: second read (via the read menu's "Try the sample") reveal took ${revealMs} ms (a settle, not the full signature)`);
  if (revealMs > 1500) errors.push(`second read's reveal took ${revealMs} ms: the full signature should not replay after the first read of a session`);
  await page.waitForTimeout(1000);

  // Keyboard: 1 tries the first look, Escape returns to the original.
  await page.click("body");
  await page.keyboard.press("1");
  await page.waitForTimeout(1200);
  const pressedAfter1 = await page.getAttribute(".look .btn", "aria-pressed");
  note(`${name}: keyboard "1": first look pressed = ${pressedAfter1}`);
  if (pressedAfter1 !== "true") errors.push('keyboard "1" did not try the first look');
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const pressedAfterEscape = await page.getAttribute(".look .btn", "aria-pressed");
  note(`${name}: keyboard Escape: first look pressed = ${pressedAfterEscape}`);
  if (pressedAfterEscape !== "false") errors.push("keyboard Escape did not return to the original after trying a look");

  // T3 re-review 3: a failed re-read of a photo with a different aspect
  // ratio (a wide, empty image: it decodes, so its photo is drawn at once,
  // then no person is found) must put the read on screen back at its own
  // size and aspect ratio, not leave the failed photo's canvas behind.
  const stageState = () =>
    page.evaluate(() => {
      const c = document.getElementById("figure");
      const d = c.getContext("2d").getImageData(0, 0, c.width, c.height).data;
      let sum = 0;
      for (let i = 0; i < d.length; i += 97) sum = (sum + d[i] * (i % 251)) % 1_000_000_007;
      return { w: c.width, h: c.height, aspect: c.style.aspectRatio, sum };
    });
  const wideBlank = Buffer.from(
    await page.evaluate(() => {
      const c = document.createElement("canvas");
      c.width = 1200;
      c.height = 300;
      const ctx = c.getContext("2d");
      const img = ctx.createImageData(c.width, c.height);
      img.data.fill(128);
      ctx.putImageData(img, 0, 0);
      return c.toDataURL("image/png").split(",")[1];
    }),
    "base64",
  );
  const unreadable = { name: "wide-empty.png", mimeType: "image/png", buffer: wideBlank };
  await page.waitForTimeout(600); // let the return to the original settle before the stage is fingerprinted
  const beforeFail = await stageState();
  const hashBeforeFail = (await page.textContent("#reading-hash"))?.trim();
  await page.setInputFiles("#photo", unreadable);
  await page.waitForSelector('#read-status[data-state="error"]', { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(400);
  const afterFail = await stageState();
  const failStatus = (await page.textContent("#read-status"))?.trim();
  const hashAfterFail = (await page.textContent("#reading-hash"))?.trim();
  note(`${name}: failed re-read of a 1200x300 image: status "${failStatus}"; canvas ${beforeFail.w}x${beforeFail.h} (${beforeFail.aspect}) -> ${afterFail.w}x${afterFail.h} (${afterFail.aspect}), pixels same: ${beforeFail.sum === afterFail.sum}, hash unchanged: ${hashAfterFail === hashBeforeFail}`);
  await shot("10-failed-reread");
  if (!failStatus) errors.push("the empty wide image did not fail to read (no error status), so the failed re-read case did not run");
  if (afterFail.w !== beforeFail.w || afterFail.h !== beforeFail.h || afterFail.aspect !== beforeFail.aspect) errors.push(`a failed re-read left the canvas at ${afterFail.w}x${afterFail.h} (${afterFail.aspect}), not the read's own ${beforeFail.w}x${beforeFail.h} (${beforeFail.aspect})`);
  if (afterFail.sum !== beforeFail.sum) errors.push("a failed re-read did not repaint the read on screen as it stood before");
  if (hashAfterFail !== hashBeforeFail || (await page.isHidden("#result"))) errors.push("a failed re-read did not keep the read on screen");

  // T3 re-review 3: a read that finishes while Rules shows must not write
  // /#r= over /rules; the Rulebook's chip and Back link name it instead.
  let p1File = null;
  try {
    p1File = await photo("p1");
  } catch (e) {
    errors.push(`photo p1 could not be staged: ${e.message}`);
  }
  if (p1File) {
    await page.setInputFiles("#photo", p1File);
    await page.click("#rules-tab"); // measuring takes seconds: Rules shows well before it ends
    await page.waitForFunction((h) => document.getElementById("reading-hash")?.textContent?.trim() !== h, hashBeforeFail, { timeout: 120_000 }).catch(() => {});
    await page.waitForFunction(() => document.body.dataset.revealing === undefined, { timeout: 10_000 }).catch(() => {});
    await page.waitForTimeout(400);
    const hash4Of = (text) => /reading\. ([0-9a-f]{4})/.exec(text ?? "")?.[1] ?? null;
    const newHash4 = hash4Of(await page.textContent("#reading-hash"));
    const pathAfter = await page.evaluate(() => location.pathname + location.hash);
    const rulesShowing = await page.isVisible("#rulebook-view");
    const backHref = await page.getAttribute("#back-to-read", "href");
    const chip = (await page.textContent("#yours-chip"))?.replace(/\s+/g, " ").trim();
    note(`${name}: a read finishing on Rules: url ${pathAfter}, Rules showing ${rulesShowing}, new hash ${newHash4}, Back link ${backHref}, chip "${chip}"`);
    await shot("11-read-finished-on-rules");
    if (!newHash4 || newHash4 === hash4Of(hashBeforeFail)) errors.push("the p1 read did not finish while Rules showed, so that case did not run");
    if (pathAfter !== "/rules") errors.push(`a read finishing while Rules showed changed the URL to ${pathAfter}`);
    if (!rulesShowing) errors.push("a read finishing while Rules showed switched the view away from Rules");
    if (backHref !== `/#r=${newHash4}`) errors.push(`the Rulebook's Back link names ${backHref}, not the read that just finished (/#r=${newHash4})`);
    // T3 review 4: browser Back from here lands on the same read the Back link names.
    await page.goBack();
    await page.waitForTimeout(600);
    const pathOnBack = await page.evaluate(() => location.pathname + location.hash);
    const hashOnBack = hash4Of(await page.textContent("#reading-hash"));
    note(`${name}: browser Back after a read finished on Rules: url ${pathOnBack}, read on screen ${hashOnBack}`);
    if (pathOnBack !== `/#r=${newHash4}` || hashOnBack !== newHash4) errors.push(`browser Back from Rules went to ${pathOnBack} (read ${hashOnBack}), not the read the Back link names (/#r=${newHash4})`);
    await page.goForward();
    await page.waitForTimeout(600);
    if ((await page.evaluate(() => location.pathname)) !== "/rules") errors.push("browser Forward did not return to /rules");
    await page.click("#back-to-read");
    await page.waitForTimeout(600);
    // Two distinct reads in this session now: the strip shows both.
    if (phone) {
      await snap("full");
      await page.waitForTimeout(500);
    }
    const stripVisible = await page.isVisible("#session-strip");
    note(`${name}: session strip after two reads: visible ${stripVisible}, ${await page.$$eval("#session-strip button", (b) => b.length)} entries`);
    if (!stripVisible) errors.push("the session strip did not show after two different reads");
    await shot("12-session-strip");
  }

  // The shortcuts sheet: opened by its button, closed by Escape.
  await page.click("#shortcuts-help");
  await page.waitForTimeout(300);
  const sheetShown = await page.isVisible("#shortcuts-sheet");
  await page.screenshot({ path: path.join(out, `${name}-13-shortcuts.png`), fullPage: false });
  note(`${name}: 13-shortcuts (shown: ${sheetShown})`);
  if (!sheetShown) errors.push("the Shortcuts button did not open the shortcuts sheet");
  await page.keyboard.press("Escape");
  await page.waitForTimeout(200);
  if (!(await page.isHidden("#shortcuts-sheet"))) errors.push("Escape did not close the shortcuts sheet");

  // Shortcuts (and the bar's own action) are Read's: the spec gives Rules
  // none of its own (T3 re-review: "Shortcuts and the bar work while Rules shows").
  await page.click("#rules-tab");
  await page.waitForTimeout(400);
  let lookTriedOnRules = 0;
  const onRequestOnRules = (r) => {
    if (new URL(r.url()).pathname === "/e" && (r.postData() ?? "").includes("look_tried")) lookTriedOnRules++;
  };
  page.on("request", onRequestOnRules);
  await page.keyboard.press("1");
  await page.waitForTimeout(600);
  page.off("request", onRequestOnRules);
  const barActionsHiddenOnRules = await page.isHidden(".bar-actions");
  note(`${name}: keyboard "1" on Rules: look_tried sent ${lookTriedOnRules} times; .bar-actions hidden: ${barActionsHiddenOnRules}`);
  if (lookTriedOnRules !== 0) errors.push(`keyboard "1" on Rules sent look_tried (${lookTriedOnRules} times)`);
  if (!barActionsHiddenOnRules) errors.push(".bar-actions did not hide on the Rules view");

  // T3 re-review 3: the Face cloth opened on Rules. Closing it returns the
  // underline to Rules (the route showing), not Read; its "Read an outfit"
  // routes back to Read in-app.
  const underlineUnder = () =>
    page.evaluate(() => {
      const line = document.querySelector(".tab-underline")?.getBoundingClientRect();
      if (!line) return null;
      const mid = line.left + line.width / 2;
      const tab = [...document.querySelectorAll("nav.tabs .tab")].find((t) => {
        const r = t.getBoundingClientRect();
        return mid >= r.left && mid <= r.right;
      });
      return tab?.id || tab?.getAttribute("data-soon") || null;
    });
  await page.click('.tabs [data-soon="face"]');
  await page.waitForTimeout(600);
  await page.keyboard.press("Escape");
  await page.waitForTimeout(600);
  const underlineAfterClose = await underlineUnder();
  const stillOnRules = (await page.evaluate(() => location.pathname)) === "/rules" && (await page.isVisible("#rulebook-view"));
  note(`${name}: Face cloth closed on Rules: underline under ${underlineAfterClose}, still on Rules ${stillOnRules}`);
  if (underlineAfterClose !== "rules-tab") errors.push(`closing the Face cloth on Rules put the underline under ${underlineAfterClose}, not Rules`);
  if (!stillOnRules) errors.push("closing the Face cloth on Rules left Rules");
  await page.click('.tabs [data-soon="face"]');
  await page.waitForTimeout(600);
  await page.click("#soon a.btn");
  await page.waitForTimeout(600);
  const pathAfterClothRead = await page.evaluate(() => location.pathname);
  const rulesHiddenAfterClothRead = await page.isHidden("#rulebook-view");
  const resultShownAfterClothRead = await page.isVisible("#result");
  const underlineAfterClothRead = await underlineUnder();
  note(`${name}: "Read an outfit" on the Face cloth over Rules: path ${pathAfterClothRead}, Rules hidden ${rulesHiddenAfterClothRead}, read shown ${resultShownAfterClothRead}, underline under ${underlineAfterClothRead}`);
  if (pathAfterClothRead !== "/" || !rulesHiddenAfterClothRead || !resultShownAfterClothRead) errors.push(`"Read an outfit" on the Face cloth over Rules did not route back to Read (path ${pathAfterClothRead})`);
  if (underlineAfterClothRead !== "read-tab") errors.push(`after "Read an outfit" from Rules the underline sat under ${underlineAfterClothRead}, not Read`);

  // Compact: rows collapse to name, band and the numeral; a row opens on tap or Enter.
  const firstRowOpenBefore = await page.evaluate(() => getComputedStyle(document.querySelector(".row .row-b")).display);
  await page.click("#compact-toggle");
  await page.waitForTimeout(200);
  const compactOn = await page.evaluate(() => document.body.dataset.compact !== undefined);
  const firstRowOpenAfterCompact = await page.evaluate(() => getComputedStyle(document.querySelector(".row .row-b")).display);
  // aria-expanded must follow the toggle: every unopened row now says collapsed.
  const expandedAfterCompact = await page.$$eval(".row .row-h", (hs) => hs.map((h) => h.getAttribute("aria-expanded")));
  if (expandedAfterCompact.some((v) => v !== "false")) errors.push(`after turning Compact on, row heads still say aria-expanded ${expandedAfterCompact.join(",")}`);

  // T8 (R-09, UX pass 3): Compact used to fold the rule rows but never the
  // headline above them, so the first row sat below the fold at every
  // width regardless. The headline now folds to one line (the verdict word
  // and the one change, beside the ratio), with the full sentence a tap
  // away.
  const compactHeadlineText = (await page.textContent("#verdict-compact-text"))?.trim();
  const compactToggleHidden = await page.isHidden("#verdict-compact-toggle");
  note(`${name}: Compact headline: "${compactHeadlineText}" (toggle hidden: ${compactToggleHidden})`);
  if (compactToggleHidden) errors.push("Compact did not reveal the one-line headline toggle");
  if (!compactHeadlineText) errors.push("Compact's one-line headline is empty with a read on screen");

  // Review round 1: a nowrap headline in a grid/flex ancestor with the
  // browser's default min-width:auto grows its column to the whole
  // sentence instead of ellipsizing, pushing the sheet wider than its own
  // room (at 1280 the reading measured 572px in a 488px panel). Checked at
  // this viewport, whichever it is.
  const sheetOverflow = await page.evaluate(() => {
    const el = document.getElementById("sheet-body");
    return { scrollWidth: el.scrollWidth, clientWidth: el.clientWidth };
  });
  note(`${name}: Compact on: #sheet-body scrollWidth ${sheetOverflow.scrollWidth} vs clientWidth ${sheetOverflow.clientWidth}`);
  if (sheetOverflow.scrollWidth > sheetOverflow.clientWidth) errors.push(`Compact on ${name} overflows the sheet body horizontally (scrollWidth ${sheetOverflow.scrollWidth} > clientWidth ${sheetOverflow.clientWidth})`);

  // Review round 1: the ratio must actually sit beside the compact
  // headline (one row), not wrap beneath it (two).
  const headlineRatioAlign = await page.evaluate(() => {
    const hero = document.getElementById("hero-n").getBoundingClientRect();
    const toggle = document.getElementById("verdict-compact-toggle").getBoundingClientRect();
    return { heroTop: hero.top, toggleTop: toggle.top };
  });
  note(`${name}: Compact: hero-n top ${headlineRatioAlign.heroTop}, compact toggle top ${headlineRatioAlign.toggleTop}`);
  if (Math.abs(headlineRatioAlign.heroTop - headlineRatioAlign.toggleTop) > 20) errors.push(`Compact did not keep the ratio beside the headline (hero-n top ${headlineRatioAlign.heroTop} vs toggle top ${headlineRatioAlign.toggleTop})`);

  if (!phone) {
    const firstRowYCompact = await page.evaluate(() => document.querySelector(".row")?.getBoundingClientRect().top ?? null);
    note(`${name}: Compact on desktop (1280): first rule row at y=${firstRowYCompact}`);
    if (firstRowYCompact === null || firstRowYCompact > 400) errors.push(`Compact on desktop left the first rule row at y=${firstRowYCompact}, not above 400`);
  } else {
    await snap("half");
    await page.waitForTimeout(400);
    const heroVisibleAtHalf = await page.evaluate(() => {
      const r = document.getElementById("hero-n").getBoundingClientRect();
      return r.top >= 0 && r.bottom <= innerHeight;
    });
    note(`${name}: Compact on phone, sheet at half: ratio visible without scrolling: ${heroVisibleAtHalf}`);
    if (!heroVisibleAtHalf) errors.push("Compact on phone at half did not keep the ratio visible");
    await shot("13b-compact-half");
    // The disclosure: tapping the compact line reveals the full sentence
    // underneath it, and its own label follows which state it is in.
    const toggleLabelClosed = await page.getAttribute("#verdict-compact-toggle", "aria-label");
    await page.click("#verdict-compact-toggle");
    await page.waitForTimeout(200);
    const disclosureOpen = await page.evaluate(() => getComputedStyle(document.getElementById("verdict")).display !== "none");
    const toggleExpandedOpen = await page.getAttribute("#verdict-compact-toggle", "aria-expanded");
    const toggleLabelOpen = await page.getAttribute("#verdict-compact-toggle", "aria-label");
    note(`${name}: tapping the compact headline discloses the full sentence: ${disclosureOpen} (aria-expanded ${toggleExpandedOpen}); label closed "${toggleLabelClosed}" -> open "${toggleLabelOpen}"`);
    if (!disclosureOpen) errors.push("tapping the compact headline did not disclose the full sentence");
    if (toggleExpandedOpen !== "true") errors.push(`the compact toggle's aria-expanded was "${toggleExpandedOpen}" once open, not "true"`);
    if (toggleLabelOpen === toggleLabelClosed) errors.push("the compact toggle's label did not change between closed and open");
    await page.click("#verdict-compact-toggle"); // close it again
    await page.waitForTimeout(200);
  }

  // T8 (Sam's re-run): at half height the sheet body's overflow stays
  // hidden until full (design/BRAND.md: "only then does it scroll
  // inside"), so a wheel/trackpad scroll there used to be a dead end,
  // leaving Shortcuts, Download and feedback out of reach without finding
  // the small handle. A wheel (a real one, via page.mouse.wheel, not a
  // synthetic dispatch) and a real touch drag (via CDP) must both now
  // reach full the same the grip itself does; the grip's aria-expanded
  // changes with it.
  if (phone) {
    await snap("half");
    await page.waitForTimeout(400);
    const bodyBox = await page.locator("#sheet-body").boundingBox();
    const gripBeforeWheel = await page.getAttribute("#grip", "aria-expanded");
    await page.mouse.move(bodyBox.x + bodyBox.width / 2, bodyBox.y + 40);
    await page.mouse.wheel(0, 120);
    await page.waitForTimeout(500);
    const snapAfterWheel = await page.evaluate(() => document.getElementById("sheet").dataset.snap);
    const gripAfterWheel = await page.getAttribute("#grip", "aria-expanded");
    note(`${name}: a real mouse wheel at half: grip aria-expanded before ${gripBeforeWheel}, sheet after "${snapAfterWheel}", grip aria-expanded after ${gripAfterWheel}`);
    if (snapAfterWheel !== "full") errors.push(`a wheel scroll at half left the sheet at "${snapAfterWheel}", not full`);
    if (gripAfterWheel !== "true") errors.push(`the grip's aria-expanded after reaching full was "${gripAfterWheel}", not "true"`);
    await page.evaluate(() => {
      const body = document.getElementById("sheet-body");
      body.scrollTo(0, body.scrollHeight);
    });
    await page.waitForTimeout(300);
    const shortcutsReachable = await page.isVisible("#shortcuts-help");
    note(`${name}: Shortcuts reachable by scrolling the body once the wheel raised the sheet to full: ${shortcutsReachable}`);
    if (!shortcutsReachable) errors.push("scrolling the sheet body at full did not reach Shortcuts");

    // A real touch drag (CDP Input.dispatchTouchEvent, not a synthetic
    // pointer-event dispatch): a swipe up from half must raise the sheet
    // the same way the wheel just did.
    await snap("half");
    await page.waitForTimeout(400);
    const cdp = await page.context().newCDPSession(page);
    const sx = bodyBox.x + bodyBox.width / 2;
    const touch = async (type, y) => cdp.send("Input.dispatchTouchEvent", { type, touchPoints: type === "touchEnd" ? [] : [{ x: sx, y }] });
    await touch("touchStart", bodyBox.y + 60);
    for (let i = 1; i <= 8; i++) await touch("touchMove", bodyBox.y + 60 - i * 30);
    await touch("touchEnd", bodyBox.y - 180);
    await page.waitForTimeout(600);
    const snapAfterTouch = await page.evaluate(() => document.getElementById("sheet").dataset.snap);
    const gripAfterTouch = await page.getAttribute("#grip", "aria-expanded");
    note(`${name}: a real touch drag (CDP) up from half: sheet now "${snapAfterTouch}", grip aria-expanded ${gripAfterTouch}`);
    if (snapAfterTouch === "half") errors.push("a real touch drag up from half did not move the sheet");
    if (gripAfterTouch !== "true") errors.push(`the grip's aria-expanded after a touch drag off peek was "${gripAfterTouch}", not "true"`);

    await snap("half"); // leave the sheet where the rest of this run expects it
    await page.waitForTimeout(400);
  }

  if (phone) {
    await snap("full");
    await page.waitForTimeout(500);
  }
  await shot("14-compact");
  await page.click(".row .row-h");
  await page.waitForTimeout(200);
  const firstRowOpenAfterTap = await page.evaluate(() => getComputedStyle(document.querySelector(".row .row-b")).display);
  note(`${name}: Compact: on ${compactOn}; a row's body display before ${firstRowOpenBefore}, right after toggling ${firstRowOpenAfterCompact}, after tapping it open ${firstRowOpenAfterTap}`);
  if (!compactOn) errors.push("Compact toggle did not set body[data-compact]");
  if (firstRowOpenAfterCompact !== "none") errors.push("Compact did not collapse a row's body");
  if (firstRowOpenAfterTap === "none") errors.push("tapping a row's head in Compact did not open it");
  await page.click("#compact-toggle"); // back off, so the rest of this run reads the rows as usual
  await page.waitForTimeout(200);
  const expandedAfterCompactOff = await page.$$eval(".row .row-h", (hs) => hs.map((h) => h.getAttribute("aria-expanded")));
  note(`${name}: Compact row heads aria-expanded: on ${expandedAfterCompact.join(",")}; off ${expandedAfterCompactOff.join(",")}`);
  if (expandedAfterCompactOff.some((v) => v !== "true")) errors.push(`after turning Compact off, row heads say aria-expanded ${expandedAfterCompactOff.join(",")}`);

  // The Card tab, with a read on screen, previews this read instead of "not built yet".
  // tabs.ts shows the generic #soon-title synchronously, then swaps in
  // .card-preview once the async draw resolves: waiting on either selector
  // races and matches #soon-title first every time, so wait on .card-preview
  // itself (falling back to reading #soon-title only to report what went wrong).
  await page.click('.tabs [data-soon="card"]');
  await page.waitForSelector(".card-preview", { timeout: 5_000 }).catch(() => {});
  const cardTabTitle = (await page.textContent(".card-preview h1").catch(() => null)) ?? (await page.textContent("#soon-title").catch(() => null));
  const cardPreviewImg = await page.isVisible(".card-preview-img");
  note(`${name}: Card tab with a read on screen: "${cardTabTitle?.trim()}", preview image shown: ${cardPreviewImg}`);
  if (cardTabTitle?.trim() !== "This read, as a card.") errors.push(`Card tab did not preview this read (showed "${cardTabTitle}")`);
  if (!cardPreviewImg) errors.push("Card tab's preview image did not render");
  await page.waitForTimeout(500); // let the tab underline finish sliding to Card before the shot
  await page.screenshot({ path: path.join(out, `${name}-15-card-preview.png`), fullPage: false });
  note(`${name}: 15-card-preview`);
  await page.click('.tabs [data-soon="card"]'); // close it
  await page.waitForTimeout(300);

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

  // The UX pass 2 photos, read as worn (T4: the reading matches the photo).
  for (const id of Object.keys(PHOTOS)) await readPhotoShot(page, name, id, snap, phone, errors);

  // The photo is never stored (founder, T3): a real reload has nothing in
  // memory. This tab's own goto(rulesUrl) above was already one, so Read
  // here has no in-memory session; only the hand-off survives, as the
  // chalk figure. (A plain page.reload() of Read itself is exercised too.)
  await page.goto(base, { waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  const chalkVisible = await page.isVisible("#chalk-restore");
  const photoWellVisible = await page.isVisible("#photo-well");
  const chalkNote = await page.textContent(".chalk-restore-note");
  const chalkHash = (await page.textContent("#reading-hash"))?.trim();
  note(`${name}: reload with no in-memory session: chalk restore shown ${chalkVisible}, photo well shown ${photoWellVisible}, note "${chalkNote?.trim()}", hash ${chalkHash}`);
  if (!chalkVisible || photoWellVisible) errors.push("a reload with no in-memory session did not fall back to the chalk-figure restore");
  if (!chalkNote?.includes("Read the photo again")) errors.push("the chalk restore's explanatory line is missing");
  await page.screenshot({ path: path.join(out, `${name}-9-chalk-restore.png`), fullPage: true });
  note(`${name}: 9-chalk-restore`);
  // A look can still be tried, on the chalk figure only.
  const chalkLookBtn = await page.$(".look .btn");
  if (chalkLookBtn) {
    await chalkLookBtn.click();
    await page.waitForTimeout(400);
    const triedOnChalk = (await page.textContent("#verdict"))?.trim();
    note(`${name}: trying a look on the chalk restore: verdict "${triedOnChalk}"`);
    if (!triedOnChalk?.startsWith("Trying")) errors.push("trying a look on the chalk restore did not prefix the verdict");
  }
  // A failed read from the chalk restore returns to the chalk restore, with
  // the look being tried still tried, never to the drop cloth.
  const verdictBeforeChalkFail = (await page.textContent("#verdict"))?.trim();
  await page.setInputFiles("#photo", unreadable);
  await page.waitForSelector('#read-status[data-state="error"]', { timeout: 120_000 }).catch(() => {});
  await page.waitForTimeout(400);
  const chalkBack = await page.isVisible("#chalk-restore");
  const clothShown = await page.isVisible("#drop");
  const wellShown = await page.isVisible("#photo-well");
  const verdictAfterChalkFail = (await page.textContent("#verdict"))?.trim();
  note(`${name}: failed read from the chalk restore: chalk restore shown ${chalkBack}, drop cloth shown ${clothShown}, photo well shown ${wellShown}, verdict kept ${verdictAfterChalkFail === verdictBeforeChalkFail}`);
  if (!chalkBack || clothShown || wellShown) errors.push("a failed read from the chalk restore did not return to the chalk restore");
  if (verdictAfterChalkFail !== verdictBeforeChalkFail) errors.push("a failed read from the chalk restore changed the reading shown");
  // A plain page.reload() of Read itself: the same fallback, not a crash.
  await page.reload({ waitUntil: "networkidle" });
  await page.waitForTimeout(600);
  note(`${name}: page.reload(): chalk restore shown ${await page.isVisible("#chalk-restore")}`);

  if (errors.length) note(`${name}: page errors:\n  ${errors.join("\n  ")}`);
  await browser.close();
  return errors.length;
}

/** prefers-reduced-motion: reduce. The signature is always a settle under
 * it, even on a session's first read (web/src/ui/reveal.ts's revealKind),
 * and the hero numeral shows the final value at once, never a count. */
async function runReducedMotion() {
  const errors = [];
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, reducedMotion: "reduce", colorScheme: "dark" });
  const page = await context.newPage();
  page.on("pageerror", (e) => errors.push(String(e)));
  await page.goto(base, { waitUntil: "networkidle" });
  const t0 = Date.now();
  await page.click("#try-sample");
  await page.waitForSelector("#reading-hash:not(:empty)", { timeout: 120_000 });
  await page.waitForFunction(() => document.body.dataset.revealing === undefined, { timeout: 10_000 });
  const ms = Date.now() - t0;
  const hero = await page.textContent("#hero-n");
  note(`reduced-motion: first read's reveal settled in ${ms} ms (measuring itself included; no multi-second signature to wait out), hero "${hero}"`);
  // Generous: this still includes the model/measuring time, not only the
  // reveal: it only needs to rule out the ~2-3 s signature being added on top.
  if (ms > 15_000) errors.push(`reduced motion still took ${ms} ms: the signature should not play at all`);
  if (!hero || hero.includes("NaN")) errors.push(`reduced motion left the hero numeral as "${hero}"`);
  if (errors.length) note(`reduced-motion: page errors:\n  ${errors.join("\n  ")}`);
  await browser.close();
  return errors.length;
}

const failures = (await run("phone", { width: 375, height: 812 })) + (await run("desktop", { width: 1280, height: 900 })) + (await runReducedMotion());
writeFileSync(path.join(out, "log.txt"), log.join("\n") + "\n");
// A page error is a finding to review, never a silent pass; the job fails so it shows.
process.exit(failures ? 1 : 0);
