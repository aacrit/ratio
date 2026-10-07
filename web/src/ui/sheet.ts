// The sheet: on a phone, the reading rides a draggable sheet over the stage
// with three resting places (peek, half, full); on a wide screen it is the
// side panel and never moves. A drag follows the finger one to one, and a
// release carries its velocity into the `sheet` spring, so a fling lands
// where the finger meant it to. Only transform moves, so the photo behind
// stays at 60 fps. Reduced motion snaps without the spring.
//
// The stage listens to the sheet's edge (onMove) and scales the photo to
// the room left above it, so the photo never scrolls away.

import { type Animation, Velocity, project, reducedMotion, spring, springToken } from "../motion";

export type Snap = "peek" | "half" | "full";

const WIDE = "(min-width: 1024px)";

/**
 * The grip's accessible state and label for each resting place (T8, R-09:
 * the handle said "Expand the reading" with aria-expanded="true" while only
 * half open; review round 1: pairing a label that still says "Expand" with
 * aria-expanded="true" is self-contradictory at any two states, not only
 * that one). One stable name, independent of state; aria-expanded alone
 * carries whether it is collapsed (peek) or not (half or full).
 */
export function gripLabel(snap: Snap): { expanded: boolean; label: string } {
  return { expanded: snap !== "peek", label: "Expand or collapse the reading" };
}

/** The handful of a WheelEvent that wheelTarget needs, kept as a plain shape so it can be tested without a DOM. */
export interface WheelInput {
  deltaX: number;
  deltaY: number;
  /** 0 = pixels, 1 = lines, 2 = pages (WheelEvent.DOM_DELTA_*): a line or page delta is never a stray trackpad jitter, however small its number. */
  deltaMode: number;
  /** A pinch-to-zoom gesture reports as a wheel event with ctrlKey set in every evergreen browser; it is never a request to open the sheet. */
  ctrlKey: boolean;
}

/** Below this many pixels (deltaMode 0 only) a wheel delta reads as trackpad jitter, not an intentional scroll (review round 1). */
const MIN_PIXEL_DELTA = 4;

/**
 * What a wheel or trackpad scroll over the sheet body should do. Below
 * full, the body's overflow stays hidden (design/BRAND.md: "full ... and
 * only then does it scroll inside"), so a scroll gesture there is the same
 * cue a swipe up already is through the pointer handlers below: raise the
 * sheet to full, where the rest of the reading (Shortcuts, Download,
 * feedback) is reachable by scrolling in place. Once full, this returns
 * null and the native scroll takes over. A pinch-zoom, a mostly-horizontal
 * scroll, a tiny jitter, or scrolling back up are all left alone: none of
 * them is a request to open the sheet further.
 */
export function wheelTarget(snap: Snap, e: WheelInput): Snap | null {
  if (snap === "full" || e.ctrlKey) return null;
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return null;
  if (e.deltaY <= 0) return null;
  if (e.deltaMode === 0 && e.deltaY < MIN_PIXEL_DELTA) return null;
  return "full";
}

export class Sheet {
  private y = 0;
  private anim: Animation | null = null;
  private stops: Record<Snap, number> = { peek: 0, half: 0, full: 0 };
  private wide = matchMedia(WIDE);
  private drag: { startY: number; startPointer: number; moved: boolean; id: number } | null = null;
  private velocity = new Velocity();
  private listeners = new Set<(top: number, snap: Snap) => void>();
  private _snap: Snap = "peek";
  /** True from the moment a wheel escalates the sheet until that spring settles, so a momentum-scroll trackpad's dozens of further events (all still arriving while the sheet is mid-flight) do not each restart it. Cleared by any snap or press too, so a cut-short spring never leaves the wheel switched off (review round 2). */
  private wheelSettling = false;

  constructor(
    readonly element: HTMLElement,
    private body: HTMLElement,
    private grip: HTMLButtonElement,
  ) {
    this.measure();
    this.place(this.stops.peek);
    this.setSnap("peek");
    addEventListener("resize", () => this.measure(true));
    this.wide.addEventListener("change", () => this.measure(true));
    grip.addEventListener("click", () => {
      if (this.drag?.moved) return;
      this.snap(this._snap === "peek" ? "half" : this._snap === "half" ? "full" : "peek");
    });
    element.addEventListener("keydown", (e) => {
      if (e.key !== "Escape" || this._snap === "peek") return;
      // Esc does one thing: claim it here so the page's shortcuts (also
      // bound to Escape, for "back to the original") do not also fire.
      e.preventDefault();
      this.snap("peek");
    });
    element.addEventListener("pointerdown", (e) => this.down(e));
    element.addEventListener("pointermove", (e) => this.move(e));
    element.addEventListener("pointerup", (e) => this.up(e));
    element.addEventListener("pointercancel", (e) => this.up(e));
    // A wheel or trackpad scroll reaches the rest of the reading the same
    // way a swipe up already does (T8, Sam's re-run: "can't be reached by
    // swipe or wheel" - the pointer handlers below already raise the sheet
    // on a drag; wheel input needs the same escalation since it never
    // reaches the pointer handlers).
    body.addEventListener("wheel", (e) => this.wheel(e), { passive: false });
    // Test hook, and a way for the page to ask for a resting place by event.
    element.addEventListener("ratio:snap", (e) => this.snap((e as CustomEvent<Snap>).detail));
  }

  get snapped(): Snap {
    return this._snap;
  }

  get isWide(): boolean {
    return this.wide.matches;
  }

  /** Where the sheet's top edge is, in viewport px, for the stage to fit the photo above it. */
  onMove(fn: (top: number, snap: Snap) => void): void {
    this.listeners.add(fn);
    fn(this.top, this._snap);
  }

  private get top(): number {
    return this.wide.matches ? innerHeight : this.element.getBoundingClientRect().top;
  }

  /** The peek shows the grip and the first element marked data-peek that is on screen. */
  measure(keep = false): void {
    if (this.wide.matches) {
      this.element.style.transform = "";
      this.body.style.overflowY = "";
      document.documentElement.style.setProperty("--sheet-peek", "0px");
      this.notify();
      return;
    }
    const h = this.element.offsetHeight;
    const peekEl = [...this.element.querySelectorAll<HTMLElement>("[data-peek]")].find((el) => el.offsetParent !== null);
    const peek = Math.min(h, Math.max(88, this.grip.offsetHeight + (peekEl?.offsetHeight ?? 0) + 18));
    // The stage lays out the photo and its foot above the resting sheet.
    document.documentElement.style.setProperty("--sheet-peek", `${peek}px`);
    this.stops = { full: 0, half: Math.max(0, h - Math.round(innerHeight * 0.5)), peek: Math.max(0, h - peek) };
    if (keep) this.place(this.stops[this._snap]);
  }

  private place(y: number): void {
    this.y = y;
    this.element.style.transform = `translate3d(0, ${y}px, 0)`;
    this.notify();
  }

  private notify(): void {
    const top = this.top;
    this.listeners.forEach((l) => l(top, this._snap));
  }

  private setSnap(s: Snap): void {
    this._snap = s;
    this.element.dataset.snap = s;
    const { expanded, label } = gripLabel(s);
    this.grip.setAttribute("aria-expanded", String(expanded));
    this.grip.setAttribute("aria-label", label);
    // The body scrolls only when the sheet is fully up; below that a drag (or a wheel, below) moves the sheet.
    this.body.style.overflowY = s === "full" || this.wide.matches ? "auto" : "hidden";
    if (s !== "full") this.body.scrollTop = 0;
  }

  private wheel(e: WheelEvent): void {
    if (this.wide.matches) return;
    if (this.wheelSettling) {
      // The rest of a momentum scroll: claim it, so it neither restarts the
      // spring nor scrolls the (now full) body mid-flight.
      e.preventDefault();
      return;
    }
    const target = wheelTarget(this._snap, e);
    if (!target) return;
    e.preventDefault();
    this.snap(target);
    if (reducedMotion()) return;
    const anim = this.anim;
    if (!anim) return;
    this.wheelSettling = true;
    void anim.done.then(() => {
      // Only this wheel's own spring ends its settle: a snap or a press
      // that cut it short has already cleared the flag (review round 2).
      if (this.anim === anim) this.wheelSettling = false;
    });
  }

  /** Moves to a resting place, carrying `velocity` (px per second, downward positive) into the spring. */
  snap(to: Snap, velocity = 0): void {
    if (this.wide.matches) {
      this.setSnap(to);
      return;
    }
    this.measure();
    this.setSnap(to);
    // Any other move ends a wheel's settle: the wheel must work again at once.
    this.wheelSettling = false;
    this.anim?.cancel();
    const target = this.stops[to];
    if (reducedMotion()) {
      this.place(target);
      return;
    }
    this.anim = spring(springToken("sheet"), this.y, target, (y) => this.place(y), velocity, innerHeight);
  }

  private down(e: PointerEvent): void {
    if (this.wide.matches || e.button !== 0) return;
    // Inside the scrolled body, a drag scrolls unless the body is at its top.
    const inBody = this.body.contains(e.target as Node);
    if (inBody && this._snap === "full" && this.body.scrollTop > 0) return;
    // A press on a control is a press until it clearly moves; then it is a drag of the sheet.
    this.wheelSettling = false;
    this.anim?.cancel();
    this.drag = { startY: this.y, startPointer: e.clientY, moved: false, id: e.pointerId };
    this.velocity.reset(e.clientY);
  }

  private move(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    const dy = e.clientY - d.startPointer;
    if (!d.moved) {
      if (Math.abs(dy) < 6) return;
      // A full sheet dragged up has nowhere to go: let the body scroll instead.
      if (this._snap === "full" && dy < 0) {
        this.drag = null;
        return;
      }
      d.moved = true;
      this.element.setPointerCapture(e.pointerId);
      this.body.style.overflowY = "hidden";
    }
    this.velocity.push(e.clientY);
    const max = this.stops.peek;
    let y = d.startY + dy;
    // Past the ends the sheet resists, like a drawer against its stop.
    if (y < 0) y = -Math.sqrt(-y) * 2;
    if (y > max) y = max + Math.sqrt(y - max) * 2;
    this.place(y);
  }

  private up(e: PointerEvent): void {
    const d = this.drag;
    if (!d || e.pointerId !== d.id) return;
    this.drag = null;
    if (!d.moved) return;
    if (this.element.hasPointerCapture(e.pointerId)) this.element.releasePointerCapture(e.pointerId);
    const v = this.velocity.value;
    // Where the sheet would come to rest, then the nearest stop to that.
    const landing = project(this.y, v);
    const order: Snap[] = ["full", "half", "peek"];
    let best: Snap = "peek";
    let dist = Infinity;
    for (const s of order) {
      const k = Math.abs(this.stops[s] - landing);
      if (k < dist) {
        dist = k;
        best = s;
      }
    }
    this.snap(best, v);
    // The click that ends a drag on the grip must not also toggle it.
    setTimeout(() => {
      if (this.drag === null) d.moved = false;
    }, 0);
  }
}
