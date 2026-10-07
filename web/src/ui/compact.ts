// Compact mode (T3, Noor: speed on the third and tenth read). Rows collapse
// to name, band and numbers; Rule and Advice open on Enter or tap. The
// choice is remembered per device, not per visit, so it is localStorage,
// wrapped in try/catch like every other browser-storage access in this
// product (web/privacy.html discloses it; tests/privacy-page.test.ts pairs
// the claim with this file).

import { compactHeadlineText } from "./headline";
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

/**
 * Wires a toggle button: reflects and flips `document.body.dataset.compact`,
 * remembered per device. Every row head's aria-expanded is re-said to
 * match, and so is the headline's: Compact also folds the verdict to one
 * line (the verdict word and the one change, read back out of the full
 * sentence by headline.ts - never a second source of truth), with the ratio
 * beside it and the full sentence kept one tap away as a disclosure, since
 * the headline alone used to fill the fold at every width Compact was
 * meant to speed up (T8, R-09).
 */
export function setupCompact(button: HTMLButtonElement): void {
  const verdict = document.getElementById("verdict");
  const wrap = document.getElementById("verdict-wrap");
  const toggle = document.getElementById("verdict-compact-toggle") as HTMLButtonElement | null;
  const compactText = document.getElementById("verdict-compact-text");

  const syncHeadline = () => {
    const text = compactHeadlineText(verdict?.textContent ?? "");
    if (compactText) compactText.textContent = text;
    if (toggle) toggle.setAttribute("aria-label", text ? `${text}. Show the full sentence.` : "Show the full sentence.");
  };
  if (verdict) {
    syncHeadline();
    // The verdict's own textContent is set directly, read after read and on
    // every tried look (main.ts, ui/looks.ts): observing it, rather than
    // threading a callback through both, keeps the compact line in step
    // without a second place that has to remember to update it.
    new MutationObserver(syncHeadline).observe(verdict, { childList: true, characterData: true, subtree: true });
  }

  const setOpen = (open: boolean) => {
    if (!wrap || !toggle) return;
    if (open) wrap.dataset.open = "";
    else delete wrap.dataset.open;
    toggle.setAttribute("aria-expanded", String(open));
  };
  toggle?.addEventListener("click", () => setOpen(wrap?.dataset.open === undefined));

  const apply = (on: boolean) => {
    if (on) document.body.dataset.compact = "";
    else delete document.body.dataset.compact;
    button.setAttribute("aria-pressed", String(on));
    button.textContent = on ? "Compact: on" : "Compact";
    syncRowsExpanded(document.querySelectorAll<HTMLElement>(".row"), on);
    if (toggle) toggle.hidden = !on;
    // Leaving Compact always shows the full sentence again: turning it back
    // on starts collapsed rather than remembering a stale open disclosure.
    if (!on) setOpen(false);
  };
  apply(loadCompact());
  button.addEventListener("click", () => {
    const on = document.body.dataset.compact === undefined;
    apply(on);
    saveCompact(on);
  });
}
