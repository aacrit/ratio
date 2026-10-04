// Telemetry here is aggregate counts only: no anonymous id, no localStorage,
// no cookies, nothing that could identify a visitor. `/e` accepts exactly
// `{ "name": "<allowed event>" }` and bumps a same-day, same-name counter.
// Because it collects and stores nothing personal, no consent banner is
// needed (see web/privacy.html). Every POST is same-origin JSON: the Worker
// refuses anything else (worker/src/guard.ts), so never use sendBeacon,
// which sends text/plain.
import { Figure } from "./overlay";
import { FAILURE_COPY, readPhoto } from "./read";
import { chalkFigure } from "./tryon/figure";
import { saveCard } from "./ui/card";
import { type Shown, setupLooks } from "./ui/looks";
import { paletteStrip, renderRows } from "./ui/rows";
import { loadModels } from "./vision";

function sendEvent(name: string): void {
  fetch("/e", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ name }),
    keepalive: true,
  }).catch(() => {
    // Best-effort telemetry: a failed send is not the user's problem.
  });
}

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
  const drop = $<HTMLElement>("drop");
  const status = $<HTMLElement>("read-status");
  const loading = $<HTMLElement>("loading");
  const loadFill = $<HTMLElement>("load-fill");
  const loadLabel = $<HTMLElement>("load-label");
  const result = $<HTMLElement>("result");
  const canvas = $<HTMLCanvasElement>("figure");
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
  const dropAlt = document.querySelector<HTMLElement>(".drop-alt");
  if (!wipe || !credit || !save || !sample || !camera || !dropAlt) return;
  if (!input || !drop || !status || !loading || !loadFill || !loadLabel || !result || !canvas || !verdict || !rows || !hash || !again || !paletteSlot || !looksSection || !looksList || !trying || !trial) return;

  const mb = (n: number) => (n / 1e6).toFixed(1);
  const onProgress = (loaded: number, total: number) => {
    const all = Math.max(total, loaded);
    loadLabel.textContent = `Loading the measuring models, ${mb(loaded)} of ${mb(all)} MB.`;
    loadFill.style.width = `${all ? (100 * loaded) / all : 0}%`;
  };
  // Start the models' one-time download as soon as someone shows intent.
  let warmed = false;
  const warm = () => {
    if (warmed) return;
    warmed = true;
    loading.hidden = false;
    loadModels(onProgress).then(
      () => (loading.hidden = true),
      () => {
        loading.hidden = true;
        warmed = false;
      },
    );
  };
  drop.addEventListener("pointerenter", warm, { once: true });
  input.addEventListener("focus", warm, { once: true });

  // The read on screen, for the wipe and the card.
  let current: { figure: Figure; shown: () => Shown; credit: string | null } | null = null;

  let busy = false;
  const run = async (file: Blob, sourceCredit: string | null = null) => {
    if (busy) return;
    busy = true;
    warm();
    document.body.dataset.state = "measuring";
    status.textContent = "Measuring.";
    status.removeAttribute("data-state");
    try {
      const read = await readPhoto(file);
      if (typeof read === "string") {
        status.textContent = FAILURE_COPY[read];
        status.dataset.state = "error";
        result.hidden = true;
        looksSection.hidden = true;
        document.body.dataset.state = "idle";
        return;
      }
      status.textContent = "";
      drop.hidden = true;
      dropAlt.hidden = true;
      result.hidden = false;
      document.body.dataset.state = "read";
      const figure = new Figure(canvas, read.pixels, read.measure, read.reading);
      wipe.hidden = true;
      credit.hidden = sourceCredit === null;
      credit.textContent = sourceCredit ?? "";
      // The verdict is the proportion line's first sentence.
      verdict.textContent = read.reading.lines[0].text.split(/(?<=\.)\s/)[0];
      paletteSlot.replaceChildren(paletteStrip(read.reading.bins));

      // The tuck button belongs to the proportion row of the reading as worn.
      const asWornExtras = () => {
        const first = read.reading.lines[0];
        if (first.state !== "advice" || read.measure.breakRow === null) return {};
        const tuck = document.createElement("button");
        tuck.type = "button";
        tuck.className = "btn ghost";
        tuck.textContent = "Show the tuck";
        let on = false;
        tuck.addEventListener("click", () => {
          on = !on;
          figure.showTuck(on);
          tuck.textContent = on ? "Show it as worn" : "Show the tuck";
        });
        return { extra: { proportion: tuck } };
      };
      renderRows(rows, read.reading.lines, read.reading.bins, asWornExtras());
      hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
      hash.title = `Reading hash ${read.hash}`;
      reportCoreSuccess();
      const looks = setupLooks({ read, figure, rows, section: looksSection, list: looksList, trying, trial, paletteSlot, hash, wipe, asWornExtras, onTried: () => sendEvent("look_tried") });
      current = { figure, shown: looks.shown, credit: sourceCredit };
      // The argument follows the numeral, and never waits more than 2.5 s for it.
      await Promise.race([figure.play(), new Promise((r) => setTimeout(r, 2500))]);
      rows.classList.add("in");
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
    status.textContent = "Fetching the sample.";
    try {
      const res = await fetch("/samples/napoleon.jpg");
      if (!res.ok) throw new Error(String(res.status));
      void run(await res.blob(), SAMPLE_CREDIT);
    } catch {
      status.textContent = "The sample did not load. Check the connection and try again.";
      status.dataset.state = "error";
    }
  });

  // The wipe: the range control and a drag on the photo move the same line.
  wipe.addEventListener("input", () => current?.figure.setWipe(Number(wipe.value) / 100));
  let dragging = false;
  const dragTo = (e: PointerEvent) => {
    if (!current?.figure.hasLook) return;
    const r = canvas.getBoundingClientRect();
    const f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    current.figure.setWipe(f);
    wipe.value = String(Math.round(f * 100));
  };
  canvas.addEventListener("pointerdown", (e) => {
    if (!current?.figure.hasLook) return;
    dragging = true;
    canvas.setPointerCapture(e.pointerId);
    dragTo(e);
  });
  canvas.addEventListener("pointermove", (e) => dragging && dragTo(e));
  canvas.addEventListener("pointerup", () => (dragging = false));
  canvas.addEventListener("pointercancel", () => (dragging = false));

  // Save as card: whatever is on screen, as worn or the tried look.
  save.addEventListener("click", async () => {
    if (!current) return;
    const shown = current.shown();
    save.disabled = true;
    save.textContent = "Drawing the card.";
    try {
      await saveCard({ still: current.figure.still(), title: shown.title, lines: shown.lines, bins: shown.bins, hash: shown.hash, engine: shown.engine, credit: current.credit ?? undefined });
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
    looksSection.hidden = true;
    drop.hidden = false;
    dropAlt.hidden = false;
    document.body.dataset.state = "idle";
    input.click();
  });
  drop.addEventListener("dragover", (e) => {
    e.preventDefault();
    drop.dataset.over = "true";
  });
  drop.addEventListener("dragleave", () => delete drop.dataset.over);
  drop.addEventListener("drop", (e) => {
    e.preventDefault();
    delete drop.dataset.over;
    const file = e.dataTransfer?.files[0];
    if (file) void run(file);
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

sendEvent("page_view");
setupDropFigure();
setupRead();
setupFeedback();
