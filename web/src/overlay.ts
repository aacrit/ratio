// The photo with its measurement drawn over it, and the read sequence
// (design/BRAND.md): the plumb line drops from the crown and settles as a
// damped pendulum, the tape draws from head to feet at chalk speed, the
// break line draws across, then the numeral lands. "Show the tuck" glides
// the break mark to the waist. Every stroke and numeral sits on the halo.
// While a look is tried, a chalk wipe splits the photo: as worn on the left,
// the look on the right; drag it (and let it go: it carries) or use the
// range control to compare.
//
// The canvas holds the photo at display size (read.ts, DISPLAY_SIZE) while
// every measurement is in reading-size coordinates: one scale transform
// maps the two, so the overlay is drawn once, in the units it was measured
// in, and stays sharp on a large stage.
// Colours come from design/tokens.css; this file holds no colour literal.

import { GOLDEN, type OutfitReading, ratioText } from "./engine/rules";
import type { OutfitMeasure } from "./engine/measure";
import type { Pixels } from "./engine/resample";
import { type Animation, chalkMs, numberToken, project, reducedMotion, spring, springToken, tween } from "./motion";
import { labelAtRest } from "./ui/reveal";

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

/** Draws display pixels into an offscreen canvas (putImageData ignores transforms; drawImage honours them). */
function sheet(pixels: Pixels): OffscreenCanvas {
  const c = new OffscreenCanvas(pixels.width, pixels.height);
  c.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height), 0, 0);
  return c;
}

/** Shows a photo on the stage canvas before its reading exists (the models are still at work). */
export function showPhoto(canvas: HTMLCanvasElement, display: Pixels): void {
  canvas.width = display.width;
  canvas.height = display.height;
  canvas.style.aspectRatio = `${display.width} / ${display.height}`;
  canvas.getContext("2d")?.putImageData(new ImageData(new Uint8ClampedArray(display.data), display.width, display.height), 0, 0);
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
  /**
   * The tried look's recoloured photo, or null when showing the outfit as
   * worn. This is the state on screen, and the only layer the saved card
   * reads: it is cleared the moment the person goes back to as worn.
   */
  private look: OffscreenCanvas | null = null;
  /**
   * A look on its way out: drawn on the stage while the wipe glides home,
   * never on the card (T7, R-09: the card kept the look's recolour under
   * "As worn" until this glide settled, and for good when it was cut short).
   */
  private leaving: OffscreenCanvas | null = null;
  /** Where the look begins, as a fraction of the width (0 = all look, 1 = all as worn). */
  private wipe = 1;
  private wipeAnim: Animation | null = null;
  private scene: Scene;
  private c = colours();
  private tuckAnim: Animation | null = null;
  /** Display pixels per reading pixel. */
  private scale: number;
  private rw: number;
  private rh: number;
  private frame = 0;

  constructor(
    readonly element: HTMLCanvasElement,
    display: Pixels,
    read: { width: number; height: number },
    private m: OutfitMeasure,
    private reading: OutfitReading,
  ) {
    const canvas = element;
    canvas.width = display.width;
    canvas.height = display.height;
    canvas.style.aspectRatio = `${display.width} / ${display.height}`;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("no 2d context");
    this.ctx = ctx;
    this.rw = read.width;
    this.rh = read.height;
    this.scale = display.width / read.width;
    this.photo = sheet(display);
    this.scene = { plumbDeg: 0, plumbAlpha: 0, tape: 0, across: 0, breakRow: m.breakRow, label: null, glow: 0, ghostRow: null, near: false };
    this.draw();
  }

  private get h() {
    return this.m.bottom - this.m.top;
  }
  private get tapeX() {
    return Math.max(14, this.m.left - 18);
  }

  private line(ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D, x0: number, y0: number, x1: number, y1: number, colour: string, width: number) {
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

  /** Draws at most once per frame, however many springs ask. */
  private draw(): void {
    if (this.frame) return;
    this.frame = requestAnimationFrame(() => {
      this.frame = 0;
      this.paint();
    });
  }

  /**
   * Puts this figure back on its canvas after something else drew there (a
   * failed re-read's photo, shown the moment it decoded, R-09): the canvas
   * size and aspect ratio go back to this read's photo before the repaint,
   * since paint() alone draws at this read's scale into whatever size the
   * other photo left behind.
   */
  restore(): void {
    const { width, height } = this.photo;
    this.element.width = width;
    this.element.height = height;
    this.element.style.aspectRatio = `${width} / ${height}`;
    this.paint();
  }

  /**
   * Paints the scene. On screen by default; into another context (the saved
   * card) with `still`, which draws the look whole and no wipe.
   */
  paint(target: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D = this.ctx, still = false): void {
    const ctx = target;
    const { m, scene: s, c, rw, rh } = this;
    const unit = Math.max(1, rw / 340);
    ctx.setTransform(this.scale, 0, 0, this.scale, 0, 0);
    ctx.clearRect(0, 0, rw, rh);
    // The stage draws a leaving look behind the wipe as it glides home; the
    // card draws only the look on screen, whole, or the photo as worn.
    const layer = still ? this.look : (this.look ?? this.leaving);
    ctx.drawImage(still && layer ? layer : this.photo, 0, 0, rw, rh);
    if (!still && layer && this.wipe < 1) {
      const x0 = rw * this.wipe;
      ctx.save();
      ctx.beginPath();
      ctx.rect(x0, 0, rw - x0, rh);
      ctx.clip();
      ctx.drawImage(layer, 0, 0, rw, rh);
      ctx.restore();
    }

    // The plumb line from the crown, swinging about its top.
    if (s.plumbAlpha > 0) {
      const len = this.h * 1.02;
      const a = (s.plumbDeg * Math.PI) / 180;
      const x1 = m.centerX + Math.sin(a) * len;
      const y1 = m.top + Math.cos(a) * len;
      ctx.globalAlpha = s.plumbAlpha;
      this.line(ctx, m.centerX, m.top, x1, y1, c.chalk, 1.1 * unit);
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
      this.line(ctx, x, m.top, x, yEnd, c.tape, 1.6 * unit);
      for (let i = 0; i <= 10; i++) {
        const y = m.top + (this.h * i) / 10;
        if (y > yEnd) break;
        const len = (i % 5 === 0 ? 9 : 4) * unit;
        this.line(ctx, x - len, y, x, y, c.tape, 1.1 * unit);
      }
      const gy = m.top + this.h * GOLDEN;
      if (gy <= yEnd) {
        this.line(ctx, x, gy, x + 11 * unit, gy, s.near ? c.section : c.muted, 1.4 * unit);
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
      this.line(ctx, x, s.ghostRow, m.right + 14 * unit, s.ghostRow, c.muted, 1 * unit);
      ctx.setLineDash([]);
    }

    // The break, drawn across the figure, and its numeral.
    if (s.breakRow !== null && s.across > 0) {
      const xEnd = x + (m.right + 14 * unit - x) * s.across;
      this.line(ctx, x, s.breakRow, xEnd, s.breakRow, c.tape, 1.6 * unit);
    }
    if (s.breakRow !== null && s.label !== null) {
      const text = ratioText(s.label);
      ctx.font = `500 ${Math.round(10 * unit)}px "JetBrains Mono", ui-monospace, monospace`;
      const w = ctx.measureText(text).width + 10 * unit;
      const bh = 16 * unit;
      const bx = Math.min(rw - w - 4, m.right + 18 * unit);
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
      ctx.textAlign = "left";
      ctx.textBaseline = "middle";
      ctx.fillText(text, bx + 5 * unit, s.breakRow + 0.5);
    }

    // The wipe: a chalk line with a grip, and the two sides named.
    if (!still && layer && this.wipe > 0 && this.wipe < 1) {
      const wx = rw * this.wipe;
      this.line(ctx, wx, 0, wx, rh, c.chalk, 1.4 * unit);
      ctx.fillStyle = c.halo;
      ctx.beginPath();
      ctx.arc(wx, rh / 2, 9 * unit, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = c.chalk;
      ctx.lineWidth = 1.4 * unit;
      ctx.stroke();
      // The grip's two ticks, a chalk mark that says "slide".
      this.line(ctx, wx - 3.5 * unit, rh / 2 - 3 * unit, wx - 3.5 * unit, rh / 2 + 3 * unit, c.chalk, 1 * unit);
      this.line(ctx, wx + 3.5 * unit, rh / 2 - 3 * unit, wx + 3.5 * unit, rh / 2 + 3 * unit, c.chalk, 1 * unit);
      ctx.font = `500 ${Math.round(9 * unit)}px "JetBrains Mono", ui-monospace, monospace`;
      ctx.textBaseline = "middle";
      for (const [label, lx0, align] of [["AS WORN", wx - 8 * unit, "right"], ["THE LOOK", wx + 8 * unit, "left"]] as const) {
        const w = ctx.measureText(label).width + 8 * unit;
        const lx = align === "right" ? lx0 - w : lx0;
        ctx.fillStyle = c.halo;
        ctx.beginPath();
        ctx.roundRect(lx, 8 * unit, w, 14 * unit, 3 * unit);
        ctx.fill();
        ctx.fillStyle = c.chalk;
        ctx.textAlign = "left";
        ctx.fillText(label, lx + 4 * unit, 15 * unit);
      }
    }
  }

  /**
   * Shows a tried look's recoloured photo (display size) behind the wipe,
   * which glides to the middle so both sides are in view; null returns to
   * the outfit as worn at once (the card and `hasLook` see it immediately),
   * while the stage lets the old look glide out behind the wipe.
   */
  setLook(pixels: Pixels | null): void {
    this.wipeAnim?.cancel();
    if (!pixels) {
      if (this.look) this.leaving = this.look;
      this.look = null;
      const from = this.wipe;
      const anim = spring(springToken("glide"), from, 1, (w) => {
        this.wipe = w;
        this.draw();
      });
      this.wipeAnim = anim;
      void anim.done.then(() => {
        // Home: the leaving layer is spent. A newer look or exit that cut
        // this glide short owns the layers now, so leave them alone.
        if (this.wipeAnim === anim) this.leaving = null;
        this.draw();
      });
      return;
    }
    this.leaving = null;
    this.look = sheet(pixels);
    const from = this.wipe;
    this.wipeAnim = spring(springToken("glide"), from, 0.5, (w) => {
      this.wipe = w;
      this.draw();
    });
  }

  /** Moves the wipe (0 = all the look, 1 = all as worn), from a drag or the range control. */
  setWipe(fraction: number): void {
    if (!this.look) return; // as worn there is nothing to compare; a leaving look is not draggable
    this.wipeAnim?.cancel();
    this.wipe = Math.max(0, Math.min(1, fraction));
    this.draw();
  }

  /** The wipe let go at `velocity` (fractions of the width per second): it carries on and settles where it would stop. */
  flingWipe(velocity: number, onMove?: (w: number) => void): void {
    if (!this.look) return;
    this.wipeAnim?.cancel();
    const to = Math.max(0.02, Math.min(0.98, project(this.wipe, velocity)));
    this.wipeAnim = spring(
      springToken("fling"),
      this.wipe,
      to,
      (w) => {
        this.wipe = Math.max(0, Math.min(1, w));
        this.draw();
        onMove?.(this.wipe);
      },
      velocity,
      1,
    );
  }

  get wipeAt(): number {
    return this.wipe;
  }

  get hasLook(): boolean {
    return this.look !== null;
  }

  /**
   * The photo with its overlay at rest, the look whole when one is tried
   * (never a look on its way out): for the saved card. Sized from this
   * read's own photo, never the shared stage canvas, which the next read
   * may already have resized while this card is drawing (as restore() does).
   */
  still(): OffscreenCanvas {
    const out = new OffscreenCanvas(this.photo.width, this.photo.height);
    const ctx = out.getContext("2d");
    if (ctx) this.paint(ctx, true);
    return out;
  }

  /** A key or tap during the signature (play's full sequence) jumps straight to the rested end state. */
  private revealSkip = false;
  skipReveal(): void {
    this.revealSkip = true;
  }

  /** Every reveal element at its rested, fully measured state at once: never a number mid-count. */
  private settleNow(withPulse: boolean): void {
    const s = this.scene;
    const target = this.reading.bins.proportion;
    s.near = this.reading.lines[0].state === "golden";
    s.plumbAlpha = 0.25;
    s.plumbDeg = 0;
    s.tape = 1;
    s.across = 1;
    if (s.breakRow !== null) s.breakRow = this.m.breakRow;
    s.label = labelAtRest(true, target);
    s.glow = withPulse ? 1 : 0;
    this.draw();
  }

  /**
   * The read sequence: plumb, chalk, lands (design/BRAND.md). `quick` plays a
   * brief settle instead (T3: only the first read of a session gets the full
   * signature; later reads appear settled). The tape label and the hero
   * numeral never show a value that was not measured, so the label is held
   * back (labelAtRest) until the sequence has actually arrived.
   */
  async play(opts: { quick?: boolean } = {}): Promise<void> {
    const s = this.scene;
    const target = this.reading.bins.proportion;
    this.revealSkip = false;
    if (opts.quick || reducedMotion()) {
      this.settleNow(!reducedMotion());
      if (!reducedMotion())
        await tween(430, (t) => {
          s.glow = 1 - t;
          this.draw();
        });
      return;
    }
    s.near = this.reading.lines[0].state === "golden";
    s.plumbAlpha = 0.75;
    const swing = numberToken("--plumb-swing") || 14;
    const plumb = spring(springToken("plumb"), -swing, 0, (d) => {
      s.plumbDeg = d;
      this.draw();
    });
    await Promise.race([plumb.done, new Promise((r) => setTimeout(r, 700))]);
    if (this.revealSkip) return this.settleNow(false);
    await tween(chalkMs(this.h), (t) => {
      s.tape = t;
      this.draw();
    });
    if (this.revealSkip) return this.settleNow(false);
    if (s.breakRow !== null && target !== null) {
      await tween(chalkMs(this.m.right - this.tapeX), (t) => {
        s.across = t;
        this.draw();
      });
      if (this.revealSkip) return this.settleNow(false);
      s.glow = 1;
      await spring(springToken("lands"), 0, target, () => this.draw()).done;
      if (this.revealSkip) return this.settleNow(false);
      s.label = labelAtRest(true, target);
      this.draw();
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
    // The line glides; its numeral is never shown mid-glide (labelAtRest), only once it lands.
    s.label = labelAtRest(false, toRatio);
    this.tuckAnim = spring(springToken("glide"), 0, 1, (t) => {
      s.breakRow = from + (to - from) * t;
      this.draw();
    });
    const anim = this.tuckAnim;
    void anim.done.then(() => {
      // A cancelled glide resolves too (motion.ts): if a newer one cut it
      // short, its numeral must not land mid-glide, so only the latest acts.
      if (this.tuckAnim !== anim) return;
      s.near = Math.abs(toRatio - GOLDEN) <= 0.02;
      s.label = labelAtRest(true, toRatio);
      this.draw();
    });
  }

  /** Shows the tuck the proportion advice describes (on), or the outfit as worn. */
  showTuck(on: boolean): void {
    this.showBreakAt(on ? this.reading.bins.waist : null);
  }
}
