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

export class Sheet {
  private y = 0;
  private anim: Animation | null = null;
  private stops: Record<Snap, number> = { peek: 0, half: 0, full: 0 };
  private wide = matchMedia(WIDE);
  private drag: { startY: number; startPointer: number; moved: boolean; id: number } | null = null;
  private velocity = new Velocity();
  private listeners = new Set<(top: number, snap: Snap) => void>();
  private _snap: Snap = "peek";

  constructor(
    readonly element: HTMLElement,
    private body: HTMLElement,
    private grip: HTMLButtonElement,
  ) {
    this.measure();
    this.place(this.stops.peek);
    this.element.dataset.snap = "peek";
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
    this.grip.setAttribute("aria-expanded", String(s !== "peek"));
    this.grip.setAttribute("aria-label", s === "full" ? "Collapse the reading" : "Expand the reading");
    // The body scrolls only when the sheet is fully up; below that a drag moves the sheet.
    this.body.style.overflowY = s === "full" || this.wide.matches ? "auto" : "hidden";
    if (s !== "full") this.body.scrollTop = 0;
  }

  /** Moves to a resting place, carrying `velocity` (px per second, downward positive) into the spring. */
  snap(to: Snap, velocity = 0): void {
    if (this.wide.matches) {
      this.setSnap(to);
      return;
    }
    this.measure();
    this.setSnap(to);
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
