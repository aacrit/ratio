// The session strip (T3, Noor: comparing and returning to reads): up to 5
// chalk thumbnails of this session's reads, to switch between them without
// re-measuring. Chalk, not photo pixels, so switching stays a comparison of
// outfits read, not a thumbnail gallery of someone's photos.

import { chalkFigure } from "../tryon/figure";
import { MAX_STRIP, type SessionRead, stripOf } from "../session";

export function renderStrip(list: HTMLElement, reads: readonly SessionRead[], activeId: string | null, onSelect: (index: number) => void): void {
  const shown = stripOf(reads, MAX_STRIP);
  list.replaceChildren();
  if (shown.length < 2) {
    list.hidden = true;
    return;
  }
  list.hidden = false;
  const offset = reads.length - shown.length;
  shown.forEach((r, i) => {
    const btn = document.createElement("button");
    btn.type = "button";
    btn.className = "strip-item";
    const on = r.id === activeId;
    btn.setAttribute("aria-pressed", String(on));
    btn.setAttribute("aria-label", `Read ${offset + i + 1} of ${reads.length}${r.sourceCredit ? ", the sample" : ""}`);
    btn.append(chalkFigure(r.read.reading.bins, { outline: false }));
    btn.addEventListener("click", () => onSelect(offset + i));
    list.append(btn);
  });
}
