// Law 2 (CLAUDE.md), R3 (docs/RISKS.md): a colour-tagged photo must decode
// to the same pixels in every engine. The browser never sees the profile
// (web/src/decode.ts ignores it), and our integer pipeline applies it.

import { createHash } from "node:crypto";
import { deflateSync, inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { detExp, detLog, detPow } from "../web/src/engine/detmath";
import { evalCurve, extractColourProfile, parseProfile, SRGB_STEPS, srgbEncodeTable, toSrgb } from "../web/src/engine/icc";

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

describe("extractColourProfile: the profile, read without copying the file", () => {
  const seg = (marker: number, body: Uint8Array | number[]) => cat([0xff, marker], be16(body.length + 2), body);
  const icc = (seq: number, count: number, data: number[]) => seg(0xe2, cat(enc("ICC_PROFILE\0"), [seq, count], data));

  it("JPEG: joins every ICC_PROFILE APP2 chunk in sequence order", () => {
    const app0 = seg(0xe0, enc("JFIF\0\x01\x02"));
    const dqt = seg(0xdb, [0, 1, 2, 3]);
    const scan = cat([0xff, 0xda], be16(4), [9, 9], [1, 2, 0xff, 0x00, 3], [0xff, 0xd9]);
    const file = cat([0xff, 0xd8], app0, icc(2, 2, [4, 5, 6]), seg(0xe1, enc("Exif\0\0")), icc(1, 2, [1, 2, 3]), dqt, scan);
    const out = extractColourProfile(file);
    expect([...out!.icc]).toEqual([1, 2, 3, 4, 5, 6]);
    expect(out!.deflated).toBe(false);
  });

  it("JPEG: a single-segment profile is a view into the file, not a copy", () => {
    const file = cat([0xff, 0xd8], icc(1, 1, [7, 8, 9]), [0xff, 0xda, 0, 2, 0xff, 0xd9]);
    const out = extractColourProfile(file)!;
    expect([...out.icc]).toEqual([7, 8, 9]);
    expect(out.icc.buffer).toBe(file.buffer);
  });

  it("JPEG without a profile has none", () => {
    expect(extractColourProfile(cat([0xff, 0xd8], seg(0xe0, enc("JFIF\0")), [0xff, 0xda, 0, 2, 7, 7, 0xff, 0xd9]))).toBeNull();
  });

  it("PNG: returns iCCP's deflated profile", () => {
    const chunk = (type: string, data: Uint8Array | number[]) => cat(be32(data.length), enc(type), data, [0xde, 0xad, 0xbe, 0xef]);
    const prof = adobe();
    const file = cat([0x89, ...enc("PNG\r\n\x1a\n")], chunk("IHDR", new Array(13).fill(1)), chunk("gAMA", be32(45455)), chunk("iCCP", cat(enc("ICC\0"), [0], deflateSync(prof))), chunk("IDAT", [1, 2, 3]), chunk("IEND", []));
    const out = extractColourProfile(file)!;
    expect(out.deflated).toBe(true);
    expect([...inflateSync(out.icc)]).toEqual([...prof]);
    expect(out.icc.buffer).toBe(file.buffer);
  });

  it("WebP: returns the ICCP chunk", () => {
    const chunk = (fourcc: string, data: number[]) => cat(enc(fourcc), le32(data.length), data, data.length & 1 ? [0] : []);
    const body = cat(enc("WEBP"), chunk("VP8X", [0x20 | 0x10, 0, 0, 0, 9, 0, 0, 9, 0, 0]), chunk("ICCP", [1, 2, 3]), chunk("VP8L", [0x2f, 1, 2, 3, 4]));
    const out = extractColourProfile(cat(enc("RIFF"), le32(body.length), body))!;
    expect([...out.icc]).toEqual([1, 2, 3]);
    expect(out.deflated).toBe(false);
  });

  it("a truncated or unknown file has none, and never throws", () => {
    for (const bytes of [new Uint8Array(0), enc("GIF89a....."), Uint8Array.from([0xff, 0xd8, 0xff, 0xe2, 0xff, 0xff]), cat([0x89, ...enc("PNG\r\n\x1a\n")], be32(99999), enc("iCCP"))]) {
      expect(extractColourProfile(bytes)).toBeNull();
    }
  });
});

describe("no engine's own pow builds a table (law 2)", () => {
  it("SRGB_STEPS is pinned by hash", () => {
    const hash = createHash("sha256").update(SRGB_STEPS.join(",")).digest("hex");
    expect(SRGB_STEPS).toHaveLength(255);
    expect(hash).toBe("e2a871678b4b26a190124ecfe64b3be4cec35b0424ea8e4bdfed0ff8b74cd779");
  });

  it("SRGB_STEPS is the sRGB encode formula, rounded to 8 bits", () => {
    const formula = (y: number) => (y <= 0.0031308 ? 12.92 * y : 1.055 * Math.pow(y, 1 / 2.4) - 0.055);
    const table = srgbEncodeTable();
    for (let x = 0; x < 65536; x++) expect(table[x]).toBe(Math.round(Math.min(1, Math.max(0, formula(x / 65535))) * 255));
  });

  it("detPow agrees with Math.pow to 1e-14, and rounds to the same 16-bit value, on the curves photos carry", () => {
    for (const g of [2.4, 1 / 2.4, ADOBE_G, 2.2, 1.8, 2.19921875, 0.45, 3]) {
      for (let i = 1; i <= 65535; i += 7) {
        const x = i / 65535;
        const want = Math.pow(x, g);
        const got = detPow(x, g);
        expect(Math.abs(got - want) / want).toBeLessThan(1e-14);
        expect(Math.round(got * 65535)).toBe(Math.round(want * 65535));
      }
    }
  });

  it("detPow's edges match Math.pow's", () => {
    for (const [x, g] of [[0, 2.2], [1, 2.2], [0.5, 0], [0.5, 1], [-0.5, 2.2], [0, 0]]) {
      expect(detPow(x, g)).toBe(Math.pow(x, g));
    }
    expect(detExp(0)).toBe(1);
    expect(Math.abs(detLog(Math.E) - 1)).toBeLessThan(1e-15);
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
