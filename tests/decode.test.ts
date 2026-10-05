// Law 2 (CLAUDE.md), R3 (docs/RISKS.md): every photo is decoded by our own
// code (web/src/decode.ts), stood upright by our own code
// (web/src/engine/orient.ts), never by the browser. These run the same
// WebAssembly decoders the read worker runs, here in Node.

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import jpegDecode, { init as jpegDecInit } from "@jsquash/jpeg/decode.js";
import jpegEncode, { init as jpegEncInit } from "@jsquash/jpeg/encode.js";
import { decode as pngDecode, init as pngDecInit } from "@jsquash/png/decode.js";
import pngEncode, { init as pngEncInit } from "@jsquash/png/encode.js";
import webpDecode, { init as webpDecInit } from "@jsquash/webp/decode.js";
import webpEncFactory from "@jsquash/webp/codec/enc/webp_enc.js";
import { sniff } from "../web/src/decode";
import { orient, readOrientation, tiffOrientation } from "../web/src/engine/orient";

const require = createRequire(import.meta.url);
const wasm = (p: string) => WebAssembly.compile(readFileSync(require.resolve(p)));

/** A 16x8 test card: a horizontal ramp in red, a vertical one in green, a block of blue. */
function card(w = 16, h = 8) {
  const data = new Uint8ClampedArray(w * h * 4);
  for (let y = 0; y < h; y++)
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * 4;
      data[i] = Math.round((x * 255) / (w - 1));
      data[i + 1] = Math.round((y * 255) / (h - 1));
      data[i + 2] = x < w / 2 && y < h / 2 ? 255 : 0;
      data[i + 3] = 255;
    }
  return { width: w, height: h, data, colorSpace: "srgb" as const };
}
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;
const sha = (d: Uint8Array | Uint8ClampedArray) => createHash("sha256").update(d).digest("hex").slice(0, 16);

/** A TIFF block holding only an Orientation tag. */
function tiff(o: number, le = true) {
  const w16 = (n: number) => (le ? [n & 0xff, n >> 8] : [n >> 8, n & 0xff]);
  const w32 = (n: number) => (le ? [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24] : [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff]);
  return Uint8Array.from([...(le ? [0x49, 0x49] : [0x4d, 0x4d]), ...w16(42), ...w32(8), ...w16(1), ...w16(0x0112), ...w16(3), ...w32(1), ...w16(o), 0, 0, ...w32(0)]);
}
/** Inserts an APP1 Exif segment right after SOI. */
function withExif(jpeg: Uint8Array, o: number, le = true) {
  const body = Uint8Array.from([..."Exif\0\0"].map((c) => c.charCodeAt(0)).concat([...tiff(o, le)]));
  const seg = Uint8Array.from([0xff, 0xe1, (body.length + 2) >> 8, (body.length + 2) & 0xff, ...body]);
  return Uint8Array.from([...jpeg.subarray(0, 2), ...seg, ...jpeg.subarray(2)]);
}

let jpeg: Uint8Array;
beforeAll(async () => {
  await jpegDecInit(await wasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"));
  await jpegEncInit(await wasm("@jsquash/jpeg/codec/enc/mozjpeg_enc.wasm"));
  await pngDecInit(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
  await pngEncInit(await wasm("@jsquash/png/codec/pkg/squoosh_png_bg.wasm"));
  await webpDecInit(await wasm("@jsquash/webp/codec/dec/webp_dec.wasm"));
  jpeg = new Uint8Array(await jpegEncode(card() as unknown as ImageData, { quality: 90, baseline: true, progressive: false }));
});

describe("sniff: the format from the bytes, never the name", () => {
  it("knows JPEG, PNG and WebP and nothing else", () => {
    expect(sniff(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe("jpeg");
    expect(sniff(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0]))).toBe("png");
    expect(sniff(Uint8Array.from([..."RIFF\0\0\0\0WEBPVP8 "].map((c) => c.charCodeAt(0))))).toBe("webp");
    for (const b of ["GIF89a.......", "\0\0\0\x18ftypheic....", ""]) expect(sniff(Uint8Array.from([...b].map((c) => c.charCodeAt(0))))).toBeNull();
  });
});

describe("the JPEG decoder (MozJPEG, integer IDCT)", () => {
  it("is exact: the same file gives these pixels (pinned)", async () => {
    const img = await jpegDecode(ab(jpeg));
    expect([img.width, img.height]).toEqual([16, 8]);
    expect(sha(img.data)).toMatchInlineSnapshot(`"f011b0d12e9d5a74"`);
  });

  it("never rotates: an orientation-6 file decodes as stored, and orient() stands it up", async () => {
    const tagged = withExif(jpeg, 6);
    expect(readOrientation(tagged)).toBe(6);
    const img = await jpegDecode(ab(tagged));
    expect([img.width, img.height]).toEqual([16, 8]);
    const plain = await jpegDecode(ab(jpeg));
    expect(sha(img.data)).toBe(sha(plain.data));
    const up = orient({ width: img.width, height: img.height, data: new Uint8ClampedArray(img.data) }, 6);
    expect([up.width, up.height]).toEqual([8, 16]);
  });
});

describe("the PNG and WebP decoders are lossless where the file is", () => {
  it("PNG round-trips exactly", async () => {
    const c = card();
    const png = new Uint8Array(await pngEncode(c as unknown as ImageData));
    expect(sniff(png)).toBe("png");
    const img = await pngDecode(ab(png));
    expect([...img.data]).toEqual([...c.data]);
  });

  it("lossless WebP round-trips exactly", async () => {
    const enc = await webpEncFactory({ noInitialRun: true, wasmBinary: readFileSync(require.resolve("@jsquash/webp/codec/enc/webp_enc.wasm")) });
    const c = card();
    const out = enc.encode(c.data, c.width, c.height, { ...(await import("@jsquash/webp/meta.js")).defaultOptions, lossless: 1, exact: 1 });
    const webp = new Uint8Array(out.buffer);
    expect(sniff(webp)).toBe("webp");
    const img = await webpDecode(ab(webp));
    expect([...img.data]).toEqual([...c.data]);
  });
});

describe("EXIF orientation", () => {
  // A 3x2 image whose pixels are numbered 0..5, row-major.
  const src = () => {
    const data = new Uint8ClampedArray(6 * 4);
    for (let i = 0; i < 6; i++) data.set([i, 0, 0, 255], i * 4);
    return { width: 3, height: 2, data };
  };
  const ids = (p: { width: number; height: number; data: Uint8ClampedArray }) => [p.width, p.height, ...Array.from({ length: p.width * p.height }, (_, i) => p.data[i * 4])];

  it("applies all eight as the EXIF specification draws them", () => {
    // 0 1 2
    // 3 4 5
    expect(ids(orient(src(), 1))).toEqual([3, 2, 0, 1, 2, 3, 4, 5]);
    expect(ids(orient(src(), 2))).toEqual([3, 2, 2, 1, 0, 5, 4, 3]);
    expect(ids(orient(src(), 3))).toEqual([3, 2, 5, 4, 3, 2, 1, 0]);
    expect(ids(orient(src(), 4))).toEqual([3, 2, 3, 4, 5, 0, 1, 2]);
    expect(ids(orient(src(), 5))).toEqual([2, 3, 0, 3, 1, 4, 2, 5]);
    expect(ids(orient(src(), 6))).toEqual([2, 3, 3, 0, 4, 1, 5, 2]);
    expect(ids(orient(src(), 7))).toEqual([2, 3, 5, 2, 4, 1, 3, 0]);
    expect(ids(orient(src(), 8))).toEqual([2, 3, 2, 5, 1, 4, 0, 3]);
  });

  it("reads the tag from JPEG (both byte orders), PNG eXIf and WebP EXIF", () => {
    expect(readOrientation(withExif(jpeg, 8, false))).toBe(8);
    expect(readOrientation(withExif(jpeg, 3, true))).toBe(3);
    const t = tiff(5);
    const be32 = (n: number) => [n >>> 24, (n >> 16) & 0xff, (n >> 8) & 0xff, n & 0xff];
    const png = Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, ...be32(t.length), ...[..."eXIf"].map((c) => c.charCodeAt(0)), ...t, 0, 0, 0, 0]);
    expect(readOrientation(png)).toBe(5);
    const le32 = (n: number) => [n & 0xff, (n >> 8) & 0xff, (n >> 16) & 0xff, n >>> 24];
    const chunk = [..."EXIF"].map((c) => c.charCodeAt(0)).concat(le32(t.length), [...t], t.length & 1 ? [0] : []);
    const webp = Uint8Array.from([..."RIFF"].map((c) => c.charCodeAt(0)).concat(le32(4 + chunk.length), [..."WEBP"].map((c) => c.charCodeAt(0)), chunk));
    expect(readOrientation(webp)).toBe(5);
  });

  it("is 1 for no tag, an out-of-range value, or garbage, and never throws", () => {
    expect(readOrientation(jpeg)).toBe(1);
    expect(tiffOrientation(tiff(9))).toBe(1);
    expect(tiffOrientation(Uint8Array.from([0x49, 0x49, 42, 0, 0xff, 0xff, 0xff, 0x7f]))).toBe(1);
    expect(readOrientation(Uint8Array.from([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]))).toBe(1);
    expect(readOrientation(new Uint8Array(0))).toBe(1);
  });
});
