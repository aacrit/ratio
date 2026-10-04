// The bar's four tabs (design/spec.md, The bar and its tabs): Read, Face,
// Rules, Card, under one chalk underline that glides to the chosen tab with
// the `underline` preset (a CSS transition on transform only, over
// --dur-underline and --ease-underline from the token file; reduced motion
// collapses it to a jump). A surface that is not built yet is never a dead
// tab: it opens a drop cloth that says when it arrives and offers Read.

const SOON: Record<string, string> = {
  face: "Face is not built yet. Read an outfit meanwhile.",
  card: "Card is not built yet. Read an outfit meanwhile.",
};

export interface TabsOptions {
  onRead?: boolean;
  /**
   * A tab whose "not built yet" drop cloth can show something else instead,
   * decided when it opens (Sam's re-run: the Card tab shows this read's card
   * preview once there is a read, never "not built yet" while one exists). A
   * result of null falls back to the plain SOON line.
   */
  dynamic?: Partial<Record<string, () => Promise<HTMLElement | null> | HTMLElement | null>>;
}

export interface TabsApi {
  /** Moves the underline to `tab` (or hides it for null), closing any open "not built yet" drop cloth first. Main.ts calls this when it switches Read <-> Rules in-app. */
  setActive(tab: HTMLElement | null): void;
}

export function setupTabs(opts: TabsOptions = {}): TabsApi {
  const nav = document.querySelector<HTMLElement>("nav.tabs");
  if (!nav) return { setActive: () => {} };
  const tabs = Array.from(nav.querySelectorAll<HTMLElement>(".tab"));
  const home = tabs.find((t) => t.getAttribute("aria-current") === "page") ?? null;
  const line = document.createElement("span");
  line.className = "tab-underline";
  line.setAttribute("aria-hidden", "true");
  nav.append(line);

  let at: HTMLElement | null = home;
  const place = () => {
    if (!at) {
      line.style.opacity = "0";
      return;
    }
    const pad = parseFloat(getComputedStyle(at).paddingLeft) || 0;
    const w = Math.max(1, at.offsetWidth - 2 * pad);
    line.style.opacity = "1";
    line.style.transform = `translate3d(${(at.offsetLeft + pad).toFixed(1)}px, 0, 0) scaleX(${w.toFixed(1)})`;
  };
  place();
  // From here on the underline glides; the first placement was a jump.
  requestAnimationFrame(() => (nav.dataset.ready = ""));
  addEventListener("resize", place);
  void document.fonts?.ready.then(place);

  // The drop cloth for a surface that is not built yet.
  const cloth = document.createElement("section");
  cloth.className = "soon-cloth";
  cloth.id = "soon";
  cloth.hidden = true;
  cloth.setAttribute("aria-labelledby", "soon-title");
  const title = document.createElement("h1");
  title.id = "soon-title";
  title.className = "drop-title";
  title.tabIndex = -1;
  const action = document.createElement("a");
  action.className = "btn";
  action.href = "/";
  action.textContent = "Read an outfit";
  cloth.append(title, action);
  document.body.append(cloth);

  let open: HTMLElement | null = null;
  const close = () => {
    if (!open) return;
    open.setAttribute("aria-expanded", "false");
    open = null;
    cloth.hidden = true;
    delete document.body.dataset.soon;
    at = home;
    place();
  };
  const show = async (tab: HTMLElement) => {
    const which = tab.dataset.soon ?? "";
    if (open === tab) return close();
    open?.setAttribute("aria-expanded", "false");
    open = tab;
    tab.setAttribute("aria-expanded", "true");
    cloth.replaceChildren(title, action);
    title.textContent = SOON[which] ?? "";
    cloth.hidden = false;
    document.body.dataset.soon = which;
    at = tab;
    place();
    title.focus({ preventScroll: true });
    const custom = await opts.dynamic?.[which]?.();
    if (open !== tab) return; // closed, or another tab opened, while this was drawing
    if (custom) {
      cloth.replaceChildren(custom);
      custom.focus?.({ preventScroll: true });
    }
  };

  for (const tab of tabs) {
    if (tab.dataset.soon) {
      tab.setAttribute("aria-controls", "soon");
      tab.setAttribute("aria-expanded", "false");
      tab.addEventListener("click", () => void show(tab));
    } else if (tab === home) {
      // The page's own tab closes a drop cloth instead of reloading the page.
      tab.addEventListener("click", (e) => {
        if (!open) return;
        e.preventDefault();
        close();
      });
    }
  }
  // On Read, "Read an outfit" is already here: close the cloth, keep the read.
  if (opts.onRead)
    action.addEventListener("click", (e) => {
      e.preventDefault();
      close();
      home?.focus();
    });
  // Capture phase: this must claim Escape before the page's own shortcuts
  // (bound in the bubble phase on document) see it, so Esc does one thing -
  // closing the cloth never also triggers "back to the original" underneath
  // it (and, for the Card cloth, never touches whatever look is tried).
  addEventListener(
    "keydown",
    (e) => {
      if (e.key === "Escape" && open) {
        e.preventDefault();
        const tab = open;
        close();
        tab.focus();
      }
    },
    true,
  );

  return {
    setActive(tab: HTMLElement | null): void {
      if (open) close();
      at = tab;
      place();
    },
  };
}
