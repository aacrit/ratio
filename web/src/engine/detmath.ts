// Powers computed the same way in every engine (law 2).
//
// Math.pow, Math.exp and Math.log are not specified to the last bit: each
// engine ships its own approximation, and an ulp's difference can move a
// value across a rounding boundary. +, -, *, / and Math.round are exact
// IEEE-754 double operations everywhere (JavaScript never fuses a multiply
// and an add), so a pow built from them alone gives the same bits in
// Chromium, Firefox and WebKit. Accurate to about 1e-15 relative, which is
// far below the 16-bit tables it builds.

const LN2 = 0.6931471805599453;
// ln 2 split so that k * LN2_HI is exact for the k used here (fdlibm's split).
const LN2_HI = 0.6931471803691238;
const LN2_LO = 1.9082149292705877e-10;
const SQRT2 = 1.4142135623730951;

/** Natural log of x > 0, from + - * / only. */
export function detLog(x: number): number {
  if (!(x > 0) || x === Infinity) return Number.NaN;
  let e = 0;
  // Exact: scaling by 2 never rounds for a normal double.
  while (x >= 2) {
    x /= 2;
    e++;
  }
  while (x < 1) {
    x *= 2;
    e--;
  }
  if (x > SQRT2) {
    x /= 2;
    e++;
  }
  // ln x = 2 atanh s, s = (x - 1) / (x + 1), |s| <= 0.1716.
  const s = (x - 1) / (x + 1);
  const s2 = s * s;
  let sum = 0;
  for (let k = 25; k >= 1; k -= 2) sum = 1 / k + s2 * sum;
  return e * LN2_HI + (2 * s * sum + e * LN2_LO);
}

/** e^y, from + - * / only. */
export function detExp(y: number): number {
  if (Number.isNaN(y)) return Number.NaN;
  if (y > 709) return Infinity;
  if (y < -745) return 0;
  const k = Math.round(y / LN2);
  const r = y - k * LN2_HI - k * LN2_LO;
  // Taylor series on |r| <= 0.35: 20 terms is well past double precision.
  let sum = 1;
  for (let n = 20; n >= 1; n--) sum = 1 + (r / n) * sum;
  let out = sum;
  for (let i = 0; i < k; i++) out *= 2;
  for (let i = 0; i > k; i--) out /= 2;
  return out;
}

/** x^g for x >= 0, the same bits in every engine. NaN for x < 0, as Math.pow gives for a fractional g. */
export function detPow(x: number, g: number): number {
  if (Number.isNaN(x) || Number.isNaN(g)) return Number.NaN;
  if (g === 0 || x === 1) return 1;
  if (g === 1) return x;
  if (x === 0) return g > 0 ? 0 : Infinity;
  if (x < 0) return Number.NaN;
  return detExp(g * detLog(x));
}
