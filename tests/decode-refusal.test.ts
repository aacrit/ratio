// A photo in a format Ratio reads, which its decoder still refuses (a CMYK
// JPEG, an animated WebP), is told what is wrong with it and how to fix it,
// never "not a photo" (review 1 of T5). The same decoders the read worker
// runs refuse these two tiny files here in Node.

import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { beforeAll, describe, expect, it } from "vitest";
import jpegDecode, { init as jpegDecInit } from "@jsquash/jpeg/decode.js";
import webpDecode, { init as webpDecInit } from "@jsquash/webp/decode.js";
import { DecodeRefusedError, DecoderLoadError, ownsBuffer, sniff, whyRefused } from "../web/src/decode";
import { JUDGING_WORDS } from "../web/src/engine/rules";
import { decodeFailure, FAILURE_COPY } from "../web/src/read";

const require = createRequire(import.meta.url);
const wasm = (p: string) => WebAssembly.compile(readFileSync(require.resolve(p)));
const b64 = (s: string) => new Uint8Array(Buffer.from(s, "base64"));
const ab = (u: Uint8Array) => u.buffer.slice(u.byteOffset, u.byteOffset + u.byteLength) as ArrayBuffer;

/** 8x8, CMYK, written by Pillow 11.3 (Adobe APP14, four components). */
const CMYK_JPEG = b64(
  "/9j/7gAOQWRvYmUAZAAAAAAA/9sAQwAQCwwODAoQDg0OEhEQExgoGhgWFhgxIyUdKDozPTw5Mzg3QEhcTkBEV0U3OFBtUVdfYmdoZz5NcXlwZHhcZWdj/8AAFAgACAAIBEMRAE0RAFkRAEsRAP/EAB8AAAEFAQEBAQEBAAAAAAAAAAABAgMEBQYHCAkKC//EALUQAAIBAwMCBAMFBQQEAAABfQECAwAEEQUSITFBBhNRYQcicRQygZGhCCNCscEVUtHwJDNicoIJChYXGBkaJSYnKCkqNDU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6g4SFhoeIiYqSk5SVlpeYmZqio6Slpqeoqaqys7S1tre4ubrCw8TFxsfIycrS09TV1tfY2drh4uPk5ebn6Onq8fLz9PX29/j5+v/aAA4EQwBNAFkASwAAPwDu65quxr0Cv//Z",
);
/** 8x8, RGB (YCbCr), written by Pillow 11.3. */
const RGB_JPEG = b64(
  "/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDABALDA4MChAODQ4SERATGCgaGBYWGDEjJR0oOjM9PDkzODdASFxOQERXRTc4UG1RV19iZ2hnPk1xeXBkeFxlZ2P/2wBDARESEhgVGC8aGi9jQjhCY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2NjY2P/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDMooornPpT/9k=",
);
/** 8x8, two frames, lossless, written by Pillow 11.3. */
const ANIMATED_WEBP = b64(
  "UklGRoQAAABXRUJQVlA4WAoAAAACAAAABwAABwAAQU5JTQYAAAAAAAAAAABBTk1GKAAAAAAAAAAAAAcAAAcAAGQAAAJWUDhMDwAAAC8HwAEABxD9j/4HIqL/AQBBTk1GKAAAAAAAAAAAAAcAAAcAAGQAAABWUDhMDwAAAC8HwAEABxDR//4HIqL/AQA=",
);

beforeAll(async () => {
  await jpegDecInit(await wasm("@jsquash/jpeg/codec/dec/mozjpeg_dec.wasm"));
  await webpDecInit(await wasm("@jsquash/webp/codec/dec/webp_dec.wasm"));
});

describe("the decoders refuse these variants", () => {
  it("MozJPEG refuses a CMYK JPEG, and still decodes the next file", async () => {
    expect(sniff(CMYK_JPEG)).toBe("jpeg");
    await expect(jpegDecode(ab(CMYK_JPEG))).rejects.toBeDefined();
    const next = await jpegDecode(ab(RGB_JPEG));
    expect([next.width, next.height]).toEqual([8, 8]);
  });

  it("libwebp refuses an animated WebP", async () => {
    expect(sniff(ANIMATED_WEBP)).toBe("webp");
    await expect(webpDecode(ab(ANIMATED_WEBP))).rejects.toBeDefined();
  });
});

describe("whyRefused names the variant", () => {
  it("a four-component JPEG is CMYK", () => {
    expect(whyRefused(CMYK_JPEG, "jpeg")).toBe("cmyk_jpeg");
  });
  it("an animated WebP is animated", () => {
    expect(whyRefused(ANIMATED_WEBP, "webp")).toBe("animated_webp");
    // ANIM alone, with the VP8X flag cleared, still reads as animated.
    const noFlag = ANIMATED_WEBP.slice();
    noFlag[20] &= ~0x02;
    expect(whyRefused(noFlag, "webp")).toBe("animated_webp");
  });
  it("anything else is damaged, and a truncated file never throws", () => {
    const rgbHeader = CMYK_JPEG.slice();
    // The frame header's component count set to 3.
    const sof = rgbHeader.findIndex((v, i) => v === 0xff && rgbHeader[i + 1] === 0xc0);
    rgbHeader[sof + 9] = 3;
    expect(whyRefused(rgbHeader, "jpeg")).toBe("damaged");
    for (const cut of [2, 10, 50, sof + 5]) expect(whyRefused(CMYK_JPEG.subarray(0, cut), "jpeg")).toBe("damaged");
    expect(whyRefused(ANIMATED_WEBP.subarray(0, 14), "webp")).toBe("damaged");
    expect(whyRefused(Uint8Array.from([0x89, 0x50, 0x4e, 0x47]), "png")).toBe("damaged");
  });
});

describe("each is shown as its own failure, in the brand voice", () => {
  it("maps decode errors to failures", () => {
    expect(decodeFailure(new DecodeRefusedError("cmyk_jpeg"))).toBe("cmyk_jpeg");
    expect(decodeFailure(new DecodeRefusedError("animated_webp"))).toBe("animated_webp");
    expect(decodeFailure(new DecodeRefusedError("damaged"))).toBe("damaged_photo");
    expect(decodeFailure(new Error("not a JPEG, PNG or WebP file"))).toBe("not_an_image");
    const quiet = console.error;
    console.error = () => {};
    try {
      expect(decodeFailure(new DecoderLoadError("x"))).toBe("models_failed");
    } finally {
      console.error = quiet;
    }
  });

  it("says what to do, with no exclamation mark, em dash or judging word", () => {
    expect(FAILURE_COPY.cmyk_jpeg).toBe("This JPEG uses CMYK colour; save it as RGB and try again.");
    for (const key of ["cmyk_jpeg", "animated_webp", "damaged_photo", "not_an_image"] as const) {
      const text = FAILURE_COPY[key];
      expect(text).not.toMatch(/[!—]/);
      for (const word of JUDGING_WORDS) expect(text.toLowerCase(), text).not.toContain(word);
    }
    expect(new Set(Object.values(FAILURE_COPY)).size).toBe(Object.keys(FAILURE_COPY).length);
  });
});

describe("ownsBuffer: decoded pixels are copied only when they alias other memory", () => {
  it("is true for a view over a whole buffer, false for a window into a larger one", () => {
    expect(ownsBuffer(new Uint8ClampedArray(16))).toBe(true);
    const memory = new Uint8ClampedArray(64);
    expect(ownsBuffer(memory.subarray(8, 24))).toBe(false);
    expect(ownsBuffer(memory.subarray(0, 16))).toBe(false);
  });
});
