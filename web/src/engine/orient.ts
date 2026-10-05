// A photo's EXIF orientation, read and applied by us (law 2): the decoders
// in web/src/decode.ts never rotate, and the browser is never asked to, so
// a phone photo stands upright the same way in every engine.

import type { Pixels } from "./resample";

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));

/** The Orientation tag (0x0112) from a TIFF block (EXIF's body); 1 when absent or unreadable. */
export function tiffOrientation(t: Uint8Array): number {
  if (t.length < 8) return 1;
  const order = ascii(t, 0, 2);
  if (order !== "II" && order !== "MM") return 1;
  const le = order === "II";
  const u16 = (at: number) => (le ? t[at] | (t[at + 1] << 8) : (t[at] << 8) | t[at + 1]);
  const u32 = (at: number) => (le ? (t[at] | (t[at + 1] << 8) | (t[at + 2] << 16)) + t[at + 3] * 0x1000000 : t[at] * 0x1000000 + ((t[at + 1] << 16) | (t[at + 2] << 8) | t[at + 3]));
  if (u16(2) !== 42) return 1;
  const ifd = u32(4);
  if (ifd + 2 > t.length) return 1;
  const count = u16(ifd);
  for (let i = 0; i < count; i++) {
    const e = ifd + 2 + i * 12;
    if (e + 12 > t.length) return 1;
    // Tag 0x0112, type SHORT (3), one value, held in the entry itself.
    if (u16(e) === 0x0112 && u16(e + 2) === 3) {
      const v = u16(e + 8);
      return v >= 1 && v <= 8 ? v : 1;
    }
  }
  return 1;
}

/** The EXIF orientation of a JPEG, PNG (eXIf) or WebP (EXIF chunk) file; 1 when there is none. */
export function readOrientation(b: Uint8Array): number {
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 4 <= b.length && b[at] === 0xff) {
      const marker = b[at + 1];
      if (marker === 0xda || marker === 0xd9) break;
      if (marker === 0xff) {
        at += 1;
        continue;
      }
      const len = (b[at + 2] << 8) | b[at + 3];
      if (len < 2 || at + 2 + len > b.length) break;
      if (marker === 0xe1 && len >= 8 && ascii(b, at + 4, 6) === "Exif\0\0") return tiffOrientation(b.subarray(at + 10, at + 2 + len));
      at += 2 + len;
    }
    return 1;
  }
  if (b.length > 8 && b[0] === 0x89 && ascii(b, 1, 3) === "PNG") {
    let at = 8;
    while (at + 12 <= b.length) {
      const len = b[at] * 0x1000000 + ((b[at + 1] << 16) | (b[at + 2] << 8) | b[at + 3]);
      const type = ascii(b, at + 4, 4);
      if (at + 12 + len > b.length) break;
      if (type === "eXIf") return tiffOrientation(b.subarray(at + 8, at + 8 + len));
      if (type === "IDAT" || type === "IEND") break;
      at += 12 + len;
    }
    return 1;
  }
  if (b.length > 12 && ascii(b, 0, 4) === "RIFF" && ascii(b, 8, 4) === "WEBP") {
    let at = 12;
    while (at + 8 <= b.length) {
      const len = (b[at + 4] | (b[at + 5] << 8) | (b[at + 6] << 16)) + b[at + 7] * 0x1000000;
      if (at + 8 + len > b.length) break;
      if (ascii(b, at, 4) === "EXIF") {
        const body = b.subarray(at + 8, at + 8 + len);
        return tiffOrientation(ascii(body, 0, 6) === "Exif\0\0" ? body.subarray(6) : body);
      }
      at += 8 + len + (len & 1);
    }
  }
  return 1;
}

/** Applies an EXIF orientation (1 to 8): the pixels as the camera meant them to stand. */
export function orient(src: Pixels, orientation: number): Pixels {
  if (orientation < 2 || orientation > 8) return src;
  const w = src.width;
  const h = src.height;
  const swap = orientation >= 5;
  const W = swap ? h : w;
  const H = swap ? w : h;
  const out = new Uint8ClampedArray(W * H * 4);
  // Whole pixels are moved as 32-bit words (byte order is irrelevant: a copy).
  const data = src.data.byteOffset % 4 ? new Uint8ClampedArray(src.data) : src.data;
  const s = new Uint32Array(data.buffer, data.byteOffset, w * h);
  const o = new Uint32Array(out.buffer);
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let sx: number;
      let sy: number;
      switch (orientation) {
        case 2: sx = w - 1 - x; sy = y; break;
        case 3: sx = w - 1 - x; sy = h - 1 - y; break;
        case 4: sx = x; sy = h - 1 - y; break;
        case 5: sx = y; sy = x; break;
        case 6: sx = y; sy = h - 1 - x; break;
        case 7: sx = w - 1 - y; sy = h - 1 - x; break;
        default: sx = w - 1 - y; sy = x;
      }
      o[y * W + x] = s[sy * w + sx];
    }
  }
  return { width: W, height: H, data: out };
}
