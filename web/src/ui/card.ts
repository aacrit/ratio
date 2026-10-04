// "Save a look": a 4:5 card on Paper (founder, 2026-10-04), drawn in the tab
// and handed to the person as a PNG. The photo with its overlay at rest, the
// readings with their measurements, the palette, the reading hash, and one
// quiet line naming the site. No tracking, no watermark beyond that line,
// nothing uploaded: the file is made here and saved by the browser.

import { colourLabel } from "../engine/names";
import type { AdviceLine, Bins, LineState } from "../engine/rules";
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
  lines: AdviceLine[];
  bins: Bins;
  hash: string;
  engine: string;
  /** Credit for a sample painting, when the photo is one. */
  credit?: string;
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
  for (const s of c.bins.palette) {
    const w = rw * s.share;
    ctx.fillStyle = `oklch(${s.L} ${s.C} ${s.h})`;
    ctx.fillRect(px, y, w, 22);
    px += w;
  }
  ctx.strokeStyle = k.rule;
  ctx.strokeRect(x + 0.5, y + 0.5, rw - 1, 21);
  ctx.fillStyle = k.muted;
  ctx.font = `400 14px ${BODY}`;
  const names = c.bins.palette.map((s) => colourLabel(s)).join(", ");
  wrap(ctx, names, rw).slice(0, 2).forEach((l, i) => ctx.fillText(l, x, y + 46 + i * 20));

  // Footer: the hash, the site, the credit.
  ctx.fillStyle = k.rule;
  ctx.fillRect(M, H - 104, W - 2 * M, 1);
  ctx.fillStyle = k.muted;
  ctx.font = `500 16px ${DATA}`;
  ctx.fillText(`Same photo, same reading. ${c.hash.slice(0, 4)} · ${c.engine}`, M, H - 68);
  ctx.textAlign = "right";
  ctx.fillText("ratio.voidvision.org · made in the tab", W - M, H - 68);
  ctx.textAlign = "left";
  if (c.credit) {
    ctx.font = `400 13px ${BODY}`;
    ctx.fillText(c.credit, M, H - 40);
  }
  return card;
}

/** Draws the card and hands it to the browser as a PNG download. */
export async function saveCard(c: CardContent): Promise<void> {
  const card = await drawCard(c);
  const blob = await card.convertToBlob({ type: "image/png" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `ratio-${c.hash.slice(0, 4)}.png`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10_000);
}
