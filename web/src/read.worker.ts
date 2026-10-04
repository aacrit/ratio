// The read worker: the models, the measuring and the rulebook run here, off
// the page's thread, so the stage and the sheet never drop a frame while a
// photo is read. The page sends a photo file in and gets the reading back;
// pixel buffers cross as transfers, never copies. "Try it" recolours here
// too (tryon/recolour.ts is pure arithmetic over a million pixels).
//
// A module worker (web/vite.config.ts, worker.format "es"), so MediaPipe
// imports its module runtime (vision.ts). Nothing here touches the DOM.

import type { Pixels } from "./engine/resample";
import { FAILURE_COPY, type Read, readPhoto } from "./read";
import { honesty, recolour } from "./tryon/recolour";
import { loadModels } from "./vision";
import type { FromWorker, ToWorker } from "./reader";

const post = (message: FromWorker, transfer: Transferable[] = []) => self.postMessage(message, { transfer });

/** The share of a Read that can be posted (typed arrays go as transfers). */
function pack(read: Read): { read: Read; transfer: Transferable[] } {
  // A buffer may be listed once only (the person's mask can be the photo's own when alone).
  return { read, transfer: [...new Set([read.pixels.data.buffer, read.display.data.buffer, read.mask.data.buffer, read.fullMask.data.buffer])] };
}

self.onmessage = async (event: MessageEvent<ToWorker>) => {
  const msg = event.data;
  switch (msg.type) {
    case "load":
      loadModels((loaded, total) => post({ type: "progress", loaded, total })).then(
        () => post({ type: "ready" }),
        (err: unknown) => post({ type: "load_failed", message: err instanceof Error ? err.message : String(err) }),
      );
      return;
    case "read": {
      const result = await readPhoto(msg.file, {
        onPhoto: (display: Pixels) => {
          // The stage shows the photo while the models work: a copy, so the read keeps its own.
          const copy: Pixels = { width: display.width, height: display.height, data: new Uint8ClampedArray(display.data) };
          post({ type: "photo", id: msg.id, display: copy }, [copy.data.buffer]);
        },
      });
      if (typeof result === "string") post({ type: "failed", id: msg.id, failure: result, copy: FAILURE_COPY[result] });
      else {
        const { read, transfer } = pack(result);
        post({ type: "read", id: msg.id, read }, transfer);
      }
      return;
    }
    case "recolour": {
      const out = recolour(msg.pixels, msg.mask, msg.box, msg.bands, msg.swatches, msg.moves);
      post({ type: "recoloured", id: msg.id, pixels: out }, [out.data.buffer]);
      return;
    }
    case "honesty":
      post({ type: "honesty", id: msg.id, honesty: honesty(msg.pixels, msg.full, msg.person, msg.box, msg.bands, msg.swatches, msg.moves) });
      return;
  }
};
