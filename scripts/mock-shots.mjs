#!/usr/bin/env node
// Screenshots of the G2 design mocks (design/mocks/*.html) in a real
// browser, taken in CI (the screens workflow) so nobody's laptop has to.
// The repo root is served statically (the mocks link ../tokens.css, which
// imports fonts from node_modules, and the staged samples in web/public),
// and every mock is shot at the three charter widths, full page, into
// screens/mock-<surface>-<width>.png. A page error or a failed request is
// a finding, and the job fails so it shows.
//
// Playwright is installed by the workflow only (npm install --no-save).

import { createReadStream, existsSync, mkdirSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const out = path.join(repoRoot, "screens");
const WIDTHS = [375, 768, 1280];
mkdirSync(out, { recursive: true });

// A static server over the repo root: the mocks reach design/tokens.css, the
// self-hosted fonts in node_modules and the staged samples under web/public.
const TYPES = { ".html": "text/html; charset=utf-8", ".css": "text/css; charset=utf-8", ".js": "text/javascript", ".mjs": "text/javascript", ".woff2": "font/woff2", ".jpg": "image/jpeg", ".png": "image/png", ".svg": "image/svg+xml" };
const server = createServer((req, res) => {
  const file = path.join(repoRoot, decodeURIComponent(new URL(req.url, "http://x").pathname));
  if (!file.startsWith(repoRoot) || !existsSync(file) || statSync(file).isDirectory()) {
    res.writeHead(404).end();
    return;
  }
  res.writeHead(200, { "content-type": TYPES[path.extname(file)] ?? "application/octet-stream" });
  createReadStream(file).pipe(res);
});
await new Promise((r) => server.listen(0, "127.0.0.1", r));
const base = `http://127.0.0.1:${server.address().port}`;

const mocks = readdirSync(path.join(repoRoot, "design", "mocks"))
  .filter((f) => f.endsWith(".html"))
  .map((f) => f.replace(/\.html$/, ""))
  .sort();

const log = [];
const note = (line) => {
  log.push(line);
  console.log(line);
};

const browser = await chromium.launch();
let failures = 0;
for (const width of WIDTHS) {
  const context = await browser.newContext({ viewport: { width, height: width < 1024 ? 812 : 900 }, deviceScaleFactor: 1, colorScheme: "dark" });
  for (const mock of mocks) {
    const page = await context.newPage();
    const errors = [];
    page.on("pageerror", (e) => errors.push(String(e)));
    page.on("response", (r) => r.status() >= 400 && errors.push(`${r.status()} ${r.url()}`));
    page.on("console", (m) => m.type() === "error" && errors.push(m.text()));
    await page.goto(`${base}/design/mocks/${mock}.html`, { waitUntil: "networkidle" });
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(400);
    const file = path.join(out, `mock-${mock}-${width}.png`);
    await page.screenshot({ path: file, fullPage: true });
    const h = await page.evaluate(() => document.documentElement.scrollHeight);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > document.documentElement.clientWidth);
    note(`mock ${mock} at ${width}: ${h} px tall${overflow ? ", HORIZONTAL OVERFLOW" : ""}`);
    if (overflow) errors.push("horizontal overflow");
    if (errors.length) {
      failures++;
      note(`mock ${mock} at ${width}: errors:\n  ${errors.join("\n  ")}`);
    }
    await page.close();
  }
  await context.close();
}
await browser.close();
server.close();
writeFileSync(path.join(out, "mocks-log.txt"), log.join("\n") + "\n");
process.exit(failures ? 1 : 0);
