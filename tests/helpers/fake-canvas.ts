// Just enough of a browser for the overlay's Figure to run under node:
// canvases whose 2d context records what was drawn (each sheet remembers the
// first pixel put into it, so a test can tell the photo from a recoloured
// look), a manual animation-frame queue, and the token probes. No jsdom.

import { vi } from "vitest";

/** A recorded canvas: `ink` is the first pixel's RGBA put into it, `drawn` the ink of every image drawn onto it, in order. */
export class FakeCanvas {
  ink: string | null = null;
  drawn: (string | null)[] = [];
  style: Record<string, string> = {};
  constructor(
    public width = 0,
    public height = 0,
  ) {}
  getContext(): unknown {
    return fakeContext(this);
  }
  async convertToBlob(): Promise<Blob> {
    return new Blob([]);
  }
}

function fakeContext(owner: FakeCanvas): unknown {
  const methods: Record<string, (...a: unknown[]) => unknown> = {
    putImageData: (img) => {
      const d = (img as { data: Uint8ClampedArray }).data;
      owner.ink = `${d[0]},${d[1]},${d[2]},${d[3]}`;
    },
    drawImage: (src) => {
      owner.drawn.push((src as FakeCanvas).ink ?? null);
    },
    measureText: () => ({ width: 10 }),
  };
  return new Proxy({} as Record<string | symbol, unknown>, {
    get: (t, k) => (typeof k === "string" && k in methods ? methods[k] : k in t ? t[k] : () => undefined),
    set: (t, k, v) => {
      t[k] = v;
      return true;
    },
  });
}

/** Installs the fake browser globals; `frames.flush()` runs every queued animation frame once. */
export function installFakeBrowser(opts: { reducedMotion?: boolean } = {}) {
  let queue = new Map<number, (t: number) => void>();
  let next = 1;
  const el = () => ({ hidden: false, style: {} as Record<string, string>, remove() {}, append() {} });
  vi.stubGlobal("document", { createElement: el, body: el(), documentElement: el() });
  vi.stubGlobal("getComputedStyle", () => ({ color: "rgb(1, 2, 3)", getPropertyValue: () => "" }));
  vi.stubGlobal("matchMedia", () => ({ matches: opts.reducedMotion ?? false }));
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => {
    queue.set(next, fn);
    return next++;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => queue.delete(id));
  vi.stubGlobal("OffscreenCanvas", FakeCanvas);
  vi.stubGlobal(
    "ImageData",
    class {
      constructor(
        public data: Uint8ClampedArray,
        public width: number,
        public height: number,
      ) {}
    },
  );
  return {
    frames: {
      flush(now = performance.now()) {
        const run = queue;
        queue = new Map();
        for (const fn of run.values()) fn(now);
      },
      get pending() {
        return queue.size;
      },
    },
    restore: () => vi.unstubAllGlobals(),
  };
}

/** A solid display-size photo of one colour. */
export function solid(width: number, height: number, rgba: [number, number, number, number]) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < data.length; i += 4) data.set(rgba, i);
  return { width, height, data };
}
