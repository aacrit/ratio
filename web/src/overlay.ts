// The photo with its measurement drawn over it, and the read sequence
// (design/BRAND.md): the plumb line drops from the crown and settles as a
// damped pendulum, the tape draws from head to feet at chalk speed, the
// break line draws across, then the numeral lands. "Show the tuck" glides
// the break mark to the waist. Every stroke and numeral sits on the halo.
// Colours come from design/tokens.css; this file holds no colour literal.

import { GOLDEN, type OutfitReading, ratioText } from "./engine/rules";
import type { OutfitMeasure } from "./engine/measure";
import type { Pixels } from "./engine/resample";
import { chalkMs, numberToken, spring, springToken, tween } from "./motion";

/**
 * Resolves colour tokens to concrete colours a canvas understands. The
 * overlay sits on the photo over the fixed worsted halo in both themes, so
 * it always draws with the Cloth source colours (design/BRAND.md), never the
 * darkened Paper accents.
 */
function colours(): Record<"chalk" | "muted" | "tape" | "section" | "halo" | "glow", string> {
  const probe = document.createElement("span");
  probe.hidden = true;
  document.body.append(probe);
  const read = (token: string) => {
    probe.style.color = `var(${token})`;
    return getComputedStyle(probe).color;
  };
  const out = {
    chalk: read("--hex-chalk"),
    muted: read("--overlay-muted"),
    tape: read("--hex-tape"),
    section: read("--hex-verdigris"),
    halo: read("--color-halo"),
    glow: read("--overlay-tape-glow"),
  };
  probe.remove();
  return out;
}

interface Scene {
  plumbDeg: number;
  plumbAlpha: number;
  tape: number; // 0..1 drawn
  across: number; // 0..1 drawn
  breakRow: number | null;
  label: number | null; // the ratio shown at the break
  glow: number; // 0..1 behind the numeral
  ghostRow: number | null; // where a tuck would move the break
  near: boolean; // the break sits near the golden section
}

export class Figure {
  private ctx: CanvasRenderingContext2D;
  private photo: OffscreenCanvas;
  private scene: Scene;
  private c = colours();
  private tuckAnim: { done: Promise<void>; cancel: () => void } | null = null;

  constructor(
    canvas: HTMLCanvasElement,
    private pixels: Pixels,
    private m: OutfitMeasure,
    private reading: OutfitReading,
  ) {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    canvas.width = pixels.width * dpr;
    canvas.height = pixels.height * dpr;
    canvas.style.aspectRatio = `${pixels.width} / ${pixels.height}`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.ctx = ctx;
    // putImageData ignores the transform, so the photo goes through an
    // offscreen copy and drawImage, which honours it.
    this.photo = new OffscreenCanvas(pixels.width, pixels.height);
    this.photo.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    this.scene = { plumbDeg: 0, plumbAlpha: 0, tape: 0, across: 0, breakRow: m.breakRow, label: null, glow: 0, ghostRow: null, near: false };
    this.draw();
  }

  private get h() {
    return this.m.bottom - this.m.top;
  }
  private get tapeX() {
    return Math.max(14, this.m.left - 18);
  }

  private line(x0: number, y0: number, x1: number, y1: number, colour: string, width: number) {
    const { ctx } = this;
    ctx.lineCap = "round";
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.lineTo(x1, y1);
    ctx.strokeStyle = this.c.halo;
    ctx.lineWidth = width + 3.5;
    ctx.stroke();
    ctx.strokeStyle = colour;
    ctx.lineWidth = width;
    ctx.stroke();
  }

  draw(): void {
    const { ctx, pixels, m, scene: s, c } = this;
    const unit = Math.max(1, pixels.width / 340);
    ctx.clearRect(0, 0, pixels.width, pixels.height);
    ctx.drawImage(this.photo, 0, 0);

    // The plumb line from the crown, swinging about its top.
    if (s.plumbAlpha > 0) {
      const len = this.h * 1.02;
      const a = (s.plumbDeg * Math.PI) / 180;
      const x1 = m.centerX + Math.sin(a) * len;
      const y1 = m.top + Math.cos(a) * len;
      ctx.globalAlpha = s.plumbAlpha;
      this.line(m.centerX, m.top, x1, y1, c.chalk, 1.1 * unit);
      ctx.fillStyle = c.tape;
      ctx.beginPath();
      ctx.arc(x1, y1, 3.2 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
    }

    // The tape, head to feet, ticked in tenths, with the section mark.
    const x = this.tapeX;
    if (s.tape > 0) {
      const yEnd = m.top + this.h * s.tape;
      this.line(x, m.top, x, yEnd, c.tape, 1.6 * unit);
      for (let i = 0; i <= 10; i++) {
        const y = m.top + (this.h * i) / 10;
        if (y > yEnd) break;
        const len = (i % 5 === 0 ? 9 : 4) * unit;
        this.line(x - len, y, x, y, c.tape, 1.1 * unit);
      }
      const gy = m.top + this.h * GOLDEN;
      if (gy <= yEnd) {
        this.line(x, gy, x + 11 * unit, gy, s.near ? c.section : c.muted, 1.4 * unit);
        if (s.near) {
          ctx.strokeStyle = c.section;
          ctx.lineWidth = 1.6 * unit;
          ctx.beginPath();
          ctx.arc(x, gy, 5 * unit, 0, Math.PI * 2);
          ctx.stroke();
        }
      }
    }

    // Where a tuck would put the break: a faint chalk line.
    if (s.ghostRow !== null) {
      ctx.setLineDash([3 * unit, 4 * unit]);
      this.line(x, s.ghostRow, m.right + 14 * unit, s.ghostRow, c.muted, 1 * unit);
      ctx.setLineDash([]);
    }

    // The break, drawn across the figure, and its numeral.
    if (s.breakRow !== null && s.across > 0) {
      const xEnd = x + (m.right + 14 * unit - x) * s.across;
      this.line(x, s.breakRow, xEnd, s.breakRow, c.tape, 1.6 * unit);
    }
    if (s.breakRow !== null && s.label !== null) {
      const text = ratioText(s.label);
      ctx.font = `500 ${Math.round(10 * unit)}px "JetBrains Mono", ui-monospace, monospace`;
      const w = ctx.measureText(text).width + 10 * unit;
      const bh = 16 * unit;
      const bx = Math.min(pixels.width - w - 4, m.right + 18 * unit);
      const by = s.breakRow - bh / 2;
      ctx.fillStyle = c.halo;
      ctx.beginPath();
      ctx.roundRect(bx, by, w, bh, 3 * unit);
      ctx.fill();
      if (s.glow > 0) {
        ctx.globalAlpha = s.glow;
        ctx.fillStyle = c.glow;
        ctx.fill();
        ctx.globalAlpha = 1;
      }
      ctx.fillStyle = c.tape;
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 5 * unit, s.breakRow + 0.5);
    }
  }

  /** The read sequence: plumb, chalk, lands. Resolves when the numeral has landed; the plumb keeps settling after. */
  async play(): Promise<void> {
    const s = this.scene;
    const target = this.reading.bins.proportion;
    s.near = this.reading.lines[0].state === "golden";
    s.plumbAlpha = 0.75;
    const swing = numberToken("--plumb-swing") || 14;
    const plumb = spring(springToken("plumb"), -swing, 0, (d) => {
      s.plumbDeg = d;
      this.draw();
    });
    await Promise.race([plumb.done, new Promise((r) => setTimeout(r, 700))]);
    await tween(chalkMs(this.h), (t) => {
      s.tape = t;
      this.draw();
    });
    if (s.breakRow !== null && target !== null) {
      await tween(chalkMs(this.m.right - this.tapeX), (t) => {
        s.across = t;
        this.draw();
      });
      s.glow = 1;
      await spring(springToken("lands"), 0, target, (v) => {
        s.label = v;
        this.draw();
      }).done;
      void tween(600, (t) => {
        s.glow = 1 - t;
        this.draw();
      });
    }
    // The plumb finishes settling on its own; the reading does not wait for it.
    void plumb.done.then(() =>
      tween(400, (t) => {
        s.plumbAlpha = 0.75 - 0.5 * t;
        this.draw();
      }),
    );
  }

  /**
   * Glides the break to a look's proportion (head 0 to feet 1), or back to
   * where it was measured (null). The measured break stays as a faint chalk
   * line while a look is shown, so before and after are both on screen.
   */
  showBreakAt(ratio: number | null): void {
    const s = this.scene;
    if (this.m.breakRow === null) return;
    this.tuckAnim?.cancel();
    const from = s.breakRow ?? this.m.breakRow;
    const to = ratio === null ? this.m.breakRow : this.m.top + this.h * ratio;
    s.ghostRow = ratio === null ? null : this.m.breakRow;
    s.near = false;
    const toRatio = ratio ?? this.reading.bins.proportion ?? 0;
    const fromRatio = s.label ?? toRatio;
    this.tuckAnim = spring(springToken("glide"), 0, 1, (t) => {
      s.breakRow = from + (to - from) * t;
      s.label = fromRatio + (toRatio - fromRatio) * t;
      this.draw();
    });
    const anim = this.tuckAnim;
    void anim.done.then(() => {
      s.near = Math.abs(toRatio - GOLDEN) <= 0.02;
      this.draw();
    });
  }

  /** Shows the tuck the proportion advice describes (on), or the outfit as worn. */
  showTuck(on: boolean): void {
    this.showBreakAt(on ? this.reading.bins.waist : null);
  }

  /**
   * Cross-fades the photo to another version of itself (a tried look's
   * recolour, or the photo as worn). Same size, same overlay on top.
   */
  async setPhoto(pixels: Pixels): Promise<void> {
    const next = new OffscreenCanvas(pixels.width, pixels.height);
    next.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
    const prev = this.photo;
    const mix = new OffscreenCanvas(pixels.width, pixels.height);
    const c = mix.getContext("2d");
    await tween(numberToken("--dur-morph") || 360, (t) => {
      if (!c) return;
      c.globalAlpha = 1;
      c.drawImage(prev, 0, 0);
      c.globalAlpha = t;
      c.drawImage(next, 0, 0);
      this.photo = mix;
      this.draw();
    });
    this.photo = next;
    this.draw();
  }
}
