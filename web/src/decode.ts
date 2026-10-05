// Every photo is decoded to pixels by our own code (law 2; founder decision
// 2026-10-05, docs/DECISIONS.md). Browsers decode the same JPEG to
// different pixels: Chromium and Firefox use libjpeg-turbo, Safari Apple's
// ImageIO, and the readings differed. These decoders are WebAssembly builds
// of MozJPEG (libjpeg-turbo, integer IDCT and colour conversion), the Rust
// png crate and libwebp, from pinned npm packages (package-lock.json),
// bundled and served from this origin. They never rotate and never apply a
// colour profile: engine/orient.ts and engine/icc.ts do that, the same way
// everywhere. Each decoder (its glue and its .wasm) loads the first time
// its format is read, in the read worker.

import jpegWasm from "@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm?url";
import pngWasm from "@jsquash/png/codec/pkg/squoosh_png_bg.wasm?url";
import webpWasm from "@jsquash/webp/codec/dec/webp_dec.wasm?url";
import type { Pixels } from "./engine/resample";

export type Format = "jpeg" | "png" | "webp";

/** The format from the file's first bytes, never from its name or type. */
export function sniff(b: Uint8Array): Format | null {
  if (b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff) return "jpeg";
  if (b.length > 8 && b[0] === 0x89 && b[1] === 0x50 && b[2] === 0x4e && b[3] === 0x47) return "png";
  if (b.length > 12 && b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46 && b[8] === 0x57 && b[9] === 0x45 && b[10] === 0x42 && b[11] === 0x50) return "webp";
  return null;
}

const compile = async (url: string) => {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`${url} answered ${res.status}`);
  return WebAssembly.compile(await res.arrayBuffer());
};

/** The decoder itself could not be fetched or started (not a fault in the photo). */
export class DecoderLoadError extends Error {}

type Decoder = (buffer: ArrayBuffer) => Promise<{ width: number; height: number; data: Uint8ClampedArray }>;

async function start(format: Format): Promise<Decoder> {
  if (format === "jpeg") {
    const m = await import("@jsquash/jpeg/decode.js");
    await m.init(await compile(jpegWasm));
    return (b) => m.default(b);
  }
  if (format === "png") {
    const m = await import("@jsquash/png/decode.js");
    await m.init(await compile(pngWasm));
    return (b) => m.decode(b);
  }
  const m = await import("@jsquash/webp/decode.js");
  await m.init(await compile(webpWasm));
  return (b) => m.default(b);
}

const ready: Partial<Record<Format, Promise<Decoder>>> = {};
function load(format: Format): Promise<Decoder> {
  ready[format] ??= start(format).catch((e: unknown) => {
    // Not kept: the next read tries again.
    delete ready[format];
    throw new DecoderLoadError(`the ${format} decoder did not load`, { cause: e });
  });
  return ready[format];
}

/** Decodes a JPEG, PNG or WebP file to RGBA pixels, exactly as stored (no rotation, no colour profile). */
export async function decodePixels(bytes: Uint8Array<ArrayBuffer>): Promise<Pixels> {
  const format = sniff(bytes);
  if (!format) throw new Error("not a JPEG, PNG or WebP file");
  const decoder = await load(format);
  const img = await decoder(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
  if (!img || img.width < 1 || img.height < 1 || img.data.length !== img.width * img.height * 4) throw new Error("the decoder returned no pixels");
  // A copy: the decoder may hand back a view of its own memory.
  return { width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) };
}
