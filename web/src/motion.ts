// Ratio's motion presets (design/BRAND.md), integrated as springs. The
// numbers live in design/tokens.css (--spring-plumb and friends) and are read
// from there, so CSS and canvas motion share one source.
// Reduced motion renders every final state at once.

export const reducedMotion = (): boolean => matchMedia("(prefers-reduced-motion: reduce)").matches;

export interface SpringParams {
  stiffness: number;
  damping: number;
  mass: number;
}

/** Reads "--spring-<name>: k c m" from the token file. */
export function springToken(name: "plumb" | "lands" | "glide" | "settle"): SpringParams {
  const raw = getComputedStyle(document.documentElement).getPropertyValue(`--spring-${name}`).trim();
  const [stiffness, damping, mass] = raw.split(/\s+/).map(Number);
  return { stiffness, damping, mass };
}

export function numberToken(name: string): number {
  return parseFloat(getComputedStyle(document.documentElement).getPropertyValue(name));
}

/**
 * Runs a spring from `from` to `to`, calling `update` each frame. Substepped
 * at 240 Hz (Hooke's law with viscous damping). Resolves when it settles to
 * 0.1% of the travel. Returns a cancel function alongside the promise.
 */
export function spring(p: SpringParams, from: number, to: number, update: (x: number) => void): { done: Promise<void>; cancel: () => void } {
  let id = 0;
  let cancelled = false;
  const done = new Promise<void>((resolve) => {
    if (reducedMotion()) {
      update(to);
      resolve();
      return;
    }
    let x = from;
    let v = 0;
    let last = performance.now();
    const span = Math.abs(to - from) || 1;
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
        update(to);
        return resolve();
      }
      update(x);
      id = requestAnimationFrame(step);
    };
    id = requestAnimationFrame(step);
  });
  return {
    done,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(id);
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
