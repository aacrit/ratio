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
// So the profile is cut out of the file before the browser decodes it (an
// untagged photo decodes to the same pixels in all three engines), and this
// file converts the pixels to sRGB itself: an RGB matrix/curve profile or a
// grey curve, on integer lookup tables. Only the tables are built with
// Math.pow, and each entry is rounded to 16 or 8 bits, so engine-to-engine
// drift in pow (an ulp at most) cannot change a pixel. A profile this file
// cannot apply (a LUT-only or CMYK profile) is dropped, and the pixels are
// read as sRGB: the same answer in every engine, if not a perfect colour.

import type { Pixels } from "./resample";

/** Bytes over a plain ArrayBuffer (what a Blob accepts). */
type Bytes = Uint8Array<ArrayBuffer>;

export interface SplitPhoto {
  /** The file with its colour information removed, for the browser to decode. */
  bytes: Bytes;
  /** The embedded ICC profile, if there was one. */
  icc: Bytes | null;
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

const untouched = (bytes: Bytes): SplitPhoto => ({ bytes, icc: null, deflated: false });

/** JPEG: drops every APP2 "ICC_PROFILE" segment and joins the chunks in sequence order. */
function splitJpeg(b: Bytes): SplitPhoto {
  const kept: Bytes[] = [b.subarray(0, 2)];
  const chunks: { seq: number; data: Bytes }[] = [];
  let at = 2;
  for (;;) {
    if (at + 4 > b.length || b[at] !== 0xff) return untouched(b);
    const marker = b[at + 1];
    if (marker === 0xff) {
      // Fill byte before a marker.
      kept.push(b.subarray(at, at + 1));
      at += 1;
      continue;
    }
    if (marker === 0xda || marker === 0xd9) {
      // Start of scan (or end of image): everything after is image data, kept as is.
      kept.push(b.subarray(at));
      break;
    }
    const len = u16(b, at + 2);
    if (len < 2 || at + 2 + len > b.length) return untouched(b);
    const seg = b.subarray(at, at + 2 + len);
    if (marker === 0xe2 && len >= 16 && ascii(seg, 4, 12) === "ICC_PROFILE\0") chunks.push({ seq: seg[16], data: seg.subarray(18) });
    else kept.push(seg);
    at += 2 + len;
  }
  if (!chunks.length) return untouched(b);
  chunks.sort((x, y) => x.seq - y.seq);
  return { bytes: concat(kept), icc: concat(chunks.map((c) => c.data)), deflated: false };
}

/** The PNG chunks a browser may use to change colours; all are removed. */
const PNG_COLOUR = new Set(["iCCP", "sRGB", "gAMA", "cHRM", "cICP", "mDCv", "cLLi"]);

/** PNG: drops the colour chunks and returns iCCP's (deflated) profile. */
function splitPng(b: Bytes): SplitPhoto {
  const kept: Bytes[] = [b.subarray(0, 8)];
  let icc: Bytes | null = null;
  let dropped = false;
  let at = 8;
  while (at < b.length) {
    if (at + 12 > b.length) return untouched(b);
    const len = u32(b, at);
    const type = ascii(b, at + 4, 4);
    const end = at + 12 + len;
    if (end > b.length) return untouched(b);
    if (PNG_COLOUR.has(type)) {
      dropped = true;
      if (type === "iCCP") {
        const data = b.subarray(at + 8, at + 8 + len);
        const nul = data.indexOf(0);
        // name, NUL, compression method (0 = zlib), then the profile.
        if (nul > 0 && nul + 2 <= data.length && data[nul + 1] === 0) icc = data.subarray(nul + 2);
      }
    } else kept.push(b.subarray(at, end));
    at = end;
    if (type === "IEND") break;
  }
  if (!dropped) return untouched(b);
  return { bytes: concat(kept), icc, deflated: icc !== null };
}

/** WebP: drops the ICCP chunk, clears VP8X's ICC flag and fixes the RIFF size. */
function splitWebp(b: Bytes): SplitPhoto {
  const kept: Bytes[] = [];
  let icc: Bytes | null = null;
  let vp8x = -1;
  let at = 12;
  while (at < b.length) {
    if (at + 8 > b.length) return untouched(b);
    const fourcc = ascii(b, at, 4);
    const len = u32le(b, at + 4);
    const end = at + 8 + len + (len & 1);
    if (at + 8 + len > b.length) return untouched(b);
    if (fourcc === "ICCP") icc = b.subarray(at + 8, at + 8 + len);
    else {
      if (fourcc === "VP8X") vp8x = kept.reduce((n, p) => n + p.length, 12) + 8;
      kept.push(b.subarray(at, Math.min(end, b.length)));
    }
    at = end;
  }
  if (!icc) return untouched(b);
  const body = concat([b.subarray(0, 12), ...kept]);
  if (vp8x >= 0) body[vp8x] &= ~0x20;
  const size = body.length - 8;
  body[4] = size & 0xff;
  body[5] = (size >>> 8) & 0xff;
  body[6] = (size >>> 16) & 0xff;
  body[7] = (size >>> 24) & 0xff;
  return { bytes: body, icc, deflated: false };
}

/** Cuts the colour profile out of a JPEG, PNG or WebP file. Anything else, or a file it cannot walk, comes back untouched. */
export function splitColourProfile(bytes: Bytes): SplitPhoto {
  if (bytes.length > 4 && bytes[0] === 0xff && bytes[1] === 0xd8) return splitJpeg(bytes);
  if (bytes.length > 8 && ascii(bytes, 1, 3) === "PNG" && bytes[0] === 0x89) return splitPng(bytes);
  if (bytes.length > 12 && ascii(bytes, 0, 4) === "RIFF" && ascii(bytes, 8, 4) === "WEBP") return splitWebp(bytes);
  return untouched(bytes);
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
  if (c.kind === "gamma") y = c.g === 1 ? x : Math.pow(x, c.g);
  else if (c.kind === "table") {
    const pos = x * (c.t.length - 1);
    const i = Math.min(c.t.length - 2, Math.floor(pos));
    y = (c.t[i] + (c.t[i + 1] - c.t[i]) * (pos - i)) / 65535;
  } else {
    const [g, a = 1, b = 0, cc = 0, d = 0, e = 0, f = 0] = c.p;
    switch (c.fn) {
      case 0:
        y = Math.pow(x, g);
        break;
      case 1:
        y = x >= -b / a ? Math.pow(a * x + b, g) : 0;
        break;
      case 2:
        y = x >= -b / a ? Math.pow(a * x + b, g) + cc : cc;
        break;
      case 3:
        y = x >= d ? Math.pow(a * x + b, g) : cc * x;
        break;
      default:
        y = x >= d ? Math.pow(a * x + b, g) + e : cc * x + f;
    }
  }
  return y < 0 || Number.isNaN(y) ? 0 : y > 1 ? 1 : y;
}

/** sRGB's colorants as the standard sRGB ICC profile stores them (D50-adapted), columns r, g, b. */
const SRGB_COLORANTS = [0.4360747, 0.3850649, 0.1430804, 0.2225045, 0.7168786, 0.0606169, 0.0139322, 0.0971045, 0.7141733];

const srgbDecode = (x: number) => (x <= 0.04045 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4));
const srgbEncode = (y: number) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);

/** 8-bit code to linear light, 0..65535. */
function linearTable(c: Curve): Uint16Array {
  const t = new Uint16Array(256);
  for (let v = 0; v < 256; v++) t[v] = Math.round(evalCurve(c, v / 255) * 65535);
  return t;
}

let encodeTable: Bytes | null = null;
/** Linear light 0..65535 to an sRGB 8-bit code. */
function srgbEncodeTable(): Uint8Array {
  if (!encodeTable) {
    encodeTable = new Uint8Array(65536);
    for (let x = 0; x < 65536; x++) encodeTable[x] = Math.round(Math.min(1, Math.max(0, srgbEncode(x / 65535))) * 255);
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
