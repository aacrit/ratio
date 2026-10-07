// "Save a look": a 4:5 card on Paper (founder, 2026-10-04), drawn in the tab
// and handed to the person as a PNG. The photo with its overlay at rest, the
// readings with their measurements, the palette, the reading hash, and one
// quiet line naming the site. No tracking, no watermark beyond that line,
// nothing uploaded: the file is made here and saved by the browser.

import { shownColour } from "../engine/constants";
import { byName, colourLabel } from "../engine/names";
import type { AdviceLine, Bins, LineState } from "../engine/rules";
import { hashesOfShown, hashSegments } from "./hashline";
import type { Shown } from "./looks";
import { STATE_WORDS } from "./rows";

const W = 1080;
const H = 1350;
const M = 72;

type Ink = Record<"paper" | "ink" | "muted" | "rule" | "tape" | "section", string>;

function inks(): Ink {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const out = { paper: read("--card-paper"), ink: read("--card-ink"), muted: read("--card-muted"), rule: read("--card-rule"), tape: read("--card-tape"), section: read("--card-section") };
  probe.remove();
  return out;
}

const DISPLAY = '"Fraunces", Georgia, serif';
const BODY = '"Inter", system-ui, sans-serif';
const DATA = '"JetBrains Mono", ui-monospace, monospace';

/** Breaks text into lines no wider than maxWidth, at spaces. */
function wrap(ctx: OffscreenCanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.split(" ");
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const next = line ? `${line} ${w}` : w;
    if (ctx.measureText(next).width > maxWidth && line) {
      lines.push(line);
      line = w;
    } else line = next;
  }
  if (line) lines.push(line);
  return lines;
}

export interface CardContent {
  /** The photo with its overlay at rest (Figure.still()). */
  still: OffscreenCanvas;
  /** "As worn" or the look's title. */
  title: string;
  /** A line under the title, e.g. that the photo shows the outfit as worn. */
  note?: string;
  lines: AdviceLine[];
  bins: Bins;
  /** The photo's own reading hash, on every card of that photo, look or not (T10). */
  hash: string;
  engine: string;
  /** The tried look, when the card is a look's: its own reading hash and its title. */
  look?: { hash: string; name: string } | null;
  /** Credit for a sample painting, when the photo is one. */
  credit?: string;
}

/**
 * The card's footer: the same hash line the screen shows for the same view
 * (ui/hashline.ts), never a string of its own (T10 review 1: the screen said
 * the look's hash, the card the photo's).
 */
export const cardHashSegments = (c: Pick<CardContent, "hash" | "engine" | "look">): string[] => hashSegments({ photoHash: c.hash, engine: c.engine, look: c.look });
export const cardHashLine = (c: Pick<CardContent, "hash" | "engine" | "look">): string => cardHashSegments(c).join(" · ");

/** The file the card is saved as: the photo's hash, plus the look as a filename-safe slug when the card is a look's. */
export function cardFileName(c: Pick<CardContent, "hash" | "look">): string {
  const hash4 = c.hash.slice(0, 4).replace(/[^0-9a-f]/gi, "");
  const slug = (c.look?.name ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .slice(0, 48)
    .replace(/^-+|-+$/g, "");
  return `ratio-${hash4}${slug ? `-${slug}` : ""}.png`;
}

/** What the card of what is on screen holds: the same hashes and look the screen's hash line names. */
export function cardContentOf(shown: Shown, still: OffscreenCanvas, credit: string | null): CardContent {
  const h = hashesOfShown(shown);
  return { still, title: shown.title, note: shown.note, lines: shown.lines, bins: shown.bins, hash: h.photoHash, engine: h.engine, look: h.look, credit: credit ?? undefined };
}

/**
 * Joins segments with " · " into lines no wider than maxWidth, breaking
 * between segments; a segment too wide alone is broken at its spaces, so
 * nothing is ever dropped.
 */
export function joinToWidth(segments: string[], measure: (s: string) => number, maxWidth: number): string[] {
  const lines: string[] = [];
  let line = "";
  const push = (piece: string, sep: string) => {
    const next = line ? `${line}${sep}${piece}` : piece;
    if (line && measure(next) > maxWidth) {
      lines.push(line);
      line = piece;
    } else line = next;
  };
  for (const seg of segments) {
    if (measure(seg) <= maxWidth) push(seg, " · ");
    else seg.split(" ").forEach((word, i) => push(word, i === 0 ? " · " : " "));
  }
  if (line) lines.push(line);
  return lines;
}

export async function drawCard(c: CardContent): Promise<OffscreenCanvas> {
  await Promise.all([document.fonts.load(`400 64px ${DISPLAY}`), document.fonts.load(`400 20px ${BODY}`), document.fonts.load(`600 20px ${BODY}`), document.fonts.load(`500 18px ${DATA}`)]);
  const k = inks();
  const card = new OffscreenCanvas(W, H);
  const ctx = card.getContext("2d");
  if (!ctx) throw new Error("this browser cannot draw the card");

  ctx.fillStyle = k.paper;
  ctx.fillRect(0, 0, W, H);
  ctx.textBaseline = "alphabetic";

  // Masthead.
  ctx.fillStyle = k.ink;
  ctx.font = `400 64px ${DISPLAY}`;
  ctx.fillText("Ratio", M, 124);
  ctx.fillStyle = k.muted;
  ctx.font = `500 16px ${DATA}`;
  ctx.fillText("REASON AND PROPORTION", M + 2, 152);
  ctx.textAlign = "right";
  ctx.fillText(c.title === "As worn" ? "AN OUTFIT, READ" : "A LOOK, READ", W - M, 124);
  ctx.textAlign = "left";
  ctx.fillStyle = k.rule;
  ctx.fillRect(M, 176, W - 2 * M, 1);

  // The photo, at rest, fitted into the left column.
  const colW = 500;
  const top = 208;
  const maxH = H - top - 150;
  const scale = Math.min(colW / c.still.width, maxH / c.still.height);
  const pw = c.still.width * scale;
  const ph = c.still.height * scale;
  ctx.drawImage(c.still, M, top, pw, ph);
  ctx.strokeStyle = k.rule;
  ctx.lineWidth = 1;
  ctx.strokeRect(M + 0.5, top + 0.5, pw - 1, ph - 1);

  // The readings, right column.
  const x = M + colW + 44;
  const rw = W - M - x;
  let y = top + 34;
  ctx.fillStyle = k.ink;
  ctx.font = `400 30px ${DISPLAY}`;
  for (const l of wrap(ctx, c.title, rw)) {
    ctx.fillText(l, x, y);
    y += 38;
  }
  if (c.note) {
    ctx.fillStyle = k.muted;
    ctx.font = `400 16px ${BODY}`;
    for (const l of wrap(ctx, c.note, rw)) {
      ctx.fillText(l, x, y);
      y += 22;
    }
    y += 4;
  }
  y += 10;
  const stateInk = (s: LineState) => (s === "golden" ? k.section : s === "advice" ? k.ink : k.muted);
  for (const line of c.lines) {
    if (y > top + maxH - 120) break;
    ctx.fillStyle = k.rule;
    ctx.fillRect(x, y - 4, rw, 1);
    y += 26;
    ctx.fillStyle = k.ink;
    ctx.font = `600 20px ${BODY}`;
    ctx.fillText(line.title, x, y);
    ctx.textAlign = "right";
    ctx.fillStyle = line.state === "golden" ? k.section : k.tape;
    ctx.font = `500 18px ${DATA}`;
    ctx.fillText(line.measured, x + rw, y);
    ctx.textAlign = "left";
    y += 26;
    ctx.fillStyle = stateInk(line.state);
    ctx.font = `500 15px ${DATA}`;
    ctx.fillText((line.borderline ? `${STATE_WORDS[line.state]} · borderline` : STATE_WORDS[line.state]).toUpperCase(), x, y);
    y += 24;
  }

  // The palette, each colour as wide as its share.
  y = Math.max(y + 12, top + maxH - 84);
  let px = x;
  // One name, one entry; the shares sum to 1.00, and the strip spans the column.
  const named = byName(c.bins.palette);
  const total = named.reduce((t, s) => t + s.share, 0) || 1;
  for (const s of named) {
    const w = (rw * s.share) / total;
    const d = shownColour(s);
    ctx.fillStyle = `oklch(${d.L} ${d.C} ${d.h})`;
    ctx.fillRect(px, y, w, 22);
    px += w;
  }
  ctx.strokeStyle = k.rule;
  ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, 21);
  ctx.fillStyle = k.muted;
  ctx.font = `400 14px ${BODY}`;
  const names = named.map((s) => `${colourLabel(s)} ${s.share.toFixed(2)}`).join(", ");
  wrap(ctx, names, rw).slice(0, 2).forEach((l, i) => ctx.fillText(l, x, y + 46 + i * 20));

  // Footer: the hash line (every part of it, always), the site, the credit.
  const foot = footerLayout(cardHashSegments(c), (t, size) => {
    ctx.font = `500 ${size}px ${DATA}`;
    return ctx.measureText(t).width;
  }, W - 2 * M);
  ctx.fillStyle = k.rule;
  ctx.fillRect(M, foot.ruleY, W - 2 * M, 1);
  ctx.fillStyle = k.muted;
  ctx.font = `500 ${foot.size}px ${DATA}`;
  foot.lines.forEach((l, i) => ctx.fillText(l, M, foot.firstY + i * foot.lineHeight));
  ctx.textAlign = "right";
  ctx.fillText(FOOT_SITE, W - M, foot.firstY);
  ctx.textAlign = "left";
  if (c.credit) {
    ctx.font = `400 13px ${BODY}`;
    ctx.fillText(c.credit, M, FOOT_CREDIT_Y);
  }
  return card;
}

/** The credit's baseline; the hash line's last baseline sits FOOT_CREDIT_GAP above it. */
const FOOT_CREDIT_Y = H - 40;
const FOOT_CREDIT_GAP = 30;
const FOOT_SITE = "ratio.voidvision.org · made in the tab";

/**
 * Where the footer's hash line goes. It is never cut: at 16 px it may wrap
 * to two lines; past that it is set at 14 px on as many lines as it needs,
 * and the footer rule moves up to make room. The last line always sits
 * FOOT_CREDIT_GAP above the credit. Pure, for the tests.
 */
export function footerLayout(segments: string[], measure: (text: string, size: number) => number, width: number): { size: number; lineHeight: number; lines: string[]; firstY: number; ruleY: number } {
  const at = (size: number) => joinToWidth(segments, (t) => measure(t, size), width - measure(FOOT_SITE, size) - 32);
  let size = 16;
  let lines = at(size);
  if (lines.length > 2) {
    size = 14;
    lines = at(size);
  }
  const lineHeight = size + 4;
  const lastY = FOOT_CREDIT_Y - FOOT_CREDIT_GAP + 2;
  const firstY = lastY - (lines.length - 1) * lineHeight;
  return { size, lineHeight, lines, firstY, ruleY: firstY - 36 };
}

/** Draws the card and hands it to the browser as a PNG download. */
export async function saveCard(c: CardContent): Promise<void> {
  const card = await drawCard(c);
  const blob = await card.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = cardFileName(c);
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
