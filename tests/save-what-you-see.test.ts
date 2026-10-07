// T7, "what you save is exactly what you see" (R-09, UX pass 3): Noor tried
// a look on the sample (2), went back to the original (Esc) and saved (S);
// the stage showed the original black shoes, the PNG the look's orange ones
// under "As worn". The Figure kept the look's recolour as its card source
// until the exit glide settled (and for good when that glide was cut short).
// And S showed nothing for seconds, so it felt broken.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { OutfitMeasure } from "../web/src/engine/measure";
import { type Bins, ENGINE_VERSION, readBins } from "../web/src/engine/rules";
import { Figure } from "../web/src/overlay";
import type { CardContent } from "../web/src/ui/card";
import type { Shown } from "../web/src/ui/looks";
import { CARD_FAILED, DRAWING_CARD, RESET_MS, type SaveTarget, cardSaver, savedCopy } from "../web/src/ui/save";
import { type FakeCanvas, installFakeBrowser, solid } from "./helpers/fake-canvas";

const BLACK_SHOES: [number, number, number, number] = [20, 20, 20, 255];
const TERRACOTTA_SHOES: [number, number, number, number] = [200, 110, 70, 255];
const AS_WORN = "20,20,20,255";
const THE_LOOK = "200,110,70,255";

const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.8, C: 0.05, h: 80 }, bottom: { L: 0.2, C: 0, h: 0 }, palette: [], fit: null };
const measure: OutfitMeasure = {
  top: 10,
  bottom: 90,
  breakRow: 50,
  waistRow: 40,
  left: 30,
  right: 70,
  centerX: 50,
  topColour: { L: 0.8, a: 0, b: 0.05 },
  bottomColour: { L: 0.2, a: 0, b: 0 },
  fit: null,
};

let browser: ReturnType<typeof installFakeBrowser>;

function figure(): Figure {
  const canvas = new (globalThis as unknown as { OffscreenCanvas: typeof FakeCanvas }).OffscreenCanvas();
  return new Figure(canvas as unknown as HTMLCanvasElement, solid(100, 100, BLACK_SHOES), { width: 100, height: 100 }, measure, { engine: ENGINE_VERSION, bins, lines: readBins(bins) });
}

/** Runs animation frames 16 ms apart, with the microtasks between them, until no spring is left running. */
async function settle(): Promise<void> {
  let now = performance.now();
  for (let i = 0; i < 1000 && browser.frames.pending > 0; i++) {
    browser.frames.flush((now += 16));
    await Promise.resolve();
  }
  await Promise.resolve();
  browser.frames.flush((now += 16)); // the last repaint the settled glide asks for
}

/** The image the card's photo is drawn from: the first thing drawn into the still. */
const cardPhoto = (f: Figure) => (f.still() as unknown as FakeCanvas).drawn[0];

beforeEach(() => {
  browser = installFakeBrowser();
});
afterEach(() => {
  browser.restore();
  vi.useRealTimers();
});

describe("the card's photo is the state on screen (Figure.still)", () => {
  it("as worn, before any look, is the original photo", () => {
    expect(cardPhoto(figure())).toBe(AS_WORN);
  });

  it("a tried look shows that look's recolour, whole", () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    expect(cardPhoto(f)).toBe(THE_LOOK);
  });

  it("try a look, then back to as worn (Esc): the card is the original at once, while the wipe still glides home", () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    browser.frames.flush();
    f.setLook(null); // Esc, "Show original", the look's own button again, or a look with nothing on the photo
    expect(browser.frames.pending).toBeGreaterThan(0); // the exit glide is still running on screen
    expect(f.hasLook).toBe(false);
    expect(cardPhoto(f)).toBe(AS_WORN);
  });

  it("stays the original when the exit glide is cut short (a drag or the range control mid-glide)", async () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    f.setLook(null);
    f.setWipe(0.3);
    await Promise.resolve();
    browser.frames.flush();
    expect(f.hasLook).toBe(false);
    expect(cardPhoto(f)).toBe(AS_WORN);
  });

  it("the stage itself still draws the leaving look during the glide, then lets it go", async () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    browser.frames.flush();
    f.setLook(null);
    const stage = f.element as unknown as FakeCanvas;
    stage.drawn = [];
    browser.frames.flush(performance.now() + 16);
    expect(stage.drawn).toContain(THE_LOOK); // the wipe sliding home over the original
    await settle();
    expect(f.wipeAt).toBe(1);
    stage.drawn = [];
    f.restore(); // a plain repaint once home
    expect(stage.drawn).toEqual([AS_WORN]);
  });

  it("under reduced motion, back to as worn is the original on the card at once and after the glide's own tick", async () => {
    browser.restore();
    browser = installFakeBrowser({ reducedMotion: true });
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    f.setLook(null);
    // No glide under reduced motion, but its completion still lands a
    // microtask later: the card and hasLook must not wait for it.
    expect(f.hasLook).toBe(false);
    expect(cardPhoto(f)).toBe(AS_WORN);
    await Promise.resolve();
    await Promise.resolve();
    expect(f.hasLook).toBe(false);
    expect(cardPhoto(f)).toBe(AS_WORN);
    const stage = f.element as unknown as FakeCanvas;
    stage.drawn = [];
    f.restore();
    expect(stage.drawn).toEqual([AS_WORN]); // nothing of the look is left on the stage either
  });
});

describe("the compare wipe moves only while a look is shown", () => {
  it("as worn, setWipe and flingWipe do nothing", () => {
    const f = figure();
    browser.frames.flush(); // the first paint
    f.setWipe(0.3);
    expect(f.wipeAt).toBe(1);
    f.flingWipe(-2);
    expect(browser.frames.pending).toBe(0); // no spring started, no repaint asked for
    expect(f.wipeAt).toBe(1);
  });

  it("on the way back to as worn, a drag neither moves nor strands the wipe", async () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    await settle();
    f.setLook(null);
    f.setWipe(0.3);
    f.flingWipe(-2);
    await settle();
    expect(f.wipeAt).toBe(1);
  });

  it("with a look shown, setWipe moves the wipe and flingWipe carries it", async () => {
    const f = figure();
    f.setLook(solid(100, 100, TERRACOTTA_SHOES));
    await settle();
    expect(f.wipeAt).toBeCloseTo(0.5, 2);
    f.setWipe(0.3);
    expect(f.wipeAt).toBe(0.3);
    f.flingWipe(2);
    await settle();
    expect(f.wipeAt).toBeGreaterThan(0.3);
    expect(cardPhoto(f)).toBe(THE_LOOK);
  });
});

const asWorn: Shown = { title: "As worn", lines: readBins(bins), bins, hash: "3abe0000", engine: ENGINE_VERSION };

function fakeButton(label = "Download this read (free)") {
  return { disabled: false, textContent: label as string | null, focus: vi.fn() };
}

/** The same read stays on screen: one target object, as main.ts's `current` is one per read shown. */
const stays = (t: SaveTarget) => () => t;

function target(f: Figure, shown: () => Shown = () => asWorn): SaveTarget {
  return { figure: f, shown, settled: () => Promise.resolve(), credit: null };
}

describe("try a look, Esc, S: the saved card", () => {
  it("is the original photo under As worn", async () => {
    const f = figure();
    const saved: CardContent[] = [];
    const download = cardSaver({ current: stays(target(f)), save: async (c) => void saved.push(c) });
    f.setLook(solid(100, 100, TERRACOTTA_SHOES)); // 2
    f.setLook(null); // Esc
    await download(fakeButton(), { textContent: "" }); // S
    expect(saved).toHaveLength(1);
    expect(saved[0].title).toBe("As worn");
    expect((saved[0].still as unknown as FakeCanvas).drawn[0]).toBe(AS_WORN);
  });
});

describe("pressing S: the card is being drawn, said at once", () => {
  it("says Drawing the card. in the status line before any drawing work, then the saved line", async () => {
    vi.useFakeTimers();
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const download = cardSaver({ current: stays(target(figure())), save });
    const button = fakeButton();
    const note = { textContent: "" as string | null };
    const done = download(button, note);
    expect(note.textContent).toBe(DRAWING_CARD); // synchronously, in the same press
    expect(button.textContent).toBe(DRAWING_CARD);
    expect(button.disabled).toBe(true);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(note.textContent).toBe(DRAWING_CARD); // still drawing: nothing claims it is saved yet
    finish();
    await done;
    expect(note.textContent).toBe(savedCopy("3abe0000"));
    expect(note.textContent).toBe("Saved to your downloads as ratio-3abe.png.");
    expect(button.textContent).toBe("Downloaded");
    vi.advanceTimersByTime(1600);
    expect(button.disabled).toBe(false);
    expect(button.textContent).toBe("Download this read (free)");
  });

  it("a second S (or a click on the other download button) while drawing starts no second export", async () => {
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const download = cardSaver({ current: stays(target(figure())), save });
    const top = fakeButton();
    const bottom = fakeButton();
    const note = { textContent: "" as string | null };
    const first = download(top, note);
    const second = download(top, note);
    const third = download(bottom, note);
    await second;
    await third;
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    expect(bottom.disabled).toBe(false);
    finish();
    await first;
    expect(save).toHaveBeenCalledOnce();
  });

  it("pressing the same button (or S) again while Downloaded still shows saves nothing more, then works once it reads as itself", async () => {
    vi.useFakeTimers();
    const save = vi.fn(async () => {});
    const download = cardSaver({ current: stays(target(figure())), save });
    const button = fakeButton();
    const note = { textContent: "" as string | null };
    await download(button, note);
    expect(button.textContent).toBe("Downloaded");
    for (let i = 0; i < 5; i++) {
      vi.advanceTimersByTime(40); // held S, or taps 40 ms apart
      await download(button, note);
    }
    vi.advanceTimersByTime(RESET_MS - 250);
    await download(button, note);
    expect(save).toHaveBeenCalledOnce();
    expect(note.textContent).toBe(savedCopy("3abe0000")); // a dropped press repeats the true line
    vi.advanceTimersByTime(250);
    expect(button.textContent).toBe("Download this read (free)");
    await download(button, note);
    expect(save).toHaveBeenCalledTimes(2);
  });

  it("a press dropped while another button's card is drawing says Drawing the card. in its own status line (the Card preview)", async () => {
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const download = cardSaver({ current: stays(target(figure())), save });
    const first = download(fakeButton(), { textContent: "" });
    const previewNote = { textContent: "" as string | null };
    await download(fakeButton(), previewNote);
    expect(previewNote.textContent).toBe(DRAWING_CARD);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    finish();
    await first;
  });

  it("a failure says so with a next step, and never leaves Drawing the card. or a saved line behind", async () => {
    const download = cardSaver({ current: stays(target(figure())), save: async () => Promise.reject(new Error("no")) });
    const button = fakeButton();
    const note = { textContent: "Saved to your downloads as ratio-0000.png." as string | null };
    await download(button, note);
    expect(note.textContent).toBe(CARD_FAILED);
    expect(CARD_FAILED).toBe("The card could not be drawn. Try the download again.");
    expect(button.textContent).toBe("Could not draw the card");
  });

  it("after a failure a retry starts at once, keeps the button's own label and gives focus back", async () => {
    vi.useFakeTimers();
    const button = fakeButton();
    const f = figure();
    const realDocument = globalThis.document;
    vi.stubGlobal("document", { ...realDocument, activeElement: button });
    let fail = true;
    const save = vi.fn(async () => {
      if (fail) throw new Error("no");
    });
    const download = cardSaver({ current: stays(target(f)), save });
    const note = { textContent: "" as string | null };
    await download(button, note);
    expect(button.disabled).toBe(false);
    vi.stubGlobal("document", { ...realDocument, activeElement: null }); // the disabled button lost focus
    fail = false;
    await download(button, note);
    expect(save).toHaveBeenCalledTimes(2);
    expect(note.textContent).toBe(savedCopy("3abe0000"));
    vi.advanceTimersByTime(RESET_MS);
    expect(button.textContent).toBe("Download this read (free)");
    expect(button.focus).toHaveBeenCalledOnce();
  });

  it("gives focus back only if it went nowhere: never pulls it from a control the person moved to", async () => {
    vi.useFakeTimers();
    const button = fakeButton();
    const f = figure();
    const realDocument = globalThis.document;
    vi.stubGlobal("document", { ...realDocument, activeElement: button });
    const download = cardSaver({ current: stays(target(f)), save: async () => {} });
    await download(button, { textContent: "" });
    vi.stubGlobal("document", { ...realDocument, activeElement: { tagName: "BUTTON" } }); // tabbed on to a look's Try it
    vi.advanceTimersByTime(RESET_MS);
    expect(button.focus).not.toHaveBeenCalled();
  });

  it("does nothing, and says nothing, with no read on screen", async () => {
    const save = vi.fn(async () => {});
    const download = cardSaver({ current: () => null, save });
    const note = { textContent: "" as string | null };
    await download(fakeButton(), note);
    expect(save).not.toHaveBeenCalled();
    expect(note.textContent).toBe("");
  });

  it("waits for a look still landing, then saves what is shown then", async () => {
    let land = () => {};
    const landed = new Promise<void>((r) => (land = r));
    let shown = asWorn;
    const save = vi.fn(async (_c: CardContent) => {});
    const download = cardSaver({ current: stays({ ...target(figure(), () => shown), settled: () => landed }), save });
    const done = download(fakeButton(), { textContent: "" });
    shown = { ...asWorn, title: "Terracotta shoes", hash: "89f00000" };
    land();
    await done;
    expect(save.mock.calls[0][0].title).toBe("Terracotta shoes");
  });
});

describe("the lock belongs to the read it saved (T7 review 2)", () => {
  it("save read A, step to read B, press S inside the Downloaded window: B is saved, and A's line is never shown for it", async () => {
    vi.useFakeTimers();
    const readA = target(figure(), () => ({ ...asWorn, hash: "aaaa0000" }));
    const readB = target(figure(), () => ({ ...asWorn, hash: "bbbb0000" }));
    let onScreen = readA;
    const saved: string[] = [];
    const download = cardSaver({ current: () => onScreen, save: async (c) => void saved.push(c.hash) });
    const saveTop = fakeButton();
    const note = { textContent: "" as string | null };
    await download(saveTop, note);
    expect(note.textContent).toBe(savedCopy("aaaa0000"));
    onScreen = readB; // ] steps to B; showRead clears the save row
    note.textContent = "";
    vi.advanceTimersByTime(300);
    await download(saveTop, note);
    expect(saved).toEqual(["aaaa0000", "bbbb0000"]);
    expect(note.textContent).toBe(savedCopy("bbbb0000"));
    // A's own reset timer must neither free B's lock nor relabel the button mid-B.
    vi.advanceTimersByTime(RESET_MS - 300);
    await download(saveTop, note);
    expect(saved).toHaveLength(2);
    vi.advanceTimersByTime(RESET_MS);
    expect(saveTop.textContent).toBe("Download this read (free)");
    expect(saveTop.disabled).toBe(false);
  });

  it("while A is drawing, a press for B says Drawing the card. only, and its line is cleared when A's card is done", async () => {
    const readA = target(figure(), () => ({ ...asWorn, hash: "aaaa0000" }));
    const readB = target(figure(), () => ({ ...asWorn, hash: "bbbb0000" }));
    let onScreen = readA;
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const download = cardSaver({ current: () => onScreen, save });
    const noteA = { textContent: "" as string | null };
    const first = download(fakeButton(), noteA);
    onScreen = readB;
    const noteB = { textContent: "" as string | null };
    await download(fakeButton(), noteB);
    expect(noteB.textContent).toBe(DRAWING_CARD);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    finish();
    await first;
    expect(noteB.textContent).toBe(""); // never "Saved ... ratio-aaaa.png" under B
    expect(noteA.textContent).toBe(""); // A is no longer on screen: its save row is B's now
    expect(save).toHaveBeenCalledOnce();
  });

  it("every status line that echoed Drawing the card. for the same read hears how it ended", async () => {
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((r) => (finish = r)));
    const download = cardSaver({ current: stays(target(figure())), save });
    const saveNote = { textContent: "" as string | null };
    const previewNote = { textContent: "" as string | null };
    const first = download(fakeButton(), saveNote);
    await download(fakeButton(), previewNote);
    expect(previewNote.textContent).toBe(DRAWING_CARD);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    finish();
    await first;
    expect(saveNote.textContent).toBe(savedCopy("3abe0000"));
    expect(previewNote.textContent).toBe(savedCopy("3abe0000"));
  });
});
