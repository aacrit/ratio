// Telemetry here is aggregate counts only (events.ts): no anonymous id, no
// cookies, nothing that could identify a visitor. Two small things live in
// this browser: the last reading's bins, handed to the Rulebook in
// sessionStorage (rules/handoff.ts; no photo, ever - founder, T3: the photo
// is never stored, not even in this browser); and Compact mode's one on/off
// choice in localStorage (ui/compact.ts), a disclosed UI preference, not
// telemetry. This session's reads, the photo included, live in memory only
// (session.ts): gone on reload, never written to disk in any form. None of
// it is ever sent. Every POST is same-origin JSON: the Worker refuses
// anything else (worker/src/guard.ts), so never use sendBeacon, which sends
// text/plain.
//
// The page: a bar, a stage that holds the photo, and a sheet that holds the
// reading (design/BRAND.md, Stage and sheet). Rules opens inside this same
// page (founder, T3): the tab bar pushes /rules and swaps views, nothing
// unloads, so Read -> Rules -> Read restores with no re-measure. The models
// and the measuring run in the read worker (reader.ts); this thread only
// draws.

import { sendEvent } from "./events";
import { Velocity, reducedMotion } from "./motion";
import { othersCopy } from "./engine/person";
import { Figure, showPhoto } from "./overlay";
import type { Pixels } from "./engine/resample";
import type { AdviceLine, Bins } from "./engine/rules";
import { ENGINE_VERSION, readBins } from "./engine/rules";
import { type Look, suggestLooks } from "./engine/looks";
import { lookPhrase, restoredLooksIntroOf } from "./engine/verdict";
import type { Read } from "./read";
import { Reader } from "./reader";
import { setupRulebook } from "./rules";
import { renderRulebook } from "./rules/render";
import { chalkFigure } from "./tryon/figure";
import { cardContentOf, drawCard, saveCard } from "./ui/card";
import { cardSaver } from "./ui/save";
import { setupCompact } from "./ui/compact";
import { flashNumeral, setNumeral } from "./ui/count";
import { type Shown, heroEyebrowOf, setupLooks, verdictOf } from "./ui/looks";
import { revealKind } from "./ui/reveal";
import { paletteStrip, renderRows } from "./ui/rows";
import { Sheet } from "./ui/sheet";
import { type ShortcutHandlers, SHORTCUT_LIST, setupShortcuts } from "./ui/shortcuts";
import { renderStrip } from "./ui/strip";
import { readBelowRules, readTail } from "./ui/route";
import { type TabsApi, setupTabs } from "./ui/tabs";
import { type LastRead, lastReadOf, loadLastRead, saveLastRead, wornOf } from "./rules/handoff";
import { addSessionRead, findSessionReadByHash4, hash4, selectSessionRead, type SessionRead, sessionReads, stepSessionRead } from "./session";

/**
 * Call this exactly where the product's core action completes (the export
 * is written, the order is placed, the task is finished). Its event is
 * contract.yaml's success_event, the one count the kill criteria in
 * CHARTER.md are written against. Never call it for page views or feedback.
 */
export function reportCoreSuccess(): void {
  sendEvent("reading_completed");
}

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T | null;

/** A blob as a data: URL: the CSP's img-src allows data: (and this origin)
 * but never blob:, and this needs no revocation. */
const blobToDataUrl = (blob: Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error("could not read blob"));
    reader.readAsDataURL(blob);
  });

interface Current {
  figure: Figure;
  shown: () => Shown;
  settled: () => Promise<void>;
  view: () => number;
  credit: string | null;
  read: Read;
}

function setupRead(tabsApi: TabsApi | undefined): { cardPreview: () => Promise<HTMLElement | null>; readAction: () => void } | undefined {
  const input = $<HTMLInputElement>("photo");
  const stage = $<HTMLElement>("stage");
  const cloth = $<HTMLElement>("drop");
  const status = $<HTMLElement>("read-status");
  const loading = $<HTMLElement>("loading");
  const loadFill = $<HTMLElement>("load-fill");
  const loadLabel = $<HTMLElement>("load-label");
  const well = $<HTMLElement>("photo-well");
  const canvas = $<HTMLCanvasElement>("figure");
  const chalkRestore = $<HTMLElement>("chalk-restore");
  const chalkRestoreFigure = $<HTMLElement>("chalk-restore-figure");
  const intro = $<HTMLElement>("intro");
  const result = $<HTMLElement>("result");
  const heroN = $<HTMLElement>("hero-n");
  const heroEyebrow = $<HTMLElement>("hero-eyebrow");
  const verdict = $<HTMLElement>("verdict");
  const rows = $<HTMLOListElement>("advice");
  const hash = $<HTMLElement>("reading-hash");
  const again = $<HTMLButtonElement>("read-another");
  const paletteSlot = $<HTMLElement>("palette-slot");
  const looksSection = $<HTMLElement>("looks");
  const looksList = $<HTMLOListElement>("look-list");
  const trying = $<HTMLElement>("trying");
  const trial = $<HTMLElement>("trial");
  const announce = $<HTMLElement>("trying-announce");
  const wipe = $<HTMLInputElement>("wipe");
  const credit = $<HTMLElement>("credit");
  const save = $<HTMLButtonElement>("save-card");
  const saveTop = $<HTMLButtonElement>("save-card-top");
  const saveNote = $<HTMLElement>("save-note");
  const sample = $<HTMLButtonElement>("try-sample");
  const camera = $<HTMLInputElement>("camera");
  const foot = stage?.querySelector<HTMLElement>(".stage-foot") ?? null;
  const sheetEl = $<HTMLElement>("sheet");
  const sheetBody = $<HTMLElement>("sheet-body");
  const grip = $<HTMLButtonElement>("grip");
  const sessionStrip = $<HTMLElement>("session-strip");
  const borderlineSlot = $<HTMLElement>("borderline-slot");
  const compactToggle = $<HTMLButtonElement>("compact-toggle");
  const shortcutsHelp = $<HTMLButtonElement>("shortcuts-help");
  const shortcutsSheet = $<HTMLElement>("shortcuts-sheet");
  const shortcutsList = $<HTMLElement>("shortcuts-list");
  const shortcutsClose = $<HTMLButtonElement>("shortcuts-close");
  const readMenu = $<HTMLElement>("read-menu");
  const menuChoose = readMenu?.querySelector<HTMLButtonElement>('[data-action="choose"]') ?? null;
  const menuCamera = readMenu?.querySelector<HTMLButtonElement>('[data-action="camera"]') ?? null;
  const menuSample = readMenu?.querySelector<HTMLButtonElement>('[data-action="sample"]') ?? null;
  const rulesView = $<HTMLElement>("rulebook-view");
  const readTab = $<HTMLAnchorElement>("read-tab");
  const rulesTab = $<HTMLAnchorElement>("rules-tab");
  if (!input || !stage || !cloth || !status || !loading || !loadFill || !loadLabel || !well || !canvas || !intro || !result) return;
  if (!heroN || !heroEyebrow || !verdict || !rows || !hash || !again || !paletteSlot || !looksSection || !looksList || !trying || !trial) return;
  if (!wipe || !credit || !save || !sample || !camera || !sheetEl || !sheetBody || !grip || !foot) return;
  if (!sessionStrip || !borderlineSlot || !announce || !saveTop || !saveNote || !readMenu || !menuChoose || !menuSample) return;
  if (!chalkRestore || !chalkRestoreFigure || !rulesView || !readTab || !rulesTab) return;

  const reader = new Reader();
  const sheet = new Sheet(sheetEl, sheetBody, grip);

  if (compactToggle) setupCompact(compactToggle, sheet);

  // The stage fits the photo to the room above the sheet: a scale on the
  // well (compositor only) that follows the sheet's edge frame by frame.
  // The foot (status, loading tape, compare control) rides up with it.
  sheet.onMove((top) => {
    if (sheet.isWide) {
      well.style.transform = "";
      foot.style.transform = "";
      return;
    }
    const stageTop = stage.getBoundingClientRect().top;
    const footH = foot.offsetHeight;
    const footBottomAtRest = stageTop + foot.offsetTop + footH;
    const footBottom = Math.min(footBottomAtRest, top - 8);
    const lift = footBottomAtRest - footBottom;
    foot.style.transform = lift > 0 ? `translate3d(0, ${(-lift).toFixed(1)}px, 0)` : "";
    const wellTop = stageTop + well.offsetTop;
    const room = footBottom - footH - 8 - wellTop;
    const k = Math.max(0.3, Math.min(1, room / Math.max(1, well.offsetHeight)));
    well.style.transform = k < 1 ? `scale(${k.toFixed(4)})` : "";
  });

  const mb = (n: number) => (n / 1e6).toFixed(1);
  const onProgress = (loaded: number, total: number) => {
    const all = Math.max(total, loaded);
    loadLabel.textContent = `Loading the measuring models, ${mb(loaded)} of ${mb(all)} MB.`;
    loadFill.style.width = `${all ? (100 * loaded) / all : 0}%`;
  };
  // Start the models' one-time download on the first sign of intent.
  let warmed = false;
  const warm = () => {
    if (warmed) return;
    warmed = true;
    loading.hidden = false;
    reader.warm(onProgress).then(
      () => (loading.hidden = true),
      () => {
        loading.hidden = true;
        warmed = false;
      },
    );
  };
  stage.addEventListener("pointerenter", warm, { once: true });
  stage.addEventListener("pointerdown", warm, { once: true });
  stage.addEventListener("dragenter", warm, { once: true });
  cloth.addEventListener("focusin", warm, { once: true });

  // The read on screen, for the wipe, the card and the keyboard. Null both
  // before any read and during the chalk-figure restore (no photo, no Figure).
  let current: Current | null = null;

  /** Shows the drop cloth (Try the sample, the file and camera inputs). Session data is untouched: a caller decides separately whether there is still a read to fall back to. */
  const showCloth = () => {
    well.hidden = true;
    delete well.dataset.in;
    chalkRestore.hidden = true;
    cloth.hidden = false;
    intro.hidden = false;
    result.hidden = true;
    document.body.dataset.state = "idle";
    again.textContent = "Read my outfit";
  };

  /**
   * The URL names the read on screen; back and forward step through them.
   * Always the full path, never a bare `#...` fragment: a bare fragment
   * resolves against whatever path is already in the address bar, which is
   * still "/rules" immediately after returning from it in-app (showReadRoute
   * updates the view before this runs, not the URL, when it is not itself
   * pushing), and would otherwise leave the address bar on "/rules#r=...".
   */
  const setUrlHash = (h: string, push: boolean) => {
    const url = `/#r=${hash4(h)}`;
    if (location.pathname === "/" && location.hash === `#r=${hash4(h)}`) return;
    if (push) history.pushState({ r: hash4(h) }, "", url);
    else history.replaceState({ r: hash4(h) }, "", url);
  };

  // Every showRead call gets the next generation; a call whose reveal is
  // still settling when a newer one starts must not finish its work over
  // the newer read's (main.ts review: "stale showRead").
  let showGen = 0;
  // A separate token for the URL alone. Route changes (Read <-> Rules) must
  // not cancel an in-flight showRead's visual tail - only stop it writing a
  // URL for a read that is no longer the route showing (T3 re-review: "leaving
  // for Rules during the reveal breaks Read" - bumping showGen there made the
  // tail bail before re-enabling the look buttons, landing the rows, or
  // updating the strip, so returning to Read showed an inert, half-drawn one).
  let urlGen = 0;

  /**
   * Shows a read already in hand: either a freshly measured one, or one
   * restored from this session with no re-measure (R-09: "my read is gone.
   * Again."). `quick` skips the full plumb/chalk/count signature for a
   * settle instead (T3: only the first read of a session gets the
   * signature).
   */
  const showRead = async (read: Read, opts: { sourceCredit: string | null; quick: boolean; push: boolean }): Promise<void> => {
    const gen = ++showGen;
    const urlGenAtStart = urlGen;
    const sourceCredit = opts.sourceCredit;
    chalkRestore.hidden = true;
    showPhoto(canvas, read.display);
    cloth.hidden = true;
    well.hidden = false;
    requestAnimationFrame(() => (well.dataset.in = ""));
    status.textContent = "";
    status.removeAttribute("data-state");
    document.body.dataset.state = "read";
    again.textContent = "Read another";
    save.hidden = false;
    saveTop.hidden = false;
    saveNote.textContent = "";
    const figure = new Figure(canvas, read.display, read.pixels, read.measure, read.reading);
    wipe.hidden = true;
    document.body.dataset.compare = "off";

    intro.hidden = true;
    result.hidden = false;
    // The hero numeral is final the moment the reading shows, in the same
    // tick as its eyebrow and the verdict, on every read (T10, R-09: it used
    // to stay empty until the whole reveal had played, then count up from 0
    // through pairs no reading could produce).
    setNumeral(heroN, read.reading.lines[0].measured);
    heroN.dataset.state = read.reading.lines[0].borderline ? "borderline" : read.reading.lines[0].state;
    heroEyebrow.textContent = heroEyebrowOf(read.reading.lines);
    verdict.textContent = verdictOf(read.reading.lines);
    paletteSlot.replaceChildren(paletteStrip(read.reading.bins));
    credit.hidden = sourceCredit === null;
    credit.textContent = sourceCredit ?? "";
    announce.textContent = "";
    // Someone else in the photo: say once, plainly, which person was read.
    const othersNote = $<HTMLElement>("others-note");
    const othersLine = othersCopy(read);
    if (othersNote) {
      othersNote.hidden = othersLine === null;
      othersNote.textContent = othersLine ?? "";
    }

    // The tuck button belongs to the proportion row of the reading as worn.
    const asWornExtras = () => {
      const first = read.reading.lines[0];
      if (first.state !== "advice" || read.measure.breakRow === null) return {};
      const tuck = document.createElement("button");
      tuck.type = "button";
      tuck.className = "btn ghost small";
      tuck.textContent = "Show the tuck";
      let on = false;
      tuck.addEventListener("click", () => {
        on = !on;
        figure.showTuck(on);
        tuck.textContent = on ? "Show it as worn" : "Show the tuck";
      });
      return { extra: { proportion: tuck } };
    };
    const rendered = renderRows(rows, read.reading.lines, read.reading.bins, { borderlineSlot, ...asWornExtras() });
    hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
    hash.title = `Reading hash ${read.hash}`;
    // The Rulebook marks this read on its instruments (bins only, this tab only).
    const source = sourceCredit === null ? "photo" : "sample";
    const handOff = (s: Shown, look: string | null) => saveLastRead(lastReadOf({ engine: s.engine, hash: s.hash, source, look, bins: s.bins, lines: s.lines }));
    handOff({ title: "As worn", lines: read.reading.lines, bins: read.reading.bins, hash: read.hash, engine: read.reading.engine }, null);
    const looks = setupLooks({
      read,
      reader,
      figure,
      sheet,
      rows,
      section: looksSection,
      list: looksList,
      heroN,
      heroEyebrow,
      verdict,
      trying,
      trial,
      announce,
      paletteSlot,
      hash,
      wipe,
      asWornExtras,
      borderlineSlot,
      onTried: () => sendEvent("look_tried"),
      onShown: handOff,
      // The saved line names the card of the view it was saved from: a look
      // tried or removed clears it, as a new read does (T10, R-09).
      onChange: () => (saveNote.textContent = ""),
    });
    current = { figure, shown: looks.shown, settled: looks.settled, view: looks.view, credit: sourceCredit, read };
    sheet.measure();
    sheet.snap("half");

    // Look tries are blocked until the reveal ends (main.ts review: a tried
    // look racing the reveal's own settle could be stomped by it).
    const lookButtons = Array.from(looksList.querySelectorAll<HTMLButtonElement>("button"));
    for (const b of lookButtons) b.disabled = true;

    // The signature (or its quick settle). Any key or tap during it jumps to the end.
    document.body.dataset.revealing = "";
    const revealAbort = new AbortController();
    const skip = () => figure.skipReveal();
    addEventListener("keydown", skip, { signal: revealAbort.signal });
    addEventListener("pointerdown", skip, { signal: revealAbort.signal });
    try {
      await Promise.race([figure.play({ quick: opts.quick }), new Promise((r) => setTimeout(r, 2500))]);
    } finally {
      revealAbort.abort();
      if (gen === showGen) delete document.body.dataset.revealing;
    }
    if (gen !== showGen) return; // a newer read started while this one was revealing: let it finish its own work
    for (const b of lookButtons) b.disabled = false;
    // The session's one signature lands its numeral on the photo now: the
    // hero numeral (already final) flashes with it. Later reads appear settled.
    if (!opts.quick) flashNumeral(heroN);
    rendered.land();
    renderStrip(sessionStrip, sessionReads(), read.hash, (index) => void selectAndShow(index));
    // Skip only the URL write when a route change happened mid-reveal: the
    // visual tail above still finishes, so Read is never left inert. A read
    // that finishes while Rules shows never writes `/#r=` over `/rules`; it
    // refreshes the Rulebook's chip and Back link instead (ui/route.ts).
    const tail = readTail({ onRules, urlGenAtStart, urlGen });
    if (tail === "refresh-rules") {
      rulebookApi?.refreshYours();
      // Browser Back must land where the Back link points: put this read's
      // entry under /rules when the one there names another read (route.ts).
      const h4 = hash4(read.hash);
      if (readBelowRules(history.state, h4)) {
        history.replaceState({ r: h4 }, "", `/#r=${h4}`);
        history.pushState({ route: "rules", below: h4 }, "", "/rules");
      }
    }
    else if (tail === "write-url") setUrlHash(read.hash, opts.push);
  };

  const selectAndShow = async (index: number): Promise<void> => {
    const rec = selectSessionRead(index);
    if (!rec) return;
    await showRead(rec.read, { sourceCredit: rec.sourceCredit, quick: true, push: true });
  };

  // ---- The read survives without the photo: readBins recomputes the full
  // argument (deterministic: same bins, same reading) from the hand-off's
  // bins alone, and a chalk figure stands in for the photo. ----------------

  const showChalkRestore = (last: LastRead): void => {
    current = null;
    showGen++; // invalidates any in-flight showRead's stale tail
    cloth.hidden = true;
    well.hidden = true;
    delete well.dataset.in;
    chalkRestore.hidden = false;
    document.body.dataset.state = "read";
    document.body.dataset.compare = "off";
    again.textContent = "Read another";
    wipe.hidden = true;
    intro.hidden = true;
    result.hidden = false;
    save.hidden = true;
    saveTop.hidden = true;
    saveNote.textContent = "";
    announce.textContent = "";
    credit.hidden = true;
    const othersNote = $<HTMLElement>("others-note");
    if (othersNote) othersNote.hidden = true;

    // Always the outfit as worn, even when the last thing before a reload
    // was a tried look: the restore starts there, and looks can be tried
    // fresh from it, on the chalk figure only.
    const worn = wornOf(last);
    const bins = worn.bins;
    const asWornLines = readBins(bins);
    const looks = suggestLooks(bins, asWornLines);

    const paint = (b: Bins, lines: AdviceLine[], tried: Look | null) => {
      heroN.dataset.state = lines[0].borderline ? "borderline" : lines[0].state;
      heroN.textContent = lines[0].measured;
      heroEyebrow.textContent = heroEyebrowOf(lines);
      verdict.textContent = (tried ? `Trying ${lookPhrase(tried.moves)}: ` : "") + verdictOf(lines, tried ? [] : looks, b);
      paletteSlot.replaceChildren(paletteStrip(b));
      chalkRestoreFigure.replaceChildren(chalkFigure(b, { label: "The chalk figure in the outfit's measured colours; the photo is gone until you read it again" }));
      renderRows(rows, lines, b, { borderlineSlot }).land();
      announce.textContent = tried ? `Trying: ${lookPhrase(tried.moves)}` : looksSection.hidden ? "" : "Showing the outfit as worn.";
    };
    paint(bins, asWornLines, null);

    looksSection.hidden = false;
    const introEl = looksSection.querySelector<HTMLElement>(".looks-intro");
    // The same sentence a fresh read shows (engine/verdict.ts), never a copy that drifts from it (T6).
    if (introEl) introEl.textContent = restoredLooksIntroOf(asWornLines, looks.length);
    let activeId: string | null = null;
    const buttons = new Map<string, HTMLButtonElement>();
    looksList.replaceChildren(
      ...looks.map((look) => {
        const li = document.createElement("li");
        li.className = "look";
        const head = document.createElement("div");
        head.className = "look-h";
        const title = document.createElement("h3");
        title.className = "look-title";
        title.textContent = look.title;
        head.append(title);
        const button = document.createElement("button");
        button.type = "button";
        button.className = "btn";
        button.textContent = "Try it";
        button.setAttribute("aria-pressed", "false");
        button.setAttribute("aria-label", `Try ${lookPhrase(look.moves)}`);
        button.addEventListener("click", () => {
          const on = activeId !== look.id;
          activeId = on ? look.id : null;
          buttons.forEach((b, id) => {
            b.setAttribute("aria-pressed", String(id === look.id && on));
            b.textContent = id === look.id && on ? "Show original" : "Try it";
          });
          paint(on ? look.bins : bins, on ? look.lines : asWornLines, on ? look : null);
        });
        buttons.set(look.id, button);
        const foot = document.createElement("div");
        foot.className = "look-foot";
        foot.append(button);
        li.append(head, foot);
        return li;
      }),
    );
    hash.textContent = `Same photo, same reading. ${worn.hash.slice(0, 4)} · ${last.engine}`;
    hash.title = `Reading hash ${worn.hash}`;
    sheet.measure();
    sheet.snap("half");
  };

  addEventListener("popstate", () => {
    // A history entry whose pathname is "/rules" always means Rules, however
    // it was reached (the Rules tab, a Why? link, or back/forward through
    // either): show it and stop, independent of whatever hash the entry
    // also carries, since none of this route's history entries use one.
    if (location.pathname === "/rules") {
      showRulesRoute(false);
      return;
    }
    // Any other pathname is the Read route's own "/" or "/#r=<hash4>".
    // Coming from Rules, switch the view first; the hash (if any) below is
    // what then picks which read to show on it.
    if (onRules) showReadRoute(false);
    const m = /^#r=([0-9a-f]{4})$/.exec(location.hash);
    if (!m) return;
    const idx = findSessionReadByHash4(m[1]);
    const rec = idx >= 0 ? selectSessionRead(idx) : null;
    if (rec && rec.id === current?.read.hash) {
      // Already on screen (Back from Rules to the read it left): re-showing
      // would rebuild the looks and drop a look being tried.
      return;
    } else if (rec) {
      void showRead(rec.read, { sourceCredit: rec.sourceCredit, quick: true, push: false });
    } else if (current) {
      // This session keeps at most MAX_KEPT reads: back/forward can land on
      // a hash for one since dropped. Land on what is actually still shown
      // and correct the URL to match it, rather than strand the address bar
      // on a hash forward/back can never resolve again.
      setUrlHash(current.read.hash, false);
    } else {
      history.replaceState({}, "", "/");
    }
  });

  let busy = false;
  const run = async (file: Blob, sourceCredit: string | null = null) => {
    if (busy) return;
    busy = true;
    warm();
    document.body.dataset.state = "measuring";
    status.textContent = "Measuring.";
    status.removeAttribute("data-state");
    // Where a failed read returns to: the read on screen (current), else the
    // chalk restore if that is what showed, else the drop cloth.
    const fromChalk = current === null && !chalkRestore.hidden;
    try {
      const { read, copy } = await reader.read(file, (display: Pixels) => {
        // The photo shows the moment it is decoded; the models are still at work.
        showPhoto(canvas, display);
        chalkRestore.hidden = true;
        cloth.hidden = true;
        well.hidden = false;
        requestAnimationFrame(() => (well.dataset.in = ""));
      });
      if (!read) {
        status.textContent = copy ?? "The measuring models did not load. Check the connection and try again; they download once, then stay in the browser.";
        status.dataset.state = "error";
        // The read survives a failed re-read (R-09): the failed attempt's
        // own onPhoto already drew its (unread) photo over the current
        // one's, at that photo's size and aspect ratio. figure.restore()
        // puts the canvas back to the current read's size, then redraws the
        // photo and its overlay exactly as they stood before the attempt.
        // From the chalk restore, the chalk figure comes back, with
        // whatever look was being tried on it untouched.
        if (current) {
          current.figure.restore();
          document.body.dataset.state = "read";
        } else if (fromChalk) {
          well.hidden = true;
          delete well.dataset.in;
          cloth.hidden = true;
          chalkRestore.hidden = false;
          document.body.dataset.state = "read";
        } else showCloth();
        return;
      }
      status.textContent = "";
      reportCoreSuccess();
      const { isFirstOfSession } = addSessionRead(read, sourceCredit);
      const quick = revealKind(isFirstOfSession, reducedMotion()) !== "signature";
      await showRead(read, { sourceCredit, quick, push: true });
    } finally {
      busy = false;
      input.value = "";
      camera.value = "";
    }
  };

  camera.addEventListener("change", () => {
    const file = camera.files?.[0];
    if (file) void run(file);
  });

  // The sample: a public-domain painting staged with the models, read like
  // any photo. Shared by the drop cloth's own button and the read menu.
  const SAMPLE_CREDIT = "Jacques-Louis David, The Emperor Napoleon in His Study at the Tuileries, 1812. National Gallery of Art, Washington. Public domain, via Wikimedia Commons.";
  const runSample = async () => {
    if (busy) return;
    warm();
    status.textContent = "Fetching the sample.";
    status.removeAttribute("data-state");
    try {
      const res = await fetch("/samples/napoleon.jpg");
      if (!res.ok) throw new Error(String(res.status));
      void run(await res.blob(), SAMPLE_CREDIT);
    } catch {
      status.textContent = "The sample did not load. Check the connection and try again.";
      status.dataset.state = "error";
    }
  };
  sample.addEventListener("click", () => void runSample());

  // The wipe: the range control and a drag on the photo move the same line;
  // a drag let go carries on with the finger's speed and settles.
  wipe.addEventListener("input", () => current?.figure.setWipe(Number(wipe.value) / 100));
  const velocity = new Velocity();
  let dragging = false;
  const fractionAt = (e: PointerEvent) => {
    const r = canvas.getBoundingClientRect();
    return Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
  };
  const dragTo = (e: PointerEvent) => {
    if (!current?.figure.hasLook) return;
    const f = fractionAt(e);
    current.figure.setWipe(f);
    velocity.push(f);
    wipe.value = String(Math.round(f * 100));
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!current?.figure.hasLook) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    velocity.reset(fractionAt(e));
    dragTo(e);
  });
  canvas.addEventListener("pointermove", (e) => dragging && dragTo(e));
  const release = () => {
    if (!dragging) return;
    dragging = false;
    const v = velocity.value;
    if (Math.abs(v) > 0.2 && !reducedMotion()) current?.figure.flingWipe(v, (w) => (wipe.value = String(Math.round(w * 100))));
  };
  canvas.addEventListener("pointerup", release);
  canvas.addEventListener("pointercancel", release);

  /** Draws and downloads the card for whatever is on screen now; shared by both download buttons, the Card preview's and the `S` shortcut, one export at a time (ui/save.ts). */
  const downloadCard = cardSaver({ current: () => current, save: saveCard });
  save.addEventListener("click", () => void downloadCard(save, saveNote));
  saveTop.addEventListener("click", () => void downloadCard(saveTop, saveNote));

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void run(file);
  });

  // The read menu: the bar's one action ("Read my outfit" / "Read another")
  // opens a small popover (Choose a photo, Use the camera, Try the sample)
  // instead of going straight to the file picker. This is what lets the
  // sample and the camera stay reachable after the first read, while a
  // cancelled picker still leaves whatever was on screen untouched (R-09:
  // "my read is gone. Again.") - the menu is an overlay, never the drop
  // cloth, so there is nothing for a cancel to undo.
  const menuItems = () => Array.from(readMenu.querySelectorAll<HTMLButtonElement>(".read-menu-item")).filter((b) => !b.hidden);
  let menuOpen = false;
  const placeMenu = () => {
    const r = again.getBoundingClientRect();
    const w = readMenu.offsetWidth || 190;
    const left = Math.max(12, Math.min(r.left, innerWidth - w - 12));
    readMenu.style.left = `${left}px`;
    readMenu.style.top = `${r.bottom + 6}px`;
  };
  const closeMenu = (returnFocus = true) => {
    if (!menuOpen) return;
    menuOpen = false;
    readMenu.classList.remove("in");
    readMenu.hidden = true;
    again.setAttribute("aria-expanded", "false");
    document.removeEventListener("pointerdown", onOutside, true);
    if (returnFocus) again.focus();
  };
  const onOutside = (e: PointerEvent) => {
    if (readMenu.contains(e.target as Node) || again.contains(e.target as Node)) return;
    closeMenu(false);
  };
  const openMenu = () => {
    if (menuOpen) return;
    menuOpen = true;
    if (menuCamera) menuCamera.hidden = !matchMedia("(pointer: coarse)").matches;
    readMenu.hidden = false;
    placeMenu();
    again.setAttribute("aria-expanded", "true");
    // Focus moves synchronously, in the same tick as the click/keypress that
    // opened the menu: "O" then "Enter" in quick succession must land on the
    // now-focused "Choose a photo", never back on the trigger button.
    menuItems()[0]?.focus();
    // The entrance transition still waits a frame, so hidden -> visible is a
    // real style change the browser can animate from, not a no-op.
    requestAnimationFrame(() => {
      placeMenu();
      readMenu.classList.add("in");
    });
    document.addEventListener("pointerdown", onOutside, true);
  };
  again.addEventListener("click", () => (menuOpen ? closeMenu() : openMenu()));
  readMenu.addEventListener("keydown", (e) => {
    // While the menu is open it owns the keyboard: no page shortcut (1/2/3,
    // S, [ ]...) fires underneath it.
    e.stopPropagation();
    const items = menuItems();
    const i = items.indexOf(document.activeElement as HTMLButtonElement);
    if (e.key === "Escape") {
      e.preventDefault();
      closeMenu();
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      items[(i + 1) % items.length]?.focus();
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      items[(i - 1 + items.length) % items.length]?.focus();
    }
  });
  menuChoose.addEventListener("click", () => {
    closeMenu();
    input.click();
  });
  menuCamera?.addEventListener("click", () => {
    closeMenu();
    camera.click();
  });
  menuSample.addEventListener("click", () => {
    closeMenu();
    void runSample();
  });
  addEventListener("resize", () => menuOpen && placeMenu());

  // The whole stage is the drop cloth.
  stage.addEventListener("dragover", (e) => {
    e.preventDefault();
    stage.dataset.over = "true";
  });
  stage.addEventListener("dragleave", () => delete stage.dataset.over);
  stage.addEventListener("drop", (e) => {
    e.preventDefault();
    delete stage.dataset.over;
    const file = e.dataTransfer?.files[0];
    if (file) void run(file);
  });
  // A click on the cloth's empty ground opens the file picker, like the old drop zone.
  cloth.addEventListener("click", (e) => {
    if ((e.target as HTMLElement).closest("button, label, input, a")) return;
    input.click();
  });

  // ---- Rules opens in-app: no page load, nothing unloads (founder, T3) ----------

  let onRules = false;
  let rulebookApi: { refreshYours: () => void } | null = null;
  const ensureRulebook = (): void => {
    if (rulebookApi) return;
    rulesView.innerHTML = renderRulebook();
    rulebookApi = setupRulebook(rulesView);
  };
  const showRulesRoute = (push: boolean): void => {
    // A read's reveal may still be in flight (e.g. the popstate handler's own
    // quick re-show after a "back"); its tail would otherwise call
    // setUrlHash(..., false) once it finishes, replaceState-ing this route's
    // URL back to "/#r=..." after we've already left for Rules. Bump urlGen,
    // not showGen: the reveal's own visual tail (re-enabling the look
    // buttons, landing the rows, updating the strip) must still finish, only
    // its URL write is stale now.
    urlGen++;
    closeMenu(false); // the read menu is Read's own action; Rules has none (T3 re-review)
    ensureRulebook();
    rulebookApi?.refreshYours();
    onRules = true;
    stage.hidden = true;
    sheetEl.hidden = true;
    rulesView.hidden = false;
    document.body.classList.add("rules-page");
    readTab.removeAttribute("aria-current");
    rulesTab.setAttribute("aria-current", "page");
    tabsApi?.setActive(rulesTab);
    document.title = "Rulebook · Ratio";
    // A Why? link's own rAF below focuses the specific rule card instead,
    // overriding this a moment later; plain arrivals at Rules land here.
    rulesView.querySelector<HTMLElement>("#rulebook-h1")?.focus({ preventScroll: true });
    if (push) {
      const below = location.pathname === "/" ? (/^#r=([0-9a-f]{4})$/.exec(location.hash)?.[1] ?? null) : null;
      history.pushState({ route: "rules", below }, "", "/rules");
    }
  };
  const showReadRoute = (push: boolean): void => {
    // Same reasoning as showRulesRoute: a stale in-flight showRead's URL
    // write must not run once we've routed away from it, but its visual
    // tail still must.
    urlGen++;
    onRules = false;
    rulesView.hidden = true;
    document.body.classList.remove("rules-page");
    stage.hidden = false;
    sheetEl.hidden = false;
    rulesTab.removeAttribute("aria-current");
    readTab.setAttribute("aria-current", "page");
    tabsApi?.setActive(readTab);
    document.title = "Ratio";
    // A no-op when #result (and so #sheet-head) is still hidden, as it is
    // before any read: nothing to focus back onto yet.
    $<HTMLElement>("sheet-head")?.focus({ preventScroll: true });
    if (push) history.pushState({ route: "read" }, "", current ? `/#r=${hash4(current.read.hash)}` : "/");
  };
  // A plain left-click, no modifier: anything else (middle-click, Ctrl/Cmd-
  // click to open a new tab, Shift-click for a new window) is left alone to
  // do what the browser normally does with a real <a href> (T3 re-review).
  const isPlainClick = (e: MouseEvent): boolean => e.button === 0 && !e.metaKey && !e.ctrlKey && !e.shiftKey && !e.altKey;
  rulesTab.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (!onRules) showRulesRoute(true);
    else tabsApi?.setActive(rulesTab); // closes a Face/Card cloth opened over Rules
  });
  readTab.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    e.preventDefault();
    if (onRules) showReadRoute(true);
  });
  // "Back to your reading" (and the chip's plain "Read a photo" fallback)
  // are real links, `/#r=<hash4>` or `/`: without this they would do a full
  // navigation, which is exactly what T3's in-app Rules is for not doing.
  rulesView.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    const m = /^\/#r=([0-9a-f]{4})$/.exec(href);
    if (!a || (href !== "/" && !m)) return;
    e.preventDefault();
    showReadRoute(false);
    const rec = m ? selectSessionRead(findSessionReadByHash4(m[1])) : null;
    // Already on screen: re-showing would rebuild the looks and drop a look
    // being tried (the same guard as popstate). Only the URL moves.
    if (rec && rec.id === current?.read.hash) history.pushState({ r: m?.[1] }, "", href);
    else if (rec) void showRead(rec.read, { sourceCredit: rec.sourceCredit, quick: true, push: true });
    else history.pushState({ route: "read" }, "", "/");
  });
  // "Why?" links (a row's or a look's) point at one rule card on the
  // Rulebook, `/rules#rule-<id>`. Caught document-wide, since they appear in
  // the Read view itself, not only within Rules. Opens Rules in-app, then
  // scrolls to and focuses that card, the same place a real navigation to
  // the URL would land - without a full page load throwing the in-flight
  // read away (T3 re-review: "Why? links do a full navigation").
  document.addEventListener("click", (e) => {
    if (!isPlainClick(e)) return;
    const a = (e.target as HTMLElement).closest("a");
    const href = a?.getAttribute("href") ?? "";
    if (!href.startsWith("/rules#")) return;
    e.preventDefault();
    const id = href.slice("/rules".length);
    showRulesRoute(true);
    requestAnimationFrame(() => {
      const target = rulesView.querySelector<HTMLElement>(id);
      if (!target) return;
      target.scrollIntoView({ block: "start" });
      if (!target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
      target.focus({ preventScroll: true });
    });
  });

  // ---- Keyboard, for heavy use (T3) --------------------------------------------

  if (shortcutsHelp && shortcutsSheet && shortcutsList && shortcutsClose) {
    shortcutsList.replaceChildren(
      ...SHORTCUT_LIST.flatMap(({ key, does }) => {
        const dt = document.createElement("dt");
        dt.textContent = key;
        const dd = document.createElement("dd");
        dd.textContent = does;
        return [dt, dd];
      }),
    );
    const focusables = () => Array.from(shortcutsSheet.querySelectorAll<HTMLElement>("button, a[href]"));
    const openHelp = () => {
      shortcutsSheet.hidden = false;
      shortcutsClose.focus();
    };
    const closeHelp = () => {
      shortcutsSheet.hidden = true;
      shortcutsHelp.focus();
    };
    shortcutsHelp.addEventListener("click", () => (shortcutsSheet.hidden ? openHelp() : closeHelp()));
    shortcutsClose.addEventListener("click", closeHelp);
    // While the dialog has focus, its own keys (Escape to close, Tab
    // trapped inside it) never reach the page's shortcuts.
    shortcutsSheet.addEventListener("keydown", (e) => {
      e.stopPropagation();
      if (e.key === "Escape") {
        e.preventDefault();
        closeHelp();
        return;
      }
      if (e.key !== "Tab") return;
      const els = focusables();
      if (!els.length) return;
      const first = els[0];
      const last = els[els.length - 1];
      if (e.shiftKey && document.activeElement === first) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && document.activeElement === last) {
        e.preventDefault();
        first.focus();
      }
    });
    const handlers: ShortcutHandlers = {
      another: () => again.click(),
      tryLook: (i) => (looksList.children[i]?.querySelector<HTMLButtonElement>("button.btn") ?? null)?.click(),
      original: () => {
        if (!trying.hidden) trying.querySelector<HTMLButtonElement>(".trying-back")?.click();
      },
      step: (dir) => {
        const rec = stepSessionRead(dir);
        // [ ] at the ends do nothing: stepSessionRead clamps and would
        // otherwise re-show (and re-push history for) the read already shown.
        if (rec && rec.id !== current?.read.hash) void showRead(rec.read, { sourceCredit: rec.sourceCredit, quick: true, push: true });
      },
      download: () => void downloadCard(saveTop, saveNote),
      help: openHelp,
    };
    // No shortcut fires while a "not built yet" cloth (Face, Card) is open
    // (body.dataset.soon is set exactly then, ui/tabs.ts), or while Rules
    // shows: the spec gives Rules no action of its own (T3 re-review).
    const guarded: ShortcutHandlers = Object.fromEntries(Object.entries(handlers).map(([k, fn]) => [k, (...args: unknown[]) => document.body.dataset.soon === undefined && !onRules && (fn as (...a: unknown[]) => void)(...args)])) as unknown as ShortcutHandlers;
    setupShortcuts(guarded);
  }

  // ---- This tab's session: restore on load, with no re-measure ------------------

  (() => {
    // A direct visit or reload at /rules: show Rules itself, not a read
    // restore. This session's memory is always empty this early anyway
    // (see the next comment), so there is no read this visit could be
    // restoring regardless.
    if (location.pathname === "/rules") {
      showRulesRoute(false);
      return;
    }
    const m = /^#r=([0-9a-f]{4})$/.exec(location.hash);
    const reads = sessionReads(); // always empty on a fresh load: nothing persists across one (founder, T3)
    let toShow: SessionRead | null = null;
    if (m) {
      const idx = findSessionReadByHash4(m[1]);
      if (idx >= 0) toShow = selectSessionRead(idx);
    }
    if (!toShow && reads.length > 0) toShow = selectSessionRead(reads.length - 1);
    if (toShow) void showRead(toShow.read, { sourceCredit: toShow.sourceCredit, quick: true, push: false });
    else {
      // Nothing in memory (a genuine reload, or a direct visit): fall back
      // to the photo-free hand-off, shown as the chalk figure, if any -
      // but only when it is still readable by this build's engine: bins
      // from an older engine version are not a promise this one can keep
      // "same photo, same reading" on.
      const last = loadLastRead();
      if (last && last.engine === ENGINE_VERSION) showChalkRestore(last);
    }
  })();

  /** The Card tab, with a read in hand: this read's card, in place of "not built yet" (Sam's re-run). Previews a single read until the Style Card (Forge 4) ships. */
  const cardPreview = async (): Promise<HTMLElement | null> => {
    if (!current) return null;
    const c = current;
    await c.settled();
    const wrap = document.createElement("div");
    wrap.className = "card-preview";
    wrap.tabIndex = -1;
    const heading = document.createElement("h1");
    heading.className = "drop-title";
    heading.textContent = "This read, as a card.";
    wrap.append(heading);
    const shown = c.shown();
    try {
      const drawn = await drawCard(cardContentOf(shown, c.figure.still(), c.credit));
      const blob = await drawn.convertToBlob({ type: "image/png" });
      // A data: URL, not an object URL: the CSP's img-src allows this
      // origin and data: only, never blob:, and a data: URL needs no
      // revocation, so there is nothing to clean up when the preview closes.
      const dataUrl = await blobToDataUrl(blob);
      const img = document.createElement("img");
      img.className = "card-preview-img";
      img.alt = "The card drawn from this read: the photo at rest, the readings and the palette.";
      img.src = dataUrl;
      wrap.append(img);
    } catch {
      const p = document.createElement("p");
      p.className = "muted";
      p.textContent = "The card could not be drawn.";
      wrap.append(p);
    }
    const dl = document.createElement("button");
    dl.type = "button";
    dl.className = "btn";
    dl.textContent = "Download this read (free)";
    const note = document.createElement("p");
    note.className = "muted small";
    note.setAttribute("role", "status");
    note.setAttribute("aria-live", "polite");
    dl.addEventListener("click", () => void downloadCard(dl, note));
    wrap.append(dl, note);
    return wrap;
  };

  /** The Face/Card cloth's "Read an outfit": on Rules, route back to Read in-app (the cloth itself is already closed). */
  const readAction = (): void => {
    if (onRules) showReadRoute(true);
  };

  return { cardPreview, readAction };
}

function setupFeedback(): void {
  const form = document.getElementById("feedback-form");
  const status = document.getElementById("feedback-status");
  if (!(form instanceof HTMLFormElement) || !status) return;

  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const textarea = form.elements.namedItem("text");
    const text = textarea instanceof HTMLTextAreaElement ? textarea.value.trim() : "";
    if (!text) return;

    status.textContent = "Sending.";
    status.removeAttribute("data-state");

    fetch("/feedback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text, page: location.pathname }),
    })
      .then((response) => {
        if (response.status === 429) throw new Error("ceiling");
        if (!response.ok) throw new Error(`status ${response.status}`);
        status.textContent = "Thank you, that was sent.";
        form.reset();
      })
      .catch((err: unknown) => {
        status.textContent =
          err instanceof Error && err.message === "ceiling"
            ? "We have had a lot of feedback today. Please try again tomorrow."
            : "Could not send that. Please try again.";
        status.dataset.state = "error";
      });
  });
}

/** The drop cloth's chalk figure: the instrument at rest, before a photo. */
function setupDropFigure(): void {
  const slot = document.getElementById("drop-figure");
  if (!slot) return;
  const rest = { L: 0.5, C: 0, h: 0 };
  slot.replaceChildren(chalkFigure({ proportion: null, waist: 0.38, top: rest, bottom: rest, palette: [], fit: null }, { outline: true, label: "A chalk figure with the tape beside it, waiting for a photo" }));
}

/** The browser's own chrome takes the page ground's colour (from the tokens, never a literal here). */
function setThemeColor(): void {
  const meta = document.createElement("meta");
  meta.name = "theme-color";
  meta.content = getComputedStyle(document.body).backgroundColor;
  document.head.append(meta);
  matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => (meta.content = getComputedStyle(document.body).backgroundColor));
}

sendEvent("page_view");
setThemeColor();
setupDropFigure();
let cardPreviewFn: (() => Promise<HTMLElement | null>) | null = null;
let readActionFn: (() => void) | null = null;
const tabsApi = setupTabs({ onRead: true, dynamic: { card: () => cardPreviewFn?.() ?? Promise.resolve(null) }, onReadAction: () => readActionFn?.() });
const readApi = setupRead(tabsApi);
cardPreviewFn = readApi?.cardPreview ?? null;
readActionFn = readApi?.readAction ?? null;
setupFeedback();
