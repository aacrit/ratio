// A photo's colour profile, applied by us instead of by the browser.
//
// Browsers disagree about embedded colour profiles (law 2, docs/RISKS.md R3):
// Chromium converts a tagged JPEG to sRGB, Firefox hands a canvas the raw
// values, and WebKit converts with its own arithmetic and ignores
// `colorSpaceConversion: "none"`. Measured on the p1 fixture (an Adobe-RGB
// tagged JPEG), the three engines produced three different pixel buffers,
// and Firefox's reading differed from Chromium's in 20 bins. Every iPhone
// photo is tagged (Display P3), so this is not a test artefact.
//
// So the browser never decodes a photo (web/src/decode.ts does, and its
// decoders ignore profiles), and this file reads the profile out of the
// file and converts the decoded pixels to sRGB itself: an RGB matrix/curve
// profile or a grey curve, on integer lookup tables. No engine's own maths
// library is used: the profile's curves are evaluated with engine/detmath.ts
// (+ - * / only, the same bits everywhere), the sRGB encode table is a
// pinned constant (tests/colour-profile.test.ts holds its hash), and after
// the tables everything is integer. A profile this file cannot apply (a
// LUT-only or CMYK profile) is dropped, and the pixels are read as sRGB:
// the same answer in every engine, if not a perfect colour.

import { detPow } from "./detmath";
import type { Pixels } from "./resample";

/** Bytes over a plain ArrayBuffer (what a Blob accepts). */
type Bytes = Uint8Array<ArrayBuffer>;

export interface ColourProfile {
  /** The embedded ICC profile's bytes: a view into the file, copied only when a JPEG splits it across segments. */
  icc: Bytes;
  /** True when `icc` is zlib-deflated (PNG iCCP) and must be inflated first. */
  deflated: boolean;
}

const ascii = (b: Uint8Array, at: number, n: number) => String.fromCharCode(...b.subarray(at, at + n));
const u16 = (b: Uint8Array, at: number) => (b[at] << 8) | b[at + 1];
const u32 = (b: Uint8Array, at: number) => ((b[at] << 24) >>> 0) + (b[at + 1] << 16) + (b[at + 2] << 8) + b[at + 3];
const u32le = (b: Uint8Array, at: number) => (b[at] | (b[at + 1] << 8) | (b[at + 2] << 16)) + b[at + 3] * 0x1000000;
const s15f16 = (b: Uint8Array, at: number) => (u32(b, at) | 0) / 65536;

function concat(parts: Bytes[]): Bytes {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0;
  for (const p of parts) {
    out.set(p, at);
    at += p.length;
  }
  return out;
}

/** JPEG: every APP2 "ICC_PROFILE" segment's chunk, joined in sequence order. */
function jpegProfile(b: Bytes): ColourProfile | null {
  const chunks: { seq: number; data: Bytes }[] = [];
  let at = 2;
  for (;;) {
    if (at + 4 > b.length || b[at] !== 0xff) return null;
    const marker = b[at + 1];
    if (marker === 0xff) {
      // Fill byte before a marker.
      at += 1;
      continue;
    }
    // Start of scan (or end of image): no header segment follows.
    if (marker === 0xda || marker === 0xd9) break;
    const len = u16(b, at + 2);
    if (len < 2 || at + 2 + len > b.length) return null;
    const seg = b.subarray(at, at + 2 + len);
    if (marker === 0xe2 && len >= 16 && ascii(seg, 4, 12) === "ICC_PROFILE\0") chunks.push({ seq: seg[16], data: seg.subarray(18) });
    at += 2 + len;
  }
  if (!chunks.length) return null;
  if (chunks.length === 1) return { icc: chunks[0].data, deflated: false };
  chunks.sort((x, y) => x.seq - y.seq);
  return { icc: concat(chunks.map((c) => c.data)), deflated: false };
}

/** PNG: iCCP's (deflated) profile, which must come before the image data. */
function pngProfile(b: Bytes): ColourProfile | null {
  let at = 8;
  while (at < b.length) {
    if (at + 12 > b.length) return null;
    const len = u32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    if (end > b.length) return null;
    if (type === "iCCP") {
      const data = b.subarray(at + 8, at + 8 + len);
      const nul = data.indexOf(0);
      // name, NUL, compression method (0 = zlib), then the profile.
      return nul > 0 && nul + 2 <= data.length && data[nul + 1] === 0 ? { icc: data.subarray(nul + 2), deflated: true } : null;
    }
    if (type === "IDAT" || type === "IEND") return null;
    at = end;
  }
  return null;
}

/** WebP: the ICCP chunk. */
function webpProfile(b: Bytes): ColourProfile | null {
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) return null;
    const fourcc = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    if (at + 8 + len > b.length) return null;
    if (fourcc === "ICCP") return { icc: b.subarray(at + 8, at + 8 + len), deflated: false };
    at += 8 + len + (len & 1);
  }
  return null;
}

/**
 * The colour profile embedded in a JPEG, PNG or WebP file, read without
 * copying the file. Null for no profile, any other format, or a file it
 * cannot walk.
 */
export function extractColourProfile(bytes: Bytes): ColourProfile | null {
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return jpegProfile(bytes);
  if (bytes.length > 8 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89) return pngProfile(bytes);
  if (bytes.length > 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return webpProfile(bytes);
  return null;
}

export type Curve = { kind: "gamma"; g: number } | { kind: "table"; t: Uint16Array } | { kind: "para"; fn: number; p: number[] };

export type Profile =
  /** Close enough to sRGB that converting would only add rounding: left as is. */
  | { kind: "srgb" }
  /** Columns are the red, green and blue colorants in XYZ (D50, as ICC stores them). */
  | { kind: "rgb"; colorants: number[]; trc: [Curve, Curve, Curve] }
  | { kind: "gray"; trc: Curve };

const PARA_PARAMS = [1, 3, 4, 5, 7];

function readCurve(icc: Uint8Array, at: number, size: number): Curve | null {
  if (at + 12 > icc.length || size < 12) return null;
  const type = ascii(icc, at, 4);
  if (type === "curv") {
    const n = u32(icc, at + 8);
    if (at + 12 + n * 2 > icc.length) return null;
    if (n === 0) return { kind: "gamma", g: 1 };
    if (n === 1) return { kind: "gamma", g: u16(icc, at + 12) / 256 };
    const t = new Uint16Array(n);
    for (let i = 0; i < n; i++) t[i] = u16(icc, at + 12 + i * 2);
    return { kind: "table", t };
  }
  if (type === "para") {
    const fn = u16(icc, at + 8);
    const count = PARA_PARAMS[fn];
    if (count === undefined || at + 12 + count * 4 > icc.length) return null;
    const p: number[] = [];
    for (let i = 0; i < count; i++) p.push(s15f16(icc, at + 12 + i * 4));
    return { kind: "para", fn, p };
  }
  return null;
}

/** The value of a tone curve at x in [0, 1], clamped to [0, 1]. */
export function evalCurve(c: Curve, x: number): number {
  let y: number;
  if (c.kind === "gamma") y = c.g === 1 ? x : detPow(x, c.g);
  else if (c.kind === "table") {
    const pos = x * (c.t.length - 1);
    const i = Math.min(c.t.length - 2, Math.floor(pos));
    y = (c.t[i] + (c.t[i + 1] - c.t[i]) * (pos - i)) / 65535;
  } else {
    const [g, a = 1, b = 0, cc = 0, d = 0, e = 0, f = 0] = c.p;
    switch (c.fn) {
      case 0:
        y = detPow(x, g);
        break;
      case 1:
        y = x >= -b / a ? detPow(a * x + b, g) : 0;
        break;
      case 2:
        y = x >= -b / a ? detPow(a * x + b, g) + cc : cc;
        break;
      case 3:
        y = x >= d ? detPow(a * x + b, g) : cc * x;
        break;
      default:
        y = x >= d ? detPow(a * x + b, g) + e : cc * x + f;
    }
  }
  return y < 0 || Number.isNaN(y) ? 0 : y > 1 ? 1 : y;
}

/** sRGB's colorants as the standard sRGB ICC profile stores them (D50-adapted), columns r, g, b. */
const SRGB_COLORANTS = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];

const srgbDecode = (x: number) => (x <= 0.04045 ? x / 12.92 : detPow((x + 0.055) / 1.055, 2.4));

/** 8-bit code to linear light, 0..65535. */
function linearTable(c: Curve): Uint16Array {
  const t = new Uint16Array(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(evalCurve(c, v / 255) * 65535);
  return t;
}

/**
 * Linear light to sRGB 8-bit codes, as constants: SRGB_STEPS[k] is the first
 * linear value (0..65535) that encodes to code k + 1 under
 * round(255 * (1.055 * y^(1/2.4) - 0.055)), or 12.92 * y below 0.0031308.
 * Pinned by hash in tests/colour-profile.test.ts, which also rebuilds it
 * from that formula, so no engine's pow ever builds this table.
 */
export const SRGB_STEPS: readonly number[] = [10, 30, 50, 70, 90, 110, 130, 150, 170, 189, 209, 230, 253, 276, 301, 327, 354, 382, 412, 443, 475, 509, 544, 580, 618, 657, 698, 740, 783, 828, 875, 923, 972, 1023, 1075, 1129, 1185, 1242, 1300, 1360, 1422, 1486, 1551, 1617, 1685, 1755, 1827, 1900, 1975, 2052, 2130, 2210, 2292, 2376, 2461, 2548, 2637, 2727, 2820, 2914, 3010, 3108, 3208, 3309, 3412, 3518, 3625, 3734, 3844, 3957, 4072, 4188, 4307, 4427, 4550, 4674, 4800, 4928, 5059, 5191, 5325, 5461, 5599, 5740, 5882, 6026, 6173, 6321, 6471, 6624, 6778, 6935, 7094, 7255, 7418, 7583, 7750, 7919, 8091, 8265, 8440, 8618, 8798, 8981, 9165, 9352, 9541, 9732, 9925, 10121, 10318, 10518, 10720, 10925, 11132, 11341, 11552, 11765, 11981, 12199, 12420, 12643, 12868, 13095, 13325, 13557, 13791, 14028, 14267, 14508, 14752, 14998, 15247, 15498, 15751, 16007, 16265, 16525, 16788, 17054, 17321, 17592, 17864, 18139, 18417, 18697, 18980, 19264, 19552, 19842, 20134, 20429, 20727, 21027, 21329, 21634, 21942, 22252, 22564, 22880, 23197, 23518, 23840, 24166, 24494, 24824, 25158, 25493, 25832, 26173, 26516, 26862, 27211, 27563, 27917, 28273, 28633, 28995, 29359, 29727, 30097, 30469, 30845, 31223, 31603, 31987, 32373, 32762, 33153, 33547, 33944, 34344, 34747, 35152, 35560, 35970, 36384, 36800, 37219, 37640, 38065, 38492, 38922, 39355, 39790, 40229, 40670, 41114, 41561, 42011, 42463, 42918, 43377, 43838, 44301, 44768, 45238, 45710, 46185, 46663, 47144, 47628, 48115, 48605, 49097, 49593, 50091, 50592, 51096, 51604, 52114, 52627, 53142, 53661, 54183, 54708, 55235, 55766, 56300, 56836, 57376, 57918, 58464, 59012, 59564, 60118, 60675, 61236, 61799, 62366, 62935, 63508, 64083, 64662, 65244];

let encodeTable: Uint8Array | null = null;
/** Linear light 0..65535 to an sRGB 8-bit code: the 65536-entry table, filled from SRGB_STEPS with integers only. */
export function srgbEncodeTable(): Uint8Array {
  if (!encodeTable) {
    encodeTable = new Uint8Array(65536);
    let code = 0;
    for (let x = 0; x < 65536; x++) {
      while (code < 255 && x >= SRGB_STEPS[code]) code++;
      encodeTable[x] = code;
    }
  }
  return encodeTable;
}

const SRGB_LINEAR = (() => {
  const t = new Uint16Array(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(srgbDecode(v / 255) * 65535);
  return t;
})();

/** Within 1/256 of sRGB's own curve at every 8-bit code. */
const nearSrgbCurve = (lin: Uint16Array) => lin.every((y, v) => Math.abs(y - SRGB_LINEAR[v]) <= 256);

function invert3(m: number[]): number[] | null {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h;
  const B = -(d * i - f * g);
  const C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (!det || !Number.isFinite(det)) return null;
  return [A / det, -(b * i - c * h) / det, (b * f - c * e) / det, B / det, (a * i - c * g) / det, -(a * f - c * d) / det, C / det, -(a * h - b * g) / det, (a * e - b * d) / det];
}

function multiply3(x: number[], y: number[]): number[] {
  const out: number[] = [];
  for (let r = 0; r < 3; r++) for (let c = 0; c < 3; c++) out.push(x[r * 3] * y[c] + x[r * 3 + 1] * y[3 + c] + x[r * 3 + 2] * y[6 + c]);
  return out;
}

/** Reads an ICC profile this file can apply, or null for one it cannot (the photo is then read as sRGB). */
export function parseProfile(icc: Uint8Array): Profile | null {
  if (icc.length < 132 || ascii(icc, 36, 4) !== "acsp") return null;
  const space = ascii(icc, 16, 4);
  const pcs = ascii(icc, 20, 4);
  const count = u32(icc, 128);
  if (132 + count * 12 > icc.length) return null;
  const tags = new Map<string, { at: number; size: number }>();
  for (let i = 0; i < count; i++) {
    const e = 132 + i * 12;
    tags.set(ascii(icc, e, 4), { at: u32(icc, e + 4), size: u32(icc, e + 8) });
  }
  const curve = (sig: string) => {
    const t = tags.get(sig);
    return t ? readCurve(icc, t.at, t.size) : null;
  };
  if (space === "GRAY") {
    const trc = curve("kTRC");
    return trc ? { kind: "gray", trc } : null;
  }
  if (space !== "RGB " || pcs !== "XYZ ") return null;
  const colorants: number[] = new Array(9);
  for (const [col, sig] of ["rXYZ", "gXYZ", "bXYZ"].entries()) {
    const t = tags.get(sig);
    if (!t || t.at + 20 > icc.length || ascii(icc, t.at, 4) !== "XYZ ") return null;
    for (let row = 0; row < 3; row++) colorants[row * 3 + col] = s15f16(icc, t.at + 8 + row * 4);
  }
  const r = curve("rTRC");
  const g = curve("gTRC");
  const b = curve("bTRC");
  if (!r || !g || !b) return null;
  const trc: [Curve, Curve, Curve] = [r, g, b];
  const nearMatrix = colorants.every((v, i) => Math.abs(v - SRGB_COLORANTS[i]) <= 0.002);
  if (nearMatrix && trc.every((c) => nearSrgbCurve(linearTable(c)))) return { kind: "srgb" };
  return { kind: "rgb", colorants, trc };
}

/** Matrix coefficients in 2^14 fixed point. */
const FIX = 16384;

/** Converts pixels in a profile's space to sRGB, in place. Alpha is kept. Integer arithmetic after the tables. */
export function toSrgb(pixels: Pixels, profile: Profile): void {
  if (profile.kind === "srgb") return;
  const enc = srgbEncodeTable();
  const d = pixels.data;
  if (profile.kind === "gray") {
    const lin = linearTable(profile.trc);
    const map = new Uint8Array(256);
    for (let v = 0; v < 256; v++) map[v] = enc[lin[v]];
    for (let i = 0; i < d.length; i += 4) {
      d[i] = map[d[i]];
      d[i + 1] = map[d[i + 1]];
      d[i + 2] = map[d[i + 2]];
    }
    return;
  }
  const inv = invert3(SRGB_COLORANTS);
  if (!inv) return;
  const m = multiply3(inv, profile.colorants).map((v) => Math.round(v * FIX));
  const [lr, lg, lb] = profile.trc.map(linearTable);
  const half = FIX / 2;
  for (let i = 0; i < d.length; i += 4) {
    const r = lr[d[i]];
    const g = lg[d[i + 1]];
    const b = lb[d[i + 2]];
    for (let c = 0; c < 3; c++) {
      // Exact in a double: |m| < 2^17, values < 2^16, so every term is an integer below 2^35.
      const y = Math.floor((m[c * 3] * r + m[c * 3 + 1] * g + m[c * 3 + 2] * b + half) / FIX);
      d[i + c] = enc[y < 0 ? 0 : y > 65535 ? 65535 : y];
    }
  }
}
