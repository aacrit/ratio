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

/** Why a decoder refused a file in a format it knows: the variants a visitor can fix are named. */
export type DecodeRefusal = "cmyk_jpeg" | "animated_webp" | "damaged";

/** A JPEG, PNG or WebP file its decoder would not turn into pixels. */
export class DecodeRefusedError extends Error {
  constructor(
    readonly reason: DecodeRefusal,
    options?: { cause?: unknown },
  ) {
    super(`the decoder refused the file (${reason})`, options);
  }
}

/** True when the view covers the whole of its own buffer, so nothing else (no decoder's memory, no other file) lives in it. */
export const ownsBuffer = (a: ArrayBufferView): boolean => a.byteOffset === 0 && a.buffer.byteLength === a.byteLength;

/**
 * Names the variant of a recognised format that its decoder refuses: a JPEG
 * whose frame has four components (CMYK or YCCK, which MozJPEG cannot turn
 * into RGB) or an animated WebP (libwebp's still decoder refuses it).
 * Anything else is "damaged".
 */
export function whyRefused(b: Uint8Array, format: Format): DecodeRefusal {
  if (format === "jpeg") {
    let at = 2;
    while (at + 4 <= b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      if (marker === 0xda || marker === 0xd9) break;
      const len = (b[at + 2] << 8) | b[at + 3];
      if (len < 2) break;
      // SOF0..SOF15, less DHT (C4), JPG (C8) and DAC (CC): the frame header, whose 8th byte is the component count.
      if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8 && marker !== 0xcc) {
        return at + 9 < b.length && b[at + 9] === 4 ? "cmyk_jpeg" : "damaged";
      }
      at += 2 + len;
    }
    return "damaged";
  }
  if (format === "webp") {
    // VP8X's animation flag, or an ANIM chunk anywhere in the file.
    if (b.length > 20 && String.fromCharCode(b[12], b[13], b[14], b[15]) === "VP8X" && b[20] & 0x02) return "animated_webp";
    let at = 12;
    while (at + 8 <= b.length) {
      if (String.fromCharCode(b[at], b[at + 1], b[at + 2], b[at + 3]) === "ANIM") return "animated_webp";
      const len = b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16) | (b[at + 7] << 24);
      if (len < 0) break;
      at += 8 + len + (len & 1);
    }
  }
  return "damaged";
}

/** Decodes a JPEG, PNG or WebP file to RGBA pixels, exactly as stored (no rotation, no colour profile). */
export async function decodePixels(bytes: Uint8Array<ArrayBuffer>): Promise<Pixels> {
  const format = sniff(bytes);
  if (!format) throw new Error("not a JPEG, PNG or WebP file");
  const decoder = await load(format);
  // The file's own buffer when the view is all of it (a File's arrayBuffer() always is): no second copy of the file.
  const input = ownsBuffer(bytes) ? bytes.buffer : bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  let img: Awaited<ReturnType<Decoder>> | null;
  try {
    img = await decoder(input);
  } catch (e) {
    throw new DecodeRefusedError(whyRefused(bytes, format), { cause: e });
  }
  if (!img || img.width < 1 || img.height < 1 || img.data.length !== img.width * img.height * 4) throw new DecodeRefusedError(whyRefused(bytes, format));
  // The decoders hand back pixels in a buffer of their own (MozJPEG, libwebp
  // and the png crate's glue all copy out of WebAssembly memory), so they
  // are kept as they are; a view into a larger buffer (a decoder's memory)
  // is copied, so the pixels never alias it.
  return { width: img.width, height: img.height, data: ownsBuffer(img.data) ? img.data : new Uint8ClampedArray(img.data) };
}
