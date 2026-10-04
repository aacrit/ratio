#!/usr/bin/env node
// Stages the measuring models into web/public/ so the page never fetches
// them from another origin (V3: the photo, and everything that reads it,
// stays on this origin and in the tab).
//
// - MediaPipe Tasks models (Apache 2.0), from Google's model bucket at a
//   pinned version path, downloaded once into .cache/ and checked against
//   SHA-256 pins. Each is under Workers Static Assets' 25 MiB file limit.
// - The MediaPipe vision WASM runtime, from the @mediapipe/tasks-vision
//   package (pinned exactly in package.json and here by hash).
//
// None of these are tracked in git (rule 8): web/public/mp is gitignored,
// and this runs before every build and dev server.

import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const cacheDir = path.join(repoRoot, ".cache", "models");
const outDir = path.join(repoRoot, "web", "public", "mp");
const samplesDir = path.join(repoRoot, "web", "public", "samples");

const BUCKET = "https://storage.googleapis.com/mediapipe-models";

// Served path (under /mp/) → source path in the bucket and its SHA-256.
export const MODELS = {
  "pose_landmarker_lite.task": {
    src: "pose_landmarker/pose_landmarker_lite/float16/1/pose_landmarker_lite.task",
    sha256: "59929e1d1ee95287735ddd833b19cf4ac46d29bc7afddbbf6753c459690d574a",
  },
  "selfie_multiclass_256x256.tflite": {
    src: "image_segmenter/selfie_multiclass_256x256/float32/1/selfie_multiclass_256x256.tflite",
    sha256: "c6748b1253a99067ef71f7e26ca71096cd449baefa8f101900ea23016507e0e0",
  },
};

// Only the SIMD module build: every browser Ratio supports has WASM SIMD,
// and one runtime means one numeric path (the determinism risk in the
// brief). The module build is the one a module worker can import
// (web/src/vision.ts runs the models in web/src/read.worker.ts).
export const RUNTIME = {
  "vision_wasm_module_internal.js": "da8934057f147b622e82cfb4c0dbd85461c598e268588b5a8ba9ca963a8ff82d",
  "vision_wasm_module_internal.wasm": "2dabd8e23c60984628beb7bb338764c81a08e6837145273f59578684b5d53c1b",
};

// The first-visit sample (founder, 2026-10-04: a painted full-length
// portrait, an adult, public domain). Jacques-Louis David, The Emperor
// Napoleon in His Study at the Tuileries (1812), National Gallery of Art,
// Washington; public domain, via Wikimedia Commons (Web Gallery of Art copy).
// Staged like the models: pinned, never in git, served from this origin.
export const SAMPLES = {
  "napoleon.jpg": {
    url: "https://upload.wikimedia.org/wikipedia/commons/e/ed/Jacques-Louis_David_-_Napoleon_in_his_Study_-_WGA6093.jpg",
    sha256: "2443631a3bd6ba673be324419f7b5ccee52f62cdb4d85679c6454a3f92c44c18",
  },
};

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

/** Throws unless buf matches its SHA-256 pin. */
export function checkPin(file, buf, expected) {
  const got = sha256(buf);
  if (got !== expected) throw new Error(`fetch-models: ${file} sha256 ${got}, pinned ${expected}`);
  return buf;
}

async function cached(name, { src, url: direct, sha256: pin }) {
  const target = path.join(cacheDir, name);
  if (existsSync(target) && sha256(readFileSync(target)) === pin) return readFileSync(target);
  const url = direct ?? `${BUCKET}/${src}`;
  console.log(`fetch-models: downloading ${name}`);
  // Wikimedia asks every client to name itself.
  const res = await fetch(url, { headers: { "user-agent": "ratio-build/1 (+https://ratio.voidvision.org)" } });
  if (!res.ok) throw new Error(`fetch-models: ${url} answered ${res.status}`);
  const buf = checkPin(name, Buffer.from(await res.arrayBuffer()), pin);
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(target, buf);
  return buf;
}

/** Stages the runtime and the models. Pins are checked before anything on disk changes. */
export async function stage() {
  const wasmDir = path.join(repoRoot, "node_modules", "@mediapipe", "tasks-vision", "wasm");
  if (!existsSync(wasmDir)) throw new Error("fetch-models: @mediapipe/tasks-vision is not installed (npm ci)");
  const runtime = Object.entries(RUNTIME).map(([f, pin]) => [f, checkPin(f, readFileSync(path.join(wasmDir, f)), pin)]);
  const models = [];
  for (const [name, spec] of Object.entries(MODELS)) models.push([name, await cached(name, spec)]);
  const samples = [];
  for (const [name, spec] of Object.entries(SAMPLES)) samples.push([name, await cached(name, spec)]);

  rmSync(outDir, { recursive: true, force: true });
  mkdirSync(path.join(outDir, "wasm"), { recursive: true });
  for (const [f, buf] of runtime) writeFileSync(path.join(outDir, "wasm", f), buf);
  for (const [f, buf] of models) writeFileSync(path.join(outDir, f), buf);
  rmSync(samplesDir, { recursive: true, force: true });
  mkdirSync(samplesDir, { recursive: true });
  for (const [f, buf] of samples) writeFileSync(path.join(samplesDir, f), buf);
  console.log(`fetch-models: staged ${models.length} models and the vision runtime in web/public/mp`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  stage().catch((err) => {
    console.error(err.message ?? err);
    process.exit(1);
  });
}
