// T8 review round 2: a cancelled spring must resolve its `done` (motion.ts
// said so; cancelAnimationFrame ran before the step that resolved it, so it
// never did), and the sheet's wheel escalation must not stay switched off
// for good when its spring is cut short. Sheet.wheel set a "settling" flag
// and cleared it only on `done`, so a snap or a press inside the settle
// window left every later wheel ignored.
//
// No DOM here (vitest runs in node): the handful of globals the spring and
// the Sheet touch are stubbed, and frames are stepped by hand so a spring
// is provably still in flight when it is cancelled.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Listener = (e: unknown) => void;

class FakeEl {
  listeners = new Map<string, Listener[]>();
  style: Record<string, string> & { setProperty?: (k: string, v: string) => void } = {};
  dataset: Record<string, string> = {};
  attrs: Record<string, string> = {};
  offsetHeight = 800;
  offsetParent: unknown = {};
  scrollTop = 0;
  addEventListener(type: string, fn: Listener) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), fn]);
  }
  fire(type: string, e: unknown) {
    for (const fn of this.listeners.get(type) ?? []) fn(e);
  }
  setAttribute(k: string, v: string) {
    this.attrs[k] = v;
  }
  querySelectorAll() {
    return [];
  }
  getBoundingClientRect() {
    return { top: 0 };
  }
  contains() {
    return true;
  }
  hasPointerCapture() {
    return false;
  }
  setPointerCapture() {}
  releasePointerCapture() {}
}

let frames = new Map<number, (t: number) => void>();
let nextId = 1;
let now = 0;

/** Runs one animation frame `ms` after the last. */
function frame(ms = 16) {
  now += ms;
  const due = frames;
  frames = new Map();
  for (const fn of due.values()) fn(now);
}

beforeEach(() => {
  frames = new Map();
  nextId = 1;
  now = 0;
  vi.stubGlobal("matchMedia", () => ({ matches: false, addEventListener() {} }));
  vi.stubGlobal("requestAnimationFrame", (fn: (t: number) => void) => {
    const id = nextId++;
    frames.set(id, fn);
    return id;
  });
  vi.stubGlobal("cancelAnimationFrame", (id: number) => frames.delete(id));
  vi.stubGlobal("performance", { now: () => now });
  vi.stubGlobal("innerHeight", 800);
  vi.stubGlobal("addEventListener", () => {});
  vi.stubGlobal("getComputedStyle", () => ({ getPropertyValue: () => "" }));
  vi.stubGlobal("document", { documentElement: { style: { setProperty() {} } } });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("spring(): cancel resolves done", () => {
  it("resolves a spring cancelled mid-flight, without another frame", async () => {
    const { spring } = await import("../web/src/motion");
    const anim = spring({ stiffness: 200, damping: 26, mass: 1 }, 0, 100, () => {});
    frame();
    frame();
    let settled = false;
    void anim.done.then(() => {
      settled = true;
    });
    anim.cancel();
    await Promise.resolve();
    await Promise.resolve();
    expect(settled).toBe(true);
  });

  it("stops updating once cancelled", async () => {
    const { spring } = await import("../web/src/motion");
    const update = vi.fn();
    const anim = spring({ stiffness: 200, damping: 26, mass: 1 }, 0, 100, update);
    frame();
    const calls = update.mock.calls.length;
    anim.cancel();
    frame();
    frame();
    expect(update.mock.calls.length).toBe(calls);
  });
});

describe("Sheet: a wheel still escalates after its spring was cut short", () => {
  async function makeSheet() {
    const { Sheet } = await import("../web/src/ui/sheet");
    const element = new FakeEl();
    const body = new FakeEl();
    const grip = new FakeEl();
    const sheet = new Sheet(element as unknown as HTMLElement, body as unknown as HTMLElement, grip as unknown as HTMLButtonElement);
    const wheel = () => {
      const e = { deltaX: 0, deltaY: 40, deltaMode: 0, ctrlKey: false, defaultPrevented: false, preventDefault() {
        this.defaultPrevented = true;
      } };
      body.fire("wheel", e);
      return e;
    };
    return { sheet, element, wheel };
  }

  it("wheel from half, snap back to half mid-spring, wheel again: the sheet goes to full", async () => {
    const { sheet, wheel } = await makeSheet();
    sheet.snap("half");
    for (let i = 0; i < 200; i++) frame();
    expect(sheet.snapped).toBe("half");

    wheel();
    expect(sheet.snapped).toBe("full");
    frame(); // ~16 ms in, still in flight
    frame(); // ~32 ms
    sheet.snap("half"); // inside 60 ms: cancels the wheel's spring
    await Promise.resolve();
    expect(sheet.snapped).toBe("half");

    wheel();
    expect(sheet.snapped).toBe("full");
  });

  it("a press (pointerdown) mid-spring also releases the wheel", async () => {
    const { sheet, element, wheel } = await makeSheet();
    sheet.snap("half");
    for (let i = 0; i < 200; i++) frame();
    wheel();
    frame();
    element.fire("pointerdown", { button: 0, clientY: 300, pointerId: 1, target: {} });
    element.fire("pointerup", { clientY: 300, pointerId: 1 });
    sheet.snap("half");
    wheel();
    expect(sheet.snapped).toBe("full");
  });

  it("while its own spring is settling, further wheel events are claimed (no body scroll) and do not restart it", async () => {
    const { sheet, wheel } = await makeSheet();
    sheet.snap("half");
    for (let i = 0; i < 200; i++) frame();
    wheel();
    frame();
    const during = wheel();
    expect(during.defaultPrevented).toBe(true);
    expect(sheet.snapped).toBe("full");
    // Once it has settled, the native scroll is back at full.
    for (let i = 0; i < 200; i++) frame();
    await Promise.resolve();
    await Promise.resolve();
    const after = wheel();
    expect(after.defaultPrevented).toBe(false);
  });
});
