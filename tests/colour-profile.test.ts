// Law 2 (CLAUDE.md), R3 (docs/RISKS.md): a colour-tagged photo must decode
// to the same pixels in every engine. The browser never sees the profile
// (web/src/engine/icc.ts cuts it out), and our integer pipeline applies it.

import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { evalCurve, parseProfile, splitColourProfile, toSrgb } from "../web/src/engine/icc";

const enc = (s: string) => Uint8Array.from(s, (c) => c.charCodeAt(0));
const be16 = (n: number) => [(n >>> 8) & 0xff, n & 0xff];
const be32 = (n: number) => [(n >>> 24) & 0xff, (n >>> 16) & 0xff, (n >>> 8) & 0xff, n & 0xff];
const le32 = (n: number) => [n & 0xff, (n >>> 8) & 0xff, (n >>> 16) & 0xff, (n >>> 24) & 0xff];
const s15 = (v: number) => be32(Math.round(v * 65536) >>> 0);
const cat = (...parts: (Uint8Array | number[])[]) => Uint8Array.from(parts.flatMap((p) => [...p]));

const xyz = (x: number, y: number, z: number) => cat(enc("XYZ "), [0, 0, 0, 0], s15(x), s15(y), s15(z));
const gammaCurve = (g: number) => cat(enc("curv"), [0, 0, 0, 0], be32(1), be16(Math.round(g * 256)), [0, 0]);
const paraCurve = (fn: number, p: number[]) => cat(enc("para"), [0, 0, 0, 0], be16(fn), [0, 0], ...p.map(s15));

/** A minimal ICC profile: header, tag table, tag data. */
function profile(space: string, pcs: string, tags: Record<string, Uint8Array>): Uint8Array {
  const sigs = Object.keys(tags);
  let at = 132 + sigs.length * 12;
  const table: number[] = [];
  const data: Uint8Array[] = [];
  for (const sig of sigs) {
    const t = tags[sig];
    table.push(...enc(sig), ...be32(at), ...be32(t.length));
    data.push(t);
    at += t.length;
  }
  const header = new Uint8Array(128);
  header.set(be32(at), 0);
  header.set(enc(space), 16);
  header.set(enc(pcs), 20);
  header.set(enc("acsp"), 36);
  return cat(header, be32(sigs.length), table, ...data);
}

const ADOBE_G = 563 / 256;
const adobe = () =>
  profile("RGB ", "XYZ ", {
    rXYZ: xyz(0.60974, 0.31111, 0.01947),
    gXYZ: xyz(0.20528, 0.62567, 0.06087),
    bXYZ: xyz(0.14919, 0.06322, 0.74457),
    rTRC: gammaCurve(ADOBE_G),
    gTRC: gammaCurve(ADOBE_G),
    bTRC: gammaCurve(ADOBE_G),
  });
const SRGB_PARA = [2.4, 1 / 1.055, 0.055 / 1.055, 1 / 12.92, 0.04045];
const srgb = () =>
  profile("RGB ", "XYZ ", {
    rXYZ: xyz(0.4360747, 0.2225045, 0.0139322),
    gXYZ: xyz(0.3850649, 0.7168786, 0.0971045),
    bXYZ: xyz(0.1430804, 0.0606169, 0.7141733),
    rTRC: paraCurve(3, SRGB_PARA),
    gTRC: paraCurve(3, SRGB_PARA),
    bTRC: paraCurve(3, SRGB_PARA),
  });

const px = (...rgb: number[][]) => ({ width: rgb.length, height: 1, data: Uint8ClampedArray.from(rgb.flatMap(([r, g, b, a = 255]) => [r, g, b, a])) });

describe("splitColourProfile: the browser decodes an untagged file", () => {
  const seg = (marker: number, body: Uint8Array | number[]) => cat([0xff, marker], be16(body.length + 2), body);
  const icc = (seq: number, count: number, data: number[]) => seg(0xe2, cat(enc("ICC_PROFILE\0"), [seq, count], data));

  it("JPEG: removes every ICC_PROFILE APP2 segment and joins the chunks in sequence order", () => {
    const app0 = seg(0xe0, enc("JFIF\0\x01\x02"));
    const dqt = seg(0xdb, [0, 1, 2, 3]);
    const scan = cat([0xff, 0xda], be16(4), [9, 9], [1, 2, 0xff, 0x00, 3], [0xff, 0xd9]);
    const file = cat([0xff, 0xd8], app0, icc(2, 2, [4, 5, 6]), seg(0xe1, enc("Exif\0\0")), icc(1, 2, [1, 2, 3]), dqt, scan);
    const out = splitColourProfile(file);
    expect([...out.icc!]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out.deflated).toBe(false);
    expect([...out.bytes]).toEqual([...cat([0xff, 0xd8], app0, seg(0xe1, enc("Exif\0\0")), dqt, scan)]);
  });

  it("JPEG without a profile comes back untouched", () => {
    const file = cat([0xff, 0xd8], seg(0xe0, enc("JFIF\0")), [0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9]);
    const out = splitColourProfile(file);
    expect(out.icc).toBeNull();
    expect(out.bytes).toBe(file);
  });

  it("PNG: drops iCCP, gAMA, cHRM and sRGB and returns the deflated profile", () => {
    const chunk = (type: string, data: Uint8Array | number[]) => cat(be32(data.length), enc(type), data, [0xde, 0xad, 0xbe, 0xef]);
    const prof = adobe();
    const ihdr = chunk("IHDR", new Array(13).fill(1));
    const idat = chunk("IDAT", [1, 2, 3]);
    const iend = chunk("IEND", []);
    const file = cat([0x89, ...enc("PNG\r\n\x1a\n")], ihdr, chunk("gAMA", be32(45455)), chunk("cHRM", new Array(32).fill(0)), chunk("iCCP", cat(enc("ICC\0"), [0], deflateSync(prof))), chunk("sRGB", [0]), idat, iend);
    const out = splitColourProfile(file);
    expect(out.deflated).toBe(true);
    expect([...inflateSync(out.icc!)]).toEqual([...prof]);
    expect([...out.bytes]).toEqual([...cat([0x89, ...enc("PNG\r\n\x1a\n")], ihdr, idat, iend)]);
  });

  it("WebP: drops ICCP, clears the VP8X ICC flag and rewrites the RIFF size", () => {
    const chunk = (fourcc: string, data: number[]) => cat(enc(fourcc), le32(data.length), data, data.length & 1 ? [0] : []);
    const vp8x = chunk("VP8X", [0x20 | 0x10, 0, 0, 0, 9, 0, 0, 9, 0, 0]);
    const iccp = chunk("ICCP", [1, 2, 3]);
    const vp8l = chunk("VP8L", [0x2f, 1, 2, 3, 4]);
    const body = cat(enc("WEBP"), vp8x, iccp, vp8l);
    const file = cat(enc("RIFF"), le32(body.length), body);
    const out = splitColourProfile(file);
    expect([...out.icc!]).toEqual([1, 2, 3]);
    const want = cat(enc("RIFF"), le32(4 + vp8x.length + vp8l.length), enc("WEBP"), chunk("VP8X", [0x10, 0, 0, 0, 9, 0, 0, 9, 0, 0]), vp8l);
    expect([...out.bytes]).toEqual([...want]);
  });

  it("a truncated or unknown file comes back untouched, never throws", () => {
    for (const bytes of [new Uint8Array(0), enc("GIF89a....."), Uint8Array.from([0xff, 0xd8, 0xff, 0xe2, 0xff, 0xff]), cat([0x89, ...enc("PNG\r\n\x1a\n")], be32(99999), enc("iCCP"))]) {
      const out = splitColourProfile(bytes);
      expect(out.icc).toBeNull();
      expect(out.bytes).toBe(bytes);
    }
  });
});

describe("parseProfile", () => {
  it("recognises an sRGB profile and leaves its pixels alone", () => {
    expect(parseProfile(srgb())).toEqual({ kind: "srgb" });
    const p = px([12, 200, 99], [255, 0, 128]);
    const before = [...p.data];
    toSrgb(p, parseProfile(srgb())!);
    expect([...p.data]).toEqual(before);
  });

  it("reads a matrix/curve profile (Adobe RGB)", () => {
    const p = parseProfile(adobe());
    expect(p?.kind).toBe("rgb");
  });

  it("reads a grey profile", () => {
    expect(parseProfile(profile("GRAY", "XYZ ", { kTRC: gammaCurve(2.2) }))?.kind).toBe("gray");
  });

  it("returns null for a profile it cannot apply, and for garbage", () => {
    expect(parseProfile(profile("CMYK", "Lab ", { A2B0: enc("mft2....") }))).toBeNull();
    expect(parseProfile(profile("RGB ", "Lab ", { A2B0: enc("mAB ....") }))).toBeNull();
    expect(parseProfile(profile("RGB ", "XYZ ", { rXYZ: xyz(1, 1, 1) }))).toBeNull();
    expect(parseProfile(new Uint8Array(10))).toBeNull();
    const huge = adobe();
    huge.set(be32(0x7fffffff), 128);
    expect(parseProfile(huge)).toBeNull();
    const badOffset = adobe();
    badOffset.set(be32(0xfffff0), 132 + 4);
    expect(parseProfile(badOffset)).toBeNull();
  });

  it("evaluates parametric curves (sRGB's type 3 matches the sRGB formula)", () => {
    const c = { kind: "para" as const, fn: 3, p: SRGB_PARA };
    expect(evalCurve(c, 0)).toBe(0);
    expect(evalCurve(c, 1)).toBeCloseTo(1, 4);
    expect(evalCurve(c, 0.5)).toBeCloseTo(Math.pow(0.5550000 / 1.055, 2.4), 4);
    expect(evalCurve(c, 0.02)).toBeCloseTo(0.02 / 12.92, 6);
  });
});

describe("toSrgb: Adobe RGB to sRGB, integer pipeline", () => {
  const conv = (...rgb: number[][]) => {
    const p = px(...rgb);
    toSrgb(p, parseProfile(adobe())!);
    return [...p.data];
  };

  it("keeps black, white, alpha and neutrals neutral", () => {
    const out = conv([0, 0, 0, 7], [255, 255, 255, 200], [128, 128, 128, 255], [40, 40, 40, 0]);
    expect(out.slice(0, 4)).toEqual([0, 0, 0, 7]);
    expect(out.slice(4, 8)).toEqual([255, 255, 255, 200]);
    for (const at of [8, 12]) {
      expect(Math.max(...out.slice(at, at + 3)) - Math.min(...out.slice(at, at + 3))).toBeLessThanOrEqual(1);
    }
    expect(out[11]).toBe(255);
    expect(out[15]).toBe(0);
  });

  it("maps a mid grey through Adobe's curve into sRGB's", () => {
    const want = Math.round((1.055 * Math.pow(Math.pow(128 / 255, ADOBE_G), 1 / 2.4) - 0.055) * 255);
    expect(Math.abs(conv([128, 128, 128])[0] - want)).toBeLessThanOrEqual(1);
  });

  it("makes a wide-gamut colour more saturated in sRGB numbers, never less", () => {
    const [r, g, b] = conv([60, 160, 60]);
    expect(g - r).toBeGreaterThan(100);
    expect(g - b).toBeGreaterThan(100);
    expect(conv([0, 255, 0]).slice(0, 3)).toEqual([0, 255, 0]);
  });

  it("is exact: the same pixels in give these pixels out (pinned)", () => {
    expect(conv([60, 160, 60], [200, 30, 90], [17, 99, 230], [128, 128, 128]).filter((_, i) => i % 4 !== 3)).toMatchInlineSnapshot(`
      [
        0,
        161,
        46,
        233,
        24,
        91,
        0,
        99,
        234,
        129,
        129,
        129,
      ]
    `);
  });
});
