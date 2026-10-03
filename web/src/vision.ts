// The measuring models, loaded from this origin (/mp, staged by
// scripts/fetch-models.mjs) and run on the processor in this tab. The photo
// is never sent anywhere. The CPU delegate is on purpose: one numeric path,
// so a photo reads the same on every device (the determinism risk in the
// brief); a graphics chip would be faster and less repeatable.
//
// The files are fetched here, not by MediaPipe, so the page can show the
// real download in MB (design/BRAND.md: waiting shows its work). The models
// go to MediaPipe as buffers; the runtime's .wasm is fetched first so
// MediaPipe's own request for it is answered from the browser cache.

import { FilesetResolver, ImageSegmenter, PoseLandmarker } from "@mediapipe/tasks-vision";
import type { Landmark, Mask } from "./engine/measure";
import type { Pixels } from "./engine/resample";

export interface Seen {
  pose: Landmark[];
  mask: Mask;
}

export type Progress = (loaded: number, total: number) => void;

const FILES = ["/mp/wasm/vision_wasm_internal.wasm", "/mp/pose_landmarker_lite.task", "/mp/selfie_multiclass_256x256.tflite"] as const;

type Models = { pose: PoseLandmarker; seg: ImageSegmenter };
let models: Promise<Models> | null = null;
const listeners = new Set<Progress>();

/** Fetches every file, reporting the bytes loaded across all of them. */
async function fetchAll(): Promise<Uint8Array[]> {
  const responses = await Promise.all(
    FILES.map(async (f) => {
      const res = await fetch(f);
      if (!res.ok || !res.body) throw new Error(`${f} answered ${res.status}`);
      return res;
    }),
  );
  const total = responses.reduce((sum, r) => sum + Number(r.headers.get("content-length") ?? 0), 0);
  let loaded = 0;
  const report = () => listeners.forEach((l) => l(loaded, total));
  report();
  return Promise.all(
    responses.map(async (res) => {
      const reader = res.body!.getReader();
      const parts: Uint8Array[] = [];
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        parts.push(value);
        loaded += value.byteLength;
        report();
      }
      const out = new Uint8Array(parts.reduce((n, p) => n + p.byteLength, 0));
      let at = 0;
      for (const p of parts) {
        out.set(p, at);
        at += p.byteLength;
      }
      return out;
    }),
  );
}

/** Loads the runtime and both models once; later calls share the same promise. */
export function loadModels(onProgress?: Progress): Promise<Models> {
  if (onProgress) listeners.add(onProgress);
  models ??= (async () => {
    const [, poseModel, segModel] = await fetchAll();
    const fileset = await FilesetResolver.forVisionTasks("/mp/wasm");
    const [pose, seg] = await Promise.all([
      PoseLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: poseModel, delegate: "CPU" },
        runningMode: "IMAGE",
        numPoses: 1,
      }),
      ImageSegmenter.createFromOptions(fileset, {
        baseOptions: { modelAssetBuffer: segModel, delegate: "CPU" },
        runningMode: "IMAGE",
        outputCategoryMask: true,
        outputConfidenceMasks: false,
      }),
    ]);
    return { pose, seg };
  })();
  models.then(
    () => listeners.clear(),
    () => {
      listeners.clear();
      models = null;
    },
  );
  return models;
}

/** Runs both models on the photo, already reduced to its reading size. */
export async function see(pixels: Pixels): Promise<Seen> {
  const { pose, seg } = await loadModels();
  const image = new ImageData(new Uint8ClampedArray(pixels.data), pixels.width, pixels.height);
  const posed = pose.detect(image);
  const segmented = seg.segment(image);
  try {
    const cat = segmented.categoryMask;
    if (!cat) throw new Error("the segmenter returned no mask");
    const mask: Mask = { width: cat.width, height: cat.height, data: new Uint8Array(cat.getAsUint8Array()) };
    const first = posed.landmarks[0] ?? [];
    return { pose: first.map((l) => ({ x: l.x, y: l.y, visibility: l.visibility })), mask };
  } finally {
    segmented.close();
  }
}

/** Decodes a photo file upright (EXIF orientation applied) into full-size pixels. */
export async function decode(file: Blob): Promise<Pixels> {
  const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
  try {
    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("this browser cannot read the photo's pixels");
    ctx.drawImage(bitmap, 0, 0);
    const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height, { colorSpace: "srgb" });
    return { width: img.width, height: img.height, data: img.data };
  } finally {
    bitmap.close();
  }
}
