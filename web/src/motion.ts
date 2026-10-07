// Ratio's motion presets (design/BRAND.md), integrated as springs. The
// numbers live in design/tokens.css (--spring-plumb and friends) and are read
// from there, so CSS and canvas motion share one source. A spring can start
// with the velocity a finger gave it (a flung sheet, a wipe let go mid
// drag), which is what makes the motion physical instead of eased.
// Reduced motion renders every final state at once.

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

export type SpringName = "plumb" | "lands" | "glide" | "settle" | "sheet" | "fling" | "arrive";

const cache = new Map<string, SpringParams>();

/** Reads "--spring-<name>: k c m" from the token file (once per name). */
export function springToken(name: SpringName): SpringParams {
  const hit = cache.get(name);
  if (hit) return hit;
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--spring-${name}`).trim();
  const [stiffness, damping, mass] = raw.split(/\s+/).map(Number);
  const p = { stiffness: stiffness || 200, damping: damping || 26, mass: mass || 1 };
  cache.set(name, p);
  return p;
}

export function numberToken(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

export interface Animation {
  done: Promise<void>;
  cancel: () => void;
}

/**
 * Runs a spring from `from` to `to`, calling `update` each frame. Substepped
 * at 240 Hz (Hooke's law with viscous damping). `velocity` is the starting
 * speed in units per second, so a release carries into the motion. Resolves
 * when it settles to 0.1% of the travel (or of `scale`, for a spring that
 * starts at rest at its target but with velocity). Returns a cancel
 * function alongside the promise; a cancelled spring stops where it is and
 * resolves at once.
 */
export function spring(p: SpringParams, from: number, to: number, update: (x: number, v: number) => void, velocity = 0, scale?: number): Animation {
  let id = 0;
  let cancelled = false;
  let finish = () => {};
  const done = new Promise<void>((resolve) => {
    finish = resolve;
    if (reducedMotion()) {
      update(to, 0);
      resolve();
      return;
    }
    let x = from;
    let v = velocity;
    let last = performance.now();
    const span = scale ?? (Math.abs(to - from) || 1);
    const step = (now: number) => {
      if (cancelled) return resolve();
      const dt = Math.min(0.064, (now - last) / 1000);
      last = now;
      const n = Math.max(1, Math.ceil(dt * 240));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        const a = (-p.stiffness * (x - to) - p.damping * v) / p.mass;
        v += a * h;
        x += v * h;
      }
      if (Math.abs(x - to) < 0.001 * span && Math.abs(v) < 0.01 * span) {
        update(to, 0);
        return resolve();
      }
      update(x, v);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
  });
  return {
    done,
    // Resolves at once: cancelAnimationFrame means the step that would
    // have resolved never runs, so a cancelled spring's `done` would
    // otherwise hang forever (T8 review round 2: the sheet's wheel waited
    // on it and stayed switched off). Callers that must not act on a
    // superseded spring check that it is still theirs.
    cancel: () => {
      if (cancelled) return;
      cancelled = true;
      cancelAnimationFrame(id);
      finish();
    },
  };
}

/** A linear tween over `ms` with the chalk curve's shape approximated by smoothstep. */
export function tween(ms: number, update: (t: number) => void): Promise<void> {
  return new Promise((resolve) => {
    if (reducedMotion() || ms <= 0) {
      update(1);
      return resolve();
    }
    const start = performance.now();
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / ms);
      update(t * t * (3 - 2 * t));
      if (t < 1) requestAnimationFrame(step);
      else resolve();
    };
    requestAnimationFrame(step);
  });
}

/** How long a chalk line of this length takes: length / --speed-chalk, clamped. */
export function chalkMs(lengthPx: number): number {
  const speed = numberToken("--speed-chalk") || 600;
  const min = numberToken("--dur-chalk-min") || 180;
  const max = numberToken("--dur-chalk-max") || 900;
  return Math.min(max, Math.max(min, (lengthPx / speed) * 1000));
}

/**
 * Tracks a pointer's velocity from its last few samples (a short window, so
 * a pause before release counts as a stop). Units per second.
 */
export class Velocity {
  private samples: { t: number; x: number }[] = [];
  reset(x: number): void {
    this.samples = [{ t: performance.now(), x }];
  }
  push(x: number): void {
    const now = performance.now();
    this.samples.push({ t: now, x });
    while (this.samples.length > 2 && now - this.samples[0].t > 100) this.samples.shift();
  }
  get value(): number {
    const now = performance.now();
    const s = this.samples;
    if (s.length < 2) return 0;
    const first = s[0];
    const last = s[s.length - 1];
    if (now - last.t > 80) return 0;
    const dt = (last.t - first.t) / 1000;
    return dt > 0 ? (last.x - first.x) / dt : 0;
  }
}

/** Where a flung thing would come to rest under friction: x + v * tau. */
export const project = (x: number, v: number, tau = 0.18): number => x + v * tau;
