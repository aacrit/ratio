// T10, "every number on screen is a final, true number for what is shown"
// (R-09, UX pass 4, Noor). The hero numeral was missing for the whole reveal
// and then counted up from 0 through pairs no reading could produce
// ("0.25 : 0.25", "0.42 : 0.24"); a look's card named the look's own hash
// where the as-worn card named the photo's; and "Saved to your downloads as
// ratio-0ef2.png." stayed under the button after switching to a look.

import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { type Bins, ENGINE_VERSION, ratioText, readBins } from "../web/src/engine/rules";
import { lastReadOf, withWorn } from "../web/src/rules/handoff";
import { type CardContent, cardContentOf, cardFileName, cardHashLine, footerLayout, joinToWidth } from "../web/src/ui/card";
import { flashNumeral, replaceNumeral, setNumeral } from "../web/src/ui/count";
import { hashesOfLastRead, hashesOfShown, hashLine, hashSegments } from "../web/src/ui/hashline";
import { type Shown, heroEyebrowOf, writeHead } from "../web/src/ui/looks";
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
const TITLE = "Lower piece in black";
const aLook: Shown = { title: TITLE, lines: readBins(bins), bins, hash: "f8ebbbbb", engine: ENGINE_VERSION, photoHash: "0ef2aaaa", look: TITLE };
const LOOK = { hash: "f8ebbbbb", name: TITLE };
const still = {} as OffscreenCanvas;

describe("one view, one hash line: the screen, the card and the Rulebook chip say the same", () => {
  it("as worn: the photo's hash and the engine, on every surface", () => {
    const c = cardContentOf(asWorn, still, null);
    const screen = hashLine(hashesOfShown(asWorn));
    expect(screen).toBe(`Same photo, same reading. 0ef2 · ${ENGINE_VERSION}`);
    expect(cardHashLine(c)).toBe(screen);
    const handoff = lastReadOf({ engine: asWorn.engine, hash: asWorn.hash, source: "sample", look: null, bins, lines: asWorn.lines });
    expect(hashLine(hashesOfLastRead(handoff))).toBe(screen);
    expect(cardFileName(c)).toBe("ratio-0ef2.png");
  });

  it("a look: the screen line equals the card line equals the chip line, each hash labelled", () => {
    const c = cardContentOf(aLook, still, null);
    const screen = hashLine(hashesOfShown(aLook));
    expect(screen).toBe(`Same photo, same reading. 0ef2 · look f8eb: ${TITLE} · ${ENGINE_VERSION}`);
    expect(cardHashLine(c)).toBe(screen);
    // The hand-off main.ts makes on a look: the as-worn read first, then the look carried beside it.
    const worn = lastReadOf({ engine: asWorn.engine, hash: asWorn.hash, source: "sample", look: null, bins, lines: asWorn.lines });
    const look = withWorn(lastReadOf({ engine: aLook.engine, hash: aLook.hash, source: "sample", look: TITLE, bins, lines: aLook.lines }), worn);
    expect(hashLine(hashesOfLastRead(look))).toBe(screen);
    expect(c.hash).toBe("0ef2aaaa"); // the photo's hash names the file, as on the as-worn card
    expect(cardFileName(c)).toBe("ratio-0ef2-lower-piece-in-black.png");
  });

  it("the filename keeps only safe characters whatever the look is called", () => {
    expect(cardFileName({ hash: "0ef2aaaa", look: { hash: "f8eb", name: '"><img src=x onerror=alert(1)>/../navy' } })).toBe("ratio-0ef2-img-src-x-onerror-alert-1-navy.png");
    expect(cardFileName({ hash: "0ef2aaaa", look: { hash: "f8eb", name: "  " } })).toBe("ratio-0ef2.png");
  });

  it("the footer breaks between its parts and never drops one, however long the look's name", () => {
    const measure = (s: string) => s.length * 10;
    const lines = joinToWidth(["Same photo, same reading. 0ef2", `look f8eb: ${TITLE}`, ENGINE_VERSION], measure, 540);
    expect(lines).toEqual(["Same photo, same reading. 0ef2", `look f8eb: ${TITLE} · ${ENGINE_VERSION}`]);
    const long = `look f8eb: ${"Lower piece in navy and shoes in oxblood and a belt at the waist ".repeat(3).trim()}`;
    for (const w of [540, 300]) {
      const foot = footerLayout(["Same photo, same reading. 0ef2", long, ENGINE_VERSION], (t, s) => t.length * s * 0.6, w + 400);
      const all = foot.lines.join(" ");
      for (const word of `Same photo, same reading. 0ef2 ${long} ${ENGINE_VERSION}`.split(" ")) expect(all, String(w)).toContain(word);
      // The last hash line keeps its distance from the credit, and the rule sits above the first.
      expect(foot.firstY + (foot.lines.length - 1) * foot.lineHeight).toBe(1350 - 40 - 30 + 2);
      expect(foot.ruleY).toBeLessThan(foot.firstY - foot.size);
    }
  });

  it("the footer stays one line, at 16 px and in its old place, as worn", () => {
    const foot = footerLayout(hashSegments({ photoHash: "0ef2aaaa", engine: ENGINE_VERSION }), (t, s) => t.length * s * 0.6, 936);
    expect(foot).toMatchObject({ size: 16, lines: [`Same photo, same reading. 0ef2 · ${ENGINE_VERSION}`], firstY: 1350 - 68, ruleY: 1350 - 104 });
  });

  it("the saved line names the file the card is saved as", () => {
    expect(savedCopy("0ef2aaaa")).toBe("Saved to your downloads as ratio-0ef2.png.");
    expect(savedCopy("0ef2aaaa", LOOK)).toBe("Saved to your downloads as ratio-0ef2-lower-piece-in-black.png.");
  });
});

describe("the sheet head is written whole, in one tick, by every reading surface", () => {
  const els = () => ({ heroN: recordingEl(), heroEyebrow: { textContent: "" as string | null }, verdict: { textContent: "" as string | null } });

  it("a read arriving writes the final numeral with its eyebrow and verdict, and does not flash", () => {
    const e = els();
    writeHead(e, asWorn.lines, "Works.", "arrive");
    expect(e.heroN.textContent).toBe(asWorn.lines[0].measured);
    expect(e.heroN.textContent?.trim()).not.toBe("");
    expect(e.heroEyebrow.textContent).toBe(heroEyebrowOf(asWorn.lines));
    expect(e.verdict.textContent).toBe("Works.");
    expect(e.heroN.dataset.state).toBe(asWorn.lines[0].borderline ? "borderline" : asWorn.lines[0].state);
    expect(e.heroN.dataset.lands).toBeUndefined();
  });

  it("a look swapping the value replaces it final and flashes; the same value does not flash", () => {
    const e = els();
    writeHead(e, asWorn.lines, "Works.", "arrive");
    const other = readBins({ ...bins, proportion: 0.62 });
    writeHead(e, other, "Trying: Works.", "replace");
    expect(e.heroN.writes).toEqual([asWorn.lines[0].measured, other[0].measured]);
    expect(e.heroN.dataset.lands).toBe("");
  });

  it("no flash while the numeral is not displayed (Rules showing)", () => {
    const hidden = { ...recordingEl(), getClientRects: () => ({ length: 0 }) };
    flashNumeral(hidden);
    expect(hidden.dataset.lands).toBeUndefined();
  });

  // main.ts's showRead and chalk restore are DOM-bound and cannot run under
  // node; these hold their wiring to the rule above, so putting back the old
  // `heroN.textContent = ""` (the R-09 bug) fails the gate.
  const main = readFileSync(new URL("../web/src/main.ts", import.meta.url), "utf8");
  const looksSrc = readFileSync(new URL("../web/src/ui/looks.ts", import.meta.url), "utf8");

  it("showRead writes the final head before the reveal plays", () => {
    const body = main.slice(main.indexOf("const showRead = async"), main.indexOf("const selectAndShow"));
    const head = body.indexOf('writeHead({ heroN, heroEyebrow, verdict }, read.reading.lines, verdictOf(read.reading.lines), "arrive")');
    expect(head).toBeGreaterThan(0);
    expect(head).toBeLessThan(body.indexOf("figure.play("));
    expect(body).not.toMatch(/heroN\.textContent\s*=/);
  });

  it("nothing in main.ts writes the hero numeral except through writeHead", () => {
    expect(main).not.toMatch(/heroN\.textContent\s*=/);
    expect(main).not.toMatch(/countTo\(/);
    const restore = main.slice(main.indexOf("const showChalkRestore"), main.indexOf('addEventListener("popstate"'));
    expect(restore).toContain('writeHead({ heroN, heroEyebrow, verdict }, lines,');
    expect(restore).toContain("hashLine({ photoHash: worn.hash");
  });

  it("a look's head goes through writeHead as a replacement, and its hash line is written in the same tick", () => {
    expect(looksSrc).toMatch(/writeHead\(d, lines, [^;]*"replace"\)/);
    expect(looksSrc).not.toMatch(/heroN\.textContent\s*=/);
    const tryLook = looksSrc.slice(looksSrc.indexOf("const tryLook = async"), looksSrc.indexOf("const back ="));
    const head = tryLook.indexOf("setHead(look.lines");
    const line = tryLook.indexOf("d.hash.textContent = hashLine(hashesOfShown(shown))");
    expect(line).toBeGreaterThan(head);
    expect(tryLook.slice(head, line)).not.toContain("await"); // nothing between them yields
    expect(tryLook.indexOf("lookHashOf(look)")).toBeLessThan(head);
  });

  it("the tuck toggle is a change of view", () => {
    expect(main).toMatch(/looksApi\?\.setTuck\(on\)/);
  });
});

describe("the tuck shown on the photo is a change of view, and the card marks it", () => {
  it("setTuck bumps the view, clears the saved line and puts the tuck note on the card", async () => {
    const { setupLooks, TUCK_NOTE } = await import("../web/src/ui/looks");
    const { suggestLooks } = await import("../web/src/engine/looks");
    // A reading the rulebook suggests no look for: the tuck still belongs to its rows.
    const quiet: Bins = { proportion: 0.38, waist: 0.38, top: { L: 0.8, C: 0, h: 0 }, bottom: { L: 0.25, C: 0, h: 0 }, palette: [], fit: null };
    expect(suggestLooks(quiet, readBins(quiet))).toEqual([]);
    const noop = () => {};
    let cleared = 0;
    const el = () => ({ hidden: false, textContent: "", replaceChildren: noop, querySelector: () => null });
    const api = setupLooks({
      read: { reading: { lines: readBins(quiet), bins: quiet, engine: ENGINE_VERSION }, hash: "0ef2aaaa" },
      verdict: el(),
      section: el(),
      trying: el(),
      trial: el(),
      list: el(),
      onChange: () => cleared++,
    } as unknown as Parameters<typeof setupLooks>[0]);
    const v0 = api.view();
    api.setTuck(true);
    expect(api.view()).not.toBe(v0);
    expect(cleared).toBe(1);
    expect(api.shown().note).toBe(TUCK_NOTE);
    expect(cardContentOf(api.shown(), still, null).note).toBe(TUCK_NOTE);
    api.setTuck(false);
    expect(cleared).toBe(2);
    expect(api.shown().note).toBeUndefined();
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
    expect(saved.map((c) => c.look ?? null)).toEqual([null, LOOK]);
    expect(saved.map((c) => c.hash)).toEqual(["0ef2aaaa", "0ef2aaaa"]);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa", LOOK));
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
    expect(note.textContent).toBe(savedCopy("0ef2aaaa", LOOK));
    r.asWorn();
    note.textContent = "";
    vi.advanceTimersByTime(100);
    await download(fakeButton(), note);
    expect(saved.map((c) => c.look ?? null)).toEqual([LOOK, null]);
    expect(note.textContent).toBe(savedCopy("0ef2aaaa"));
  });
});
