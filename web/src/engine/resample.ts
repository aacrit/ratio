// Our own downsampler, used instead of the browser's canvas scaling, whose
// filter differs between engines (the determinism risk in the brief). An
// area-average box filter on integer arithmetic: the same pixels in give the
// same pixels out, in Node and in every browser.

export interface Pixels {
  width: number;
  height: number;
  /** RGBA, 4 bytes per pixel, row-major. */
  data: Uint8ClampedArray;
}

/** The long side every photo is read at. */
export const READ_SIZE = 512;

export function targetSize(width: number, height: number, longSide = READ_SIZE): { width: number; height: number } {
  if (width <= longSide && height <= longSide) return { width, height };
  const scale = longSide / Math.max(width, height);
  return { width: Math.max(1, Math.round(width * scale)), height: Math.max(1, Math.round(height * scale)) };
}

/**
 * Box-filter downscale. Each output pixel averages the source pixels whose
 * index maps to it (floor(i * out / in)), rounding half up.
 */
export function downsample(src: Pixels, longSide = READ_SIZE): Pixels {
  const { width: ow, height: oh } = targetSize(src.width, src.height, longSide);
  if (ow === src.width && oh === src.height) return { width: ow, height: oh, data: new Uint8ClampedArray(src.data) };
  const sums = new Float64Array(ow * oh * 4);
  const counts = new Uint32Array(ow * oh);
  const colOf = new Uint32Array(src.width);
  for (let x = 0; x < src.width; x++) colOf[x] = Math.floor((x * ow) / src.width);
  for (let y = 0; y < src.height; y++) {
    const oy = Math.floor((y * oh) / src.height);
    for (let x = 0; x < src.width; x++) {
      const o = oy * ow + colOf[x];
      const i = (y * src.width + x) * 4;
      sums[o * 4] += src.data[i];
      sums[o * 4 + 1] += src.data[i + 1];
      sums[o * 4 + 2] += src.data[i + 2];
      sums[o * 4 + 3] += src.data[i + 3];
      counts[o]++;
    }
  }
  const data = new Uint8ClampedArray(ow * oh * 4);
  for (let o = 0; o < ow * oh; o++) {
    const n = counts[o];
    for (let c = 0; c < 4; c++) data[o * 4 + c] = Math.floor(sums[o * 4 + c] / n + 0.5);
  }
  return { width: ow, height: oh, data };
}
