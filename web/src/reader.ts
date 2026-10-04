// The page's side of the read worker (read.worker.ts): one worker, created
// on the first sign of intent, that downloads the models once and then
// reads every photo. The page keeps its thread for the stage and the sheet.
// Messages are typed here, shared by both sides.

import type { Mask } from "./engine/measure";
import type { Move } from "./engine/looks";
import type { Swatch } from "./engine/palette";
import type { Pixels } from "./engine/resample";
import type { Read, ReadFailure } from "./read";
import { type Bands, type Box, type PhotoPlan, refuseAll } from "./tryon/recolour";
import ReadWorker from "./read.worker?worker";

export type ToWorker =
  | { type: "load" }
  | { type: "read"; id: number; file: Blob }
  | { type: "recolour"; id: number; pixels: Pixels; mask: Mask; box: Box; bands: Bands; swatches: Swatch[]; moves: Move[]; avoid: number[] }
  | { type: "plan"; id: number; pixels: Pixels; full: Mask; person: Mask; box: Box; bands: Bands; swatches: Swatch[]; moves: Move[] };

export type FromWorker =
  | { type: "progress"; loaded: number; total: number }
  | { type: "ready" }
  | { type: "load_failed"; message: string }
  | { type: "photo"; id: number; display: Pixels }
  | { type: "read"; id: number; read: Read }
  | { type: "failed"; id: number; failure: ReadFailure; copy: string | null }
  | { type: "recoloured"; id: number; pixels: Pixels }
  | { type: "plan"; id: number; plan: PhotoPlan };

export type Progress = (loaded: number, total: number) => void;

export interface ReadResult {
  read: Read | null;
  failure: ReadFailure | null;
  copy: string | null;
}

export class Reader {
  private worker: Worker | null = null;
  private next = 1;
  private loading: Promise<void> | null = null;
  private progress = new Set<Progress>();
  private waiting = new Map<number, { onPhoto?: (display: Pixels) => void; resolve: (v: FromWorker) => void }>();

  private ensure(): Worker {
    if (this.worker) return this.worker;
    const w = new ReadWorker();
    w.onmessage = (e: MessageEvent<FromWorker>) => this.receive(e.data);
    // A worker that cannot start or throws is a failed load for whoever is waiting; the next read starts a new one.
    w.onerror = (e: ErrorEvent) => {
      this.receive({ type: "load_failed", message: e.message || "the read worker failed" });
      for (const [id] of this.waiting) this.receive({ type: "failed", id, failure: "models_failed", copy: null });
      w.terminate();
      this.worker = null;
    };
    this.worker = w;
    return w;
  }

  private loadDone: { resolve: () => void; reject: (e: Error) => void } | null = null;

  private receive(msg: FromWorker): void {
    switch (msg.type) {
      case "progress":
        this.progress.forEach((p) => p(msg.loaded, msg.total));
        return;
      case "ready":
        this.loadDone?.resolve();
        this.loadDone = null;
        return;
      case "load_failed":
        this.loadDone?.reject(new Error(msg.message));
        this.loadDone = null;
        this.loading = null;
        return;
      case "photo":
        this.waiting.get(msg.id)?.onPhoto?.(msg.display);
        return;
      case "read":
      case "failed":
      case "recoloured":
      case "plan": {
        const w = this.waiting.get(msg.id);
        this.waiting.delete(msg.id);
        w?.resolve(msg);
      }
    }
  }

  /** Starts the models' one-time download. Safe to call many times; one download. */
  warm(onProgress?: Progress): Promise<void> {
    if (onProgress) this.progress.add(onProgress);
    this.loading ??= new Promise<void>((resolve, reject) => {
      this.loadDone = { resolve, reject };
      this.ensure().postMessage({ type: "load" } satisfies ToWorker);
    }).finally(() => this.progress.clear());
    return this.loading;
  }

  /** True once the models are in memory (so a read starts at once). */
  get warmed(): boolean {
    return this.loading !== null;
  }

  /** Reads a photo: the display pixels arrive first (onPhoto), the reading after. */
  async read(file: Blob, onPhoto?: (display: Pixels) => void): Promise<ReadResult> {
    try {
      await this.warm();
    } catch {
      return { read: null, failure: "models_failed", copy: null };
    }
    const id = this.next++;
    const reply = await new Promise<FromWorker>((resolve) => {
      this.waiting.set(id, { onPhoto, resolve });
      this.ensure().postMessage({ type: "read", id, file } satisfies ToWorker);
    });
    if (reply.type === "read") return { read: reply.read, failure: null, copy: null };
    if (reply.type === "failed") return { read: null, failure: reply.failure, copy: reply.copy };
    return { read: null, failure: "models_failed", copy: null };
  }

  /** A recoloured copy of the display photo, computed off the page's thread. The buffers are copied, so the caller keeps its own. */
  async recolour(pixels: Pixels, mask: Mask, box: Box, bands: Bands, swatches: Swatch[], moves: Move[], avoid: number[] = []): Promise<Pixels> {
    const id = this.next++;
    const reply = await new Promise<FromWorker>((resolve) => {
      this.waiting.set(id, { resolve });
      const data = new Uint8ClampedArray(pixels.data);
      const maskData = new Uint8Array(mask.data);
      this.ensure().postMessage({ type: "recolour", id, pixels: { width: pixels.width, height: pixels.height, data }, mask: { width: mask.width, height: mask.height, data: maskData }, box, bands, swatches, moves, avoid } satisfies ToWorker, [data.buffer, maskData.buffer]);
    });
    if (reply.type !== "recoloured") throw new Error("recolour failed");
    return reply.pixels;
  }

  /** Which of a look's colour moves the photo can show honestly (tryon/recolour.ts photoPlan), judged in the worker at reading size. Any failure refuses them all. */
  async plan(pixels: Pixels, full: Mask, person: Mask, box: Box, bands: Bands, swatches: Swatch[], moves: Move[]): Promise<PhotoPlan> {
    const id = this.next++;
    const reply = await new Promise<FromWorker>((resolve) => {
      this.waiting.set(id, { resolve });
      const copy = (m: Mask): Mask => ({ width: m.width, height: m.height, data: new Uint8Array(m.data) });
      const p: Pixels = { width: pixels.width, height: pixels.height, data: new Uint8ClampedArray(pixels.data) };
      const f = copy(full), o = copy(person);
      this.ensure().postMessage({ type: "plan", id, pixels: p, full: f, person: o, box, bands, swatches, moves } satisfies ToWorker, [p.data.buffer, f.data.buffer, o.data.buffer]);
    });
    return reply.type === "plan" ? reply.plan : refuseAll(moves);
  }
}
