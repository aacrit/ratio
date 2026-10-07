// T10, "every number on screen is a final, true number for what is shown"
// (R-09, UX pass 4, Noor). The hero numeral was missing for the whole reveal
// and then counted up from 0 through pairs no reading could produce
// ("0.25 : 0.25", "0.42 : 0.24"); a look's card named the look's own hash
// where the as-worn card named the photo's; and "Saved to your downloads as
// ratio-0ef2.png." stayed under the button after switching to a look.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Bins, ENGINE_VERSION, ratioText, readBins } from "../web/src/engine/rules";
import { type CardContent, cardContentOf, cardFileName, cardHashLine, joinToWidth } from "../web/src/ui/card";
import { flashNumeral, replaceNumeral, setNumeral } from "../web/src/ui/count";
import type { Shown } from "../web/src/ui/looks";
import { type SaveTarget, cardSaver, savedCopy } from "../web/src/ui/save";
import { installFakeBrowser } from "./helpers/fake-canvas";

/** An element that records every text it was ever given, so a test sees what a screenshot at any moment could have caught. */
function recordingEl() {
  const writes: string[] = [];
  let text: string | null = "";
  return {
    writes,
    dataset: {} as DOMStringMap,
    get textContent() {
      return text;
    },
    set textContent(v: string | null) {
      text = v;
      writes.push(v ?? "");
    },
  };
}

/** True when every "a : b" pair in the text sums to 1 (±0.01), as a real proportion reading does. */
const pairsSumToOne = (text: string) => [...text.matchAll(/(\d+(?:\.\d+)?)\s*:\s*(\d+(?:\.\d+)?)/g)].every((m) => Math.abs(Number(m[1]) + Number(m[2]) - 1) <= 0.01);

describe("the hero numeral is final the moment it shows", () => {
  let browser: ReturnType<typeof installFakeBrowser>;
  beforeEach(() => (browser = installFakeBrowser()));
  afterEach(() => vi.unstubAllGlobals());

  it("is written at once, with no frame needed", () => {
    const el = recordingEl();
    setNumeral(el, ratioText(0.64));
    expect(el.textContent?.replace(/\s+/g, " ")).toBe("0.64 : 0.36"); // thin spaces round the colon
    expect(browser.frames.pending).toBe(0); // nothing left to animate the digits
  });

  it("a replacement (a new look, a new read, Esc) jumps to the new final value, and nothing in between is ever written", () => {
    const el = recordingEl();
    const finals = [ratioText(0.5), ratioText(0.64), ratioText(0.42), ratioText(0.5), "one column", ratioText(0.62)];
    setNumeral(el, finals[0]); // the read
    replaceNumeral(el, finals[1]); // 1: try a look
    replaceNumeral(el, finals[2]); // 2: another look, mid-way through nothing
    replaceNumeral(el, finals[3]); // Esc: as worn
    setNumeral(el, finals[4]); // a new read, a single column
    setNumeral(el, finals[5]); // and another
    for (let i = 0; i < 120; i++) browser.frames.flush(); // two seconds of frames, were anything still counting
    expect(el.writes).toEqual(finals);
    for (const w of el.writes) expect(pairsSumToOne(w), w).toBe(true);
    expect(el.textContent).toBe(finals[5]);
  });

  it("flashes the glow only when the value changes", () => {
    const el = recordingEl();
    setNumeral(el, ratioText(0.5));
    expect(el.dataset.lands).toBeUndefined(); // a quick read's arrival: settled, no flash
    replaceNumeral(el, ratioText(0.5));
    expect(el.dataset.lands).toBeUndefined();
    replaceNumeral(el, ratioText(0.64));
    expect(el.dataset.lands).toBe("");
  });

  it("the signature's flash lands on a numeral that is already final", () => {
    const el = recordingEl();
    setNumeral(el, ratioText(0.5));
    flashNumeral(el);
    expect(el.dataset.lands).toBe("");
    expect(el.writes).toEqual([ratioText(0.5)]);
  });

  it("every proportion numeral the engine writes is a pair that sums to 1", () => {
    for (let r = 0.3; r <= 0.75; r += 0.01) expect(pairsSumToOne(ratioText(r)), ratioText(r)).toBe(true);
  });
});

const bins: Bins = { proportion: 0.5, waist: 0.38, top: { L: 0.8, C: 0.05, h: 80 }, bottom: { L: 0.2, C: 0, h: 0 }, palette: [], fit: null };
const asWorn: Shown = { title: "As worn", lines: readBins(bins), bins, hash: "0ef2aaaa", engine: ENGINE_VERSION };
const aLook: Shown = { title: "Black lower piece", lines: readBins(bins), bins, hash: "f8ebbbbb", engine: ENGINE_VERSION, photoHash: "0ef2aaaa", look: "lower piece in black" };
const still = {} as OffscreenCanvas;

describe("the card's footer names the photo's own hash, on a look's card too", () => {
  it("as worn: the photo's hash and the engine", () => {
    const c = cardContentOf(asWorn, still, null);
    expect(cardHashLine(c)).toBe(`Same photo, same reading. 0ef2 · ${ENGINE_VERSION}`);
    expect(cardFileName(c)).toBe("ratio-0ef2.png");
  });

  it("a look: the same photo hash as the as-worn card, and the look by name", () => {
    const c = cardContentOf(aLook, still, null);
    expect(c.hash).toBe("0ef2aaaa");
    expect(cardHashLine(c)).toBe(`Same photo, same reading. 0ef2 · ${ENGINE_VERSION} · look: lower piece in black`);
    expect(cardHashLine(c)).not.toContain("f8eb");
    expect(cardFileName(c)).toBe("ratio-0ef2-lower-piece-in-black.png");
  });

  it("the filename keeps only safe characters whatever the look is called", () => {
    expect(cardFileName({ hash: "0ef2aaaa", look: '"><img src=x onerror=alert(1)>/../navy' })).toBe("ratio-0ef2-img-src-x-onerror-alert-1-navy.png");
    expect(cardFileName({ hash: "0ef2aaaa", look: "  " })).toBe("ratio-0ef2.png");
  });

  it("the footer breaks between its parts, never inside the look's name", () => {
    const measure = (s: string) => s.length * 10;
    const lines = joinToWidth(["Same photo, same reading. 0ef2", ENGINE_VERSION, "look: lower piece in black"], measure, 540);
    expect(lines.length).toBe(2);
    expect(lines[1]).toBe("look: lower piece in black");
    expect(joinToWidth(["Same photo, same reading. 0ef2", ENGINE_VERSION], measure, 900)).toHaveLength(1);
  });

  it("the saved line names the file the card is saved as", () => {
    expect(savedCopy("0ef2aaaa")).toBe("Saved to your downloads as ratio-0ef2.png.");
    expect(savedCopy("0ef2aaaa", "lower piece in black")).toBe("Saved to your downloads as ratio-0ef2-lower-piece-in-black.png.");
  });
});

describe("the saved line only ever describes the card for what is on screen", () => {
  beforeEach(() => installFakeBrowser());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  const fakeButton = () => ({ disabled: false, textContent: "Download this read (free)" as string | null, focus: vi.fn() });

  /** One read on screen whose view changes when a look is tried or removed, as ui/looks.ts's view() does. */
  function read() {
    let view = 0;
    let shown = asWorn;
    const t: SaveTarget = { figure: { still: () => still }, shown: () => shown, settled: () => Promise.resolve(), credit: null, view: () => view };
    return {
      t,
      tryLook: () => {
        view++;
        shown = aLook;
      },
      asWorn: () => {
        view++;
        shown = asWorn;
      },
    };
  }

  it("save as worn, try a look, press S inside the Downloaded window: the look's card is saved, never the old line repeated", async () => {
    vi.useFakeTimers();
    const r = read();
    const saved: CardContent[] = [];
    const download = cardSaver({ current: () => r.t, save: async (c) => void saved.push(c) });
    const note = { textContent: "" as string | null };
    await download(fakeButton(), note);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa"));
    r.tryLook();
    note.textContent = ""; // main.ts's onChange, in the same tick
    vi.advanceTimersByTime(300);
    await download(fakeButton(), note);
    expect(saved.map((c) => c.look)).toEqual([undefined, "lower piece in black"]);
    expect(saved.map((c) => c.hash)).toEqual(["0ef2aaaa", "0ef2aaaa"]);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa", "lower piece in black"));
  });

  it("a look tried while the card draws: the finished card's line is never written under the look", async () => {
    const r = read();
    let finish = () => {};
    const save = vi.fn(() => new Promise<void>((res) => (finish = res)));
    const download = cardSaver({ current: () => r.t, save });
    const note = { textContent: "" as string | null };
    const button = fakeButton();
    const first = download(button, note);
    await vi.waitFor(() => expect(save).toHaveBeenCalledOnce());
    r.tryLook();
    note.textContent = "";
    finish();
    await first;
    expect(note.textContent).toBe("");
    expect(button.textContent).toBe("Download this read (free)"); // never "Downloaded" over a look it did not save
  });

  it("removing the look (Show original, Esc) is a change of view too", async () => {
    vi.useFakeTimers();
    const r = read();
    r.tryLook();
    const saved: CardContent[] = [];
    const download = cardSaver({ current: () => r.t, save: async (c) => void saved.push(c) });
    const note = { textContent: "" as string | null };
    await download(fakeButton(), note);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa", "lower piece in black"));
    r.asWorn();
    note.textContent = "";
    vi.advanceTimersByTime(100);
    await download(fakeButton(), note);
    expect(saved.map((c) => c.look)).toEqual(["lower piece in black", undefined]);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa"));
  });
});
