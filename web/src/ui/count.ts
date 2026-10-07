// Numerals that count up as they land (the `lands` spring: heavy, no
// overshoot, because a measurement never shows a value it did not read).
// Every number inside a string moves at once, keeping its own decimals, so
// "0.64 : 0.36" lands as one pair and "1.45× · 0.55×" as one line. From a
// previous string with the same numbers in the same places, each counts
// from its old value (a tried look changing a reading); otherwise from 0.
// Reduced motion writes the final text at once.

import { type Animation, spring, springToken } from "../motion";

const NUMBER = /-?\d+(?:\.\d+)?/g;

interface Part {
  from: number;
  to: number;
  decimals: number;
}

function parts(to: string, from?: string): { template: string[]; numbers: Part[] } {
  const template = to.split(NUMBER);
  const targets = [...to.matchAll(NUMBER)].map((m) => m[0]);
  const starts = from ? [...from.matchAll(NUMBER)].map((m) => Number(m[0])) : [];
  const same = starts.length === targets.length;
  const numbers = targets.map((t, i) => ({ from: same ? starts[i] : 0, to: Number(t), decimals: (t.split(".")[1] ?? "").length }));
  return { template, numbers };
}

function render(template: string[], numbers: Part[], t: number): string {
  let out = template[0];
  numbers.forEach((n, i) => {
    const v = n.from + (n.to - n.from) * t;
    out += v.toFixed(n.decimals) + template[i + 1];
  });
  return out;
}

/** Counts the element's text to `to`. Returns the animation; the text is final when it resolves, unless it was cancelled (cancel resolves it too). */
export function countTo(el: HTMLElement, to: string, from?: string): Animation {
  const { template, numbers } = parts(to, from);
  if (!numbers.length || (from !== undefined && from === to)) {
    el.textContent = to;
    return { done: Promise.resolve(), cancel: () => {} };
  }
  el.dataset.counting = "";
  const anim = spring(springToken("lands"), 0, 1, (t) => {
    el.textContent = t >= 1 ? to : render(template, numbers, t);
  });
  void anim.done.then(() => delete el.dataset.counting);
  return anim;
}
