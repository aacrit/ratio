// Telemetry here is aggregate counts only (events.ts): no anonymous id, no
// localStorage, no cookies, nothing that could identify a visitor. Because
// it collects and stores nothing personal, no consent banner is needed (see
// web/privacy.html). The last reading's bins are handed to the Rulebook in
// this tab's sessionStorage (rules/handoff.ts), never sent. Every POST is
// same-origin JSON: the Worker refuses anything else (worker/src/guard.ts),
// so never use sendBeacon, which sends text/plain.
//
// The page: a bar, a stage that holds the photo, and a sheet that holds the
// reading (design/BRAND.md, Stage and sheet). The models and the measuring
// run in the read worker (reader.ts); this thread only draws.

import { sendEvent } from "./events";
import { Velocity, reducedMotion } from "./motion";
import { othersCopy } from "./engine/person";
import { Figure, showPhoto } from "./overlay";
import type { Pixels } from "./engine/resample";
import { Reader } from "./reader";
import { chalkFigure } from "./tryon/figure";
import { saveCard } from "./ui/card";
import { countTo } from "./ui/count";
import { type Shown, heroEyebrowOf, setupLooks, verdictOf } from "./ui/looks";
import { paletteStrip, renderRows } from "./ui/rows";
import { Sheet } from "./ui/sheet";
import { setupTabs } from "./ui/tabs";
import { lastReadOf, saveLastRead } from "./rules/handoff";

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

function setupRead(): void {
  const input = $<HTMLInputElement>("photo");
  const stage = $<HTMLElement>("stage");
  const cloth = $<HTMLElement>("drop");
  const status = $<HTMLElement>("read-status");
  const loading = $<HTMLElement>("loading");
  const loadFill = $<HTMLElement>("load-fill");
  const loadLabel = $<HTMLElement>("load-label");
  const well = $<HTMLElement>("photo-well");
  const canvas = $<HTMLCanvasElement>("figure");
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
  const wipe = $<HTMLInputElement>("wipe");
  const credit = $<HTMLElement>("credit");
  const save = $<HTMLButtonElement>("save-card");
  const sample = $<HTMLButtonElement>("try-sample");
  const camera = $<HTMLInputElement>("camera");
  const foot = stage?.querySelector<HTMLElement>(".stage-foot") ?? null;
  const sheetEl = $<HTMLElement>("sheet");
  const sheetBody = $<HTMLElement>("sheet-body");
  const grip = $<HTMLButtonElement>("grip");
  if (!input || !stage || !cloth || !status || !loading || !loadFill || !loadLabel || !well || !canvas || !intro || !result) return;
  if (!heroN || !heroEyebrow || !verdict || !rows || !hash || !again || !paletteSlot || !looksSection || !looksList || !trying || !trial) return;
  if (!wipe || !credit || !save || !sample || !camera || !sheetEl || !sheetBody || !grip || !foot) return;

  const reader = new Reader();
  const sheet = new Sheet(sheetEl, sheetBody, grip);

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

  // The read on screen, for the wipe and the card.
  let current: { figure: Figure; shown: () => Shown; settled: () => Promise<void>; credit: string | null } | null = null;

  const showCloth = () => {
    well.hidden = true;
    delete well.dataset.in;
    cloth.hidden = false;
    document.body.dataset.state = "idle";
    again.hidden = true;
  };

  let busy = false;
  const run = async (file: Blob, sourceCredit: string | null = null) => {
    if (busy) return;
    busy = true;
    warm();
    document.body.dataset.state = "measuring";
    status.textContent = "Measuring.";
    status.removeAttribute("data-state");
    try {
      const { read, copy } = await reader.read(file, (display: Pixels) => {
        // The photo shows the moment it is decoded; the models are still at work.
        showPhoto(canvas, display);
        cloth.hidden = true;
        well.hidden = false;
        requestAnimationFrame(() => (well.dataset.in = ""));
      });
      if (!read) {
        status.textContent = copy ?? "The measuring models did not load. Check the connection and try again; they download once, then stay in the browser.";
        status.dataset.state = "error";
        showCloth();
        return;
      }
      status.textContent = "";
      document.body.dataset.state = "read";
      again.hidden = false;
      const figure = new Figure(canvas, read.display, read.pixels, read.measure, read.reading);
      wipe.hidden = true;
      document.body.dataset.compare = "off";

      // The sheet: the hero numeral and the verdict first, then the argument.
      intro.hidden = true;
      result.hidden = false;
      heroN.textContent = "";
      heroN.dataset.state = read.reading.lines[0].borderline ? "borderline" : read.reading.lines[0].state;
      heroEyebrow.textContent = heroEyebrowOf(read.reading.lines);
      verdict.textContent = verdictOf(read.reading.lines);
      paletteSlot.replaceChildren(paletteStrip(read.reading.bins));
      credit.hidden = sourceCredit === null;
      credit.textContent = sourceCredit ?? "";
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
      const rendered = renderRows(rows, read.reading.lines, read.reading.bins, asWornExtras());
      hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
      hash.title = `Reading hash ${read.hash}`;
      reportCoreSuccess();
      // The Rulebook marks this read on its instruments (bins only, this tab only).
      const source = sourceCredit === null ? "photo" : "sample";
      const handOff = (s: Shown, look: string | null) => saveLastRead(lastReadOf({ engine: s.engine, hash: s.hash, source, look, bins: s.bins, lines: s.lines }));
      handOff({ title: "As worn", lines: read.reading.lines, bins: read.reading.bins, hash: read.hash, engine: read.reading.engine }, null);
      const looks = setupLooks({ read, reader, figure, sheet, rows, section: looksSection, list: looksList, heroN, heroEyebrow, verdict, trying, trial, paletteSlot, hash, wipe, asWornExtras, onTried: () => sendEvent("look_tried"), onShown: handOff });
      current = { figure, shown: looks.shown, settled: looks.settled, credit: sourceCredit };
      sheet.measure();
      sheet.snap("half");
      // The argument follows the numeral, and never waits more than 2.5 s for it.
      await Promise.race([figure.play(), new Promise((r) => setTimeout(r, 2500))]);
      countTo(heroN, read.reading.lines[0].measured);
      rendered.land();
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

  // The sample: a public-domain painting staged with the models, read like any photo.
  const SAMPLE_CREDIT = "Jacques-Louis David, The Emperor Napoleon in His Study at the Tuileries, 1812. National Gallery of Art, Washington. Public domain, via Wikimedia Commons.";
  sample.addEventListener("click", async () => {
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
  });

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

  // Save as card: whatever is on screen, as worn or the tried look.
  save.addEventListener("click", async () => {
    if (!current) return;
    save.disabled = true;
    save.textContent = "Drawing the card.";
    // A look still being recoloured lands first: the card matches the photo and its note.
    await current.settled();
    const shown = current.shown();
    try {
      await saveCard({ still: current.figure.still(), title: shown.title, note: shown.note, lines: shown.lines, bins: shown.bins, hash: shown.hash, engine: shown.engine, credit: current.credit ?? undefined });
      save.textContent = "Saved";
    } catch {
      save.textContent = "Could not draw the card";
    } finally {
      setTimeout(() => {
        save.disabled = false;
        save.textContent = "Save as card";
      }, 1600);
    }
  });

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void run(file);
  });
  again.addEventListener("click", () => {
    result.hidden = true;
    intro.hidden = false;
    document.body.dataset.compare = "off";
    wipe.hidden = true;
    showCloth();
    sheet.measure();
    sheet.snap("peek");
    input.click();
  });

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
setupTabs({ onRead: true });
setupDropFigure();
setupRead();
setupFeedback();
