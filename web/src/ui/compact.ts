// Compact mode (T3, Noor: speed on the third and tenth read). Rows collapse
// to name, band and numbers; Rule and Advice open on Enter or tap. The
// choice is remembered per device, not per visit, so it is localStorage,
// wrapped in try/catch like every other browser-storage access in this
// product (web/privacy.html discloses it; tests/privacy-page.test.ts pairs
// the claim with this file).

import { syncRowsExpanded } from "./rows";

const KEY = "ratio:compact";

export function loadCompact(): boolean {
  try {
    return localStorage.getItem(KEY) === "1";
  } catch {
    return false;
  }
}

export function saveCompact(on: boolean): void {
  try {
    if (on) localStorage.setItem(KEY, "1");
    else localStorage.removeItem(KEY);
  } catch {
    // The toggle still works for this page view; it just will not be remembered.
  }
}

/** Wires a toggle button: reflects and flips `document.body.dataset.compact`, remembered per device. Every row head's aria-expanded is re-said to match. */
export function setupCompact(button: HTMLButtonElement): void {
  const apply = (on: boolean) => {
    if (on) document.body.dataset.compact = "";
    else delete document.body.dataset.compact;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Compact: on" : "Compact";
    syncRowsExpanded(document.querySelectorAll<HTMLElement>(".row"), on);
  };
  apply(loadCompact());
  button.addEventListener("click", () => {
    const on = document.body.dataset.compact === undefined;
    apply(on);
    saveCompact(on);
  });
}
