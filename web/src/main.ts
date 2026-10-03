// Telemetry here is aggregate counts only: no anonymous id, no localStorage,
// no cookies, nothing that could identify a visitor. `/e` accepts exactly
// `{ "name": "<allowed event>" }` and bumps a same-day, same-name counter.
// Because it collects and stores nothing personal, no consent banner is
// needed (see web/privacy.html). Every POST is same-origin JSON: the Worker
// refuses anything else (worker/src/guard.ts), so never use sendBeacon,
// which sends text/plain.
import { type AdviceLine, NEUTRAL_CHROMA } from "./engine/rules";
import { Figure } from "./overlay";
import { FAILURE_COPY, type Read, readPhoto } from "./read";
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

// The rule each line is held against, said once (design/BRAND.md: measure,
// then the rule, then the advice).
const RULE_COPY: Record<AdviceLine["rule"], string> = {
  proportion: "A break near a third (0.333) or the golden section (0.382) of the height reads as composed; near-equal halves read as boxy.",
  harmony: "Matsuda's hue templates (monochromatic, complementary, analogous, right-angle, split, double complementary, half wheel), fitted on the perceptual OKLCH wheel. A palette inside one reads as harmonious.",
  value: "Lightness carries form before hue does. A darker value below a lighter one grounds a figure; the widest lightness edge draws the eye first.",
  shares: "Colour by area: one dominant, one secondary, one accent, near 0.60 · 0.30 · 0.10. Equal shares compete for the lead.",
  chroma: "One saturated colour among muted ones reads as a single voice. Complements at equal lightness vibrate where they meet (Albers).",
};

function measuredCopy(line: AdviceLine, read: Read): string {
  const { bins } = read.reading;
  const hue = (c: { C: number; h: number }) => (c.C < NEUTRAL_CHROMA ? "a neutral" : `hue ${c.h}°`);
  switch (line.rule) {
    case "proportion":
      return bins.proportion === null
        ? "Upper and lower pieces measure as one colour, head to feet."
        : `The break sits at ${bins.proportion.toFixed(2)} of the height, head to feet.`;
    case "harmony":
      return `${bins.palette.length} colours in the outfit: ${bins.palette.map((p) => hue(p)).join(", ")}.`;
    case "value":
      return `Lightness of each colour: ${bins.palette.map((p) => p.L.toFixed(2)).join(", ")}.`;
    case "shares":
      return `Share of the outfit's area: ${bins.palette.map((p) => p.share.toFixed(2)).join(", ")}.`;
    case "chroma":
      return `Chroma of each colour: ${bins.palette.map((p) => p.C.toFixed(2)).join(", ")}.`;
  }
}

/** The measured palette as a strip, each colour as wide as its share. The photo carries the colour. */
function paletteStrip(read: Read): HTMLElement {
  const strip = document.createElement("div");
  strip.className = "palette";
  strip.setAttribute("role", "img");
  strip.setAttribute("aria-label", `The outfit's palette: ${read.reading.bins.palette.map((p) => `${Math.round(p.share * 100)}%`).join(", ")}`);
  for (const sw of read.palette) {
    const chip = document.createElement("span");
    chip.style.flexGrow = String(sw.share);
    chip.style.background = `oklab(${sw.lab.L} ${sw.lab.a} ${sw.lab.b})`;
    chip.title = sw.share.toFixed(2);
    strip.append(chip);
  }
  return strip;
}

function para(label: string, text: string): HTMLParagraphElement {
  const p = document.createElement("p");
  const b = document.createElement("b");
  b.textContent = label;
  p.append(b, " ", text);
  return p;
}

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
  const lines = $<HTMLOListElement>("advice");
  const hash = $<HTMLElement>("reading-hash");
  const again = $<HTMLButtonElement>("read-another");
  if (!input || !drop || !status || !loading || !loadFill || !loadLabel || !result || !canvas || !verdict || !lines || !hash || !again) return;

  const mb = (n: number) => (n / 1e6).toFixed(1);
  const onProgress = (loaded: number, total: number) => {
    const all = Math.max(total, loaded);
    loadLabel.textContent = `Loading the measuring models, ${mb(loaded)} of ${mb(all)} MB.`;
    loadFill.style.width = `${all ? (100 * loaded) / all : 0}%`;
  };
  // Start the models' one-time download as soon as someone shows intent.
  const warm = () => {
    loading.hidden = false;
    loadModels(onProgress).then(
      () => (loading.hidden = true),
      () => (loading.hidden = true),
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
        document.body.dataset.state = "idle";
        return;
      }
      status.textContent = "";
      drop.hidden = true;
      result.hidden = false;
      document.body.dataset.state = "read";
      lines.classList.remove("in");
      const figure = new Figure(canvas, read.pixels, read.measure, read.reading);
      const first = read.reading.lines[0];
      // The verdict is the proportion line's first sentence.
      verdict.textContent = first.text.split(/(?<=\.)\s/)[0];
      document.getElementById("palette-slot")?.replaceChildren(paletteStrip(read));
      lines.replaceChildren(
        ...read.reading.lines.map((line, i) => {
          const li = document.createElement("li");
          li.className = "row";
          li.dataset.state = line.borderline ? "borderline" : line.state;
          const head = document.createElement("p");
          head.className = "row-h";
          const title = document.createElement("span");
          title.className = "row-t";
          title.textContent = line.title;
          const measured = document.createElement("span");
          measured.className = "row-n";
          measured.dataset.ratio = "";
          measured.textContent = line.measured;
          head.append(title, measured);
          const body = document.createElement("div");
          body.className = "row-b";
          body.append(para("Measured", measuredCopy(line, read)), para("Rule", RULE_COPY[line.rule]), para("Advice", line.text));
          if (line.borderline) {
            const note = para("Borderline", "This measurement sits on the edge between two bands, so a slightly different photo may read the other way. Both readings apply.");
            note.className = "row-borderline";
            body.append(note);
          }
          if (i === 0 && line.state === "advice" && read.measure.breakRow !== null) {
            const tuck = document.createElement("button");
            tuck.type = "button";
            tuck.className = "btn";
            tuck.textContent = "Show the tuck";
            let on = false;
            tuck.addEventListener("click", () => {
              on = !on;
              figure.showTuck(on);
              tuck.textContent = on ? "Show it as worn" : "Show the tuck";
            });
            body.append(tuck);
          }
          li.append(head, body);
          return li;
        }),
      );
      hash.textContent = `Same photo, same reading. ${read.hash.slice(0, 4)} · ${read.reading.engine}`;
      hash.title = `Reading hash ${read.hash}`;
      reportCoreSuccess();
      // The argument follows the numeral, and never waits more than 2.5 s for it.
      await Promise.race([figure.play(), new Promise((r) => setTimeout(r, 2500))]);
      lines.classList.add("in");
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

sendEvent("page_view");
setupRead();
setupFeedback();
