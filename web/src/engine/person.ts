// The read person only. The multiclass segmenter labels every person in the
// photo; the pose landmarker finds one. Everything Ratio measures (the
// figure's extent, the garment rows, the volume widths, the palette) and
// everything it recolours must come from that one person, never from
// someone behind them (Noor, 2026-10-04: a look painted a background man's
// trousers green while the subject's jeans stayed burgundy).
//
// The person is the 8-connected component of non-background pixels that
// holds the pose's shoulders, hips and knees, found by a flood fill at
// reading size. Pieces of the same person cut off by a gap (a shoe beyond a
// shadow, hair beyond a hand) join it when they lie mostly inside a corridor
// around the pose skeleton. When the component reaches far outside that
// corridor, it has merged with someone touching the person, and the
// corridor clips it. Pure and deterministic: fixed seeds, fixed scan order.

import { CATEGORY, type Landmark, type Mask, POSE } from "./measure";

const VISIBLE = 0.5;
/** Corridor half-width around the skeleton, as a share of the shoulder distance. */
export const CORRIDOR_PAD = 0.6;
/** A component with more than this share of its pixels outside the corridor has merged with another person. */
export const MERGED_OUTSIDE = 0.3;
/** A component with at least this share of its pixels inside the corridor is part of the read person. */
export const OWN_FRAGMENT = 0.6;
/** Another person counts when their pixels reach this share of the read person's. */
export const OTHER_MIN = 0.1;

export type Side = "left" | "middle" | "right";

export interface Person {
  /** The segmenter's categories for the read person; every other pixel is background. */
  mask: Mask;
  /** How many other sizeable people the photo holds. */
  others: number;
  /** Where the read person stands among them (null when alone). */
  side: Side | null;
  /** True when the person touched someone and the corridor clipped them apart. */
  clipped: boolean;
}

type P = { x: number; y: number };

/** Squared distance from a point to a segment. */
function segDist2(p: P, a: P, b: P): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  const x = a.x + t * dx - p.x, y = a.y + t * dy - p.y;
  return x * x + y * y;
}

/** Crossing-number test for a closed polygon. */
function inPolygon(p: P, poly: P[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i], b = poly[j];
    if (a.y > p.y !== b.y > p.y && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

/**
 * The corridor around the pose skeleton: the torso polygon (shoulders and
 * hips) and every bone (head, shoulders, flanks, hips, thighs, shins) padded
 * by CORRIDOR_PAD of the shoulder distance. In pixels of the mask.
 */
export function corridor(pose: Landmark[], width: number, height: number): (x: number, y: number) => boolean {
  const at = (i: number): P => ({ x: pose[i].x * width, y: pose[i].y * height });
  const seen = (i: number) => (pose[i].visibility ?? 1) >= VISIBLE;
  const sL = at(POSE.lShoulder), sR = at(POSE.rShoulder), hL = at(POSE.lHip), hR = at(POSE.rHip);
  const shoulderW = Math.hypot(sL.x - sR.x, sL.y - sR.y);
  const pad = Math.max(4, shoulderW * CORRIDOR_PAD);
  const mid = { x: (sL.x + sR.x) / 2, y: (sL.y + sR.y) / 2 };
  const hipMid = { x: (hL.x + hR.x) / 2, y: (hL.y + hR.y) / 2 };
  const torso = Math.hypot(hipMid.x - mid.x, hipMid.y - mid.y);
  // The crown: past the nose by as much again as the nose sits above the shoulders.
  const nose = at(POSE.nose);
  const crown = seen(POSE.nose) ? { x: mid.x + (nose.x - mid.x) * 1.8, y: mid.y + (nose.y - mid.y) * 1.8 } : { x: mid.x, y: mid.y - torso * 0.6 };
  const bones: [P, P][] = [[mid, crown], [sL, sR], [sL, hL], [sR, hR], [hL, hR]];
  const leg = (hip: P, knee: number, ankle: number) => {
    if (!seen(knee)) return;
    bones.push([hip, at(knee)]);
    if (seen(ankle)) bones.push([at(knee), at(ankle)]);
  };
  leg(hL, POSE.lKnee, POSE.lAnkle);
  leg(hR, POSE.rKnee, POSE.rAnkle);
  const poly = [sL, sR, hR, hL];
  const pad2 = pad * pad;
  return (x, y) => {
    const p = { x: x + 0.5, y: y + 0.5 };
    return inPolygon(p, poly) || bones.some(([a, b]) => segDist2(p, a, b) <= pad2);
  };
}

/** Labels the 8-connected component of non-background pixels from the seeds; returns its pixel indices in visiting order. */
function flood(mask: Mask, label: Int32Array, seeds: number[], id: number): number[] {
  const { width: W, height: H, data } = mask;
  const out: number[] = [];
  for (const s of seeds) {
    if (label[s] !== 0 || data[s] === CATEGORY.background) continue;
    label[s] = id;
    out.push(s);
  }
  for (let k = 0; k < out.length; k++) {
    const i = out[k];
    const x = i % W, y = (i - x) / W;
    for (let dy = -1; dy <= 1; dy++)
      for (let dx = -1; dx <= 1; dx++) {
        if (!dx && !dy) continue;
        const nx = x + dx, ny = y + dy;
        if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue;
        const j = ny * W + nx;
        if (label[j] === 0 && data[j] !== CATEGORY.background) {
          label[j] = id;
          out.push(j);
        }
      }
  }
  return out;
}

/** The nearest non-background pixel to a landmark, within a small radius; ties go to the first in row order. */
function seedAt(mask: Mask, l: Landmark, radius: number): number {
  const { width: W, height: H, data } = mask;
  const cx = Math.min(W - 1, Math.max(0, Math.floor(l.x * W))), cy = Math.min(H - 1, Math.max(0, Math.floor(l.y * H)));
  let best = -1, bestD = Infinity;
  for (let y = Math.max(0, cy - radius); y <= Math.min(H - 1, cy + radius); y++)
    for (let x = Math.max(0, cx - radius); x <= Math.min(W - 1, cx + radius); x++) {
      if (data[y * W + x] === CATEGORY.background) continue;
      const d = (x - cx) ** 2 + (y - cy) ** 2;
      if (d < bestD) { bestD = d; best = y * W + x; }
    }
  return best;
}

/** Keeps only the read person's pixels; counts the other people in the photo. */
export function isolatePerson(mask: Mask, pose: Landmark[]): Person {
  const { width: W, height: H, data } = mask;
  const alone: Person = { mask, others: 0, side: null, clipped: false };
  if (pose.length < 29) return alone;
  const seen = (i: number) => (pose[i].visibility ?? 1) >= VISIBLE;
  if (![POSE.lShoulder, POSE.rShoulder, POSE.lHip, POSE.rHip].every(seen)) return alone;
  const inside = corridor(pose, W, H);
  const shoulderW = Math.hypot((pose[POSE.lShoulder].x - pose[POSE.rShoulder].x) * W, (pose[POSE.lShoulder].y - pose[POSE.rShoulder].y) * H);
  const radius = Math.max(2, Math.round(shoulderW * 0.1));

  // Every non-background component, labelled in a fixed order: the person's
  // seeds first (as one component), then the rest in row order.
  const label = new Int32Array(W * H);
  const seeds = [POSE.lShoulder, POSE.rShoulder, POSE.lHip, POSE.rHip, POSE.lKnee, POSE.rKnee]
    .filter(seen)
    .map((i) => seedAt(mask, pose[i], radius))
    .filter((i) => i >= 0);
  const person = flood(mask, label, seeds, 1);
  const parts: number[][] = [];
  for (let i = 0; i < W * H; i++) if (label[i] === 0 && data[i] !== CATEGORY.background) parts.push(flood(mask, label, [i], parts.length + 2));

  const isIn = (i: number) => inside(i % W, Math.floor(i / W));
  const keep = new Uint8Array(W * H);
  // Centres (x) of the other people, for where the person stands among them.
  const otherX: number[] = [];
  const centreX = (px: number[]) => px.reduce((s, i) => s + (i % W), 0) / px.length;

  const outside = person.filter((i) => !isIn(i));
  // No seed on the person (the segmenter missed them where the pose found
  // them), or a component that reaches far beyond the skeleton: the corridor
  // decides which pixels are the person's.
  const clipped = person.length === 0 || outside.length > person.length * MERGED_OUTSIDE;
  let size = 0;
  if (person.length === 0) {
    for (let i = 0; i < W * H; i++) if (data[i] !== CATEGORY.background && isIn(i)) { keep[i] = 1; size++; }
  } else {
    for (const i of person) if (!clipped || isIn(i)) { keep[i] = 1; size++; }
  }
  if (clipped && person.length && outside.length >= size * OTHER_MIN) otherX.push(centreX(outside));
  for (const part of parts) {
    if (person.length === 0) break;
    const share = part.filter(isIn).length / part.length;
    if (share >= OWN_FRAGMENT) {
      // A piece of the person cut off by a gap; clipped to the corridor when the person was.
      for (const i of part) if (!clipped || isIn(i)) { keep[i] = 1; size++; }
    } else if (part.length >= size * OTHER_MIN) otherX.push(centreX(part));
  }
  if (person.length === 0) {
    for (const part of parts) {
      const out = part.filter((i) => !isIn(i));
      if (out.length >= Math.max(1, size) * OTHER_MIN) otherX.push(centreX(out));
    }
  }

  const out = new Uint8Array(W * H);
  for (let i = 0; i < W * H; i++) if (keep[i]) out[i] = data[i];
  let side: Side | null = null;
  if (otherX.length) {
    const own = (pose[POSE.lShoulder].x + pose[POSE.rShoulder].x + pose[POSE.lHip].x + pose[POSE.rHip].x) / 4 * W;
    side = otherX.every((x) => x > own) ? "left" : otherX.every((x) => x < own) ? "right" : "middle";
  }
  return { mask: { width: W, height: H, data: out }, others: otherX.length, side, clipped };
}

/** The one plain line the read shows when other people are in the photo. */
export function othersCopy(p: Pick<Person, "others" | "side">): string | null {
  if (!p.others || !p.side) return null;
  const where = p.side === "middle" ? "in the middle" : `on the ${p.side}`;
  return `Other people are in the photo; Ratio read the one ${where}.`;
}
