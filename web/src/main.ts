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
import { setupLooks } from "./ui/looks";
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

  let busy = false;
  const run = async (file: File) => {
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
      result.hidden = false;
      document.body.dataset.state = "read";
      const figure = new Figure(canvas, read.pixels, read.measure, read.reading);
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
      setupLooks({ read, figure, rows, section: looksSection, list: looksList, trying, trial, paletteSlot, hash, asWornExtras, onTried: () => sendEvent("look_tried") });
      // The argument follows the numeral, and never waits more than 2.5 s for it.
      await Promise.race([figure.play(), new Promise((r) => setTimeout(r, 2500))]);
      rows.classList.add("in");
    } finally {
      busy = false;
      input.value = "";
    }
  };

  input.addEventListener("change", () => {
    const file = input.files?.[0];
    if (file) void run(file);
  });
  again.addEventListener("click", () => {
    result.hidden = true;
    looksSection.hidden = true;
    drop.hidden = false;
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
