// The bar's four tabs (design/spec.md, The bar and its tabs): Read, Face,
// Rules, Card, under one chalk underline that glides to the chosen tab with
// the `underline` preset (a CSS transition on transform only, over
// --dur-underline and --ease-underline from the token file; reduced motion
// collapses it to a jump). A surface that is not built yet is never a dead
// tab: it opens a drop cloth that says when it arrives and offers Read.

const SOON: Record<string, string> = {
  face: "Face arrives after the Rulebook. Read an outfit meanwhile.",
  card: "Card is not built yet. Read an outfit meanwhile.",
};

export function setupTabs(opts: { onRead?: boolean } = {}): void {
  const nav = document.querySelector<HTMLElement>("nav.tabs");
  if (!nav) return;
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
  const show = (tab: HTMLElement) => {
    const which = tab.dataset.soon ?? "";
    if (open === tab) return close();
    open?.setAttribute("aria-expanded", "false");
    open = tab;
    tab.setAttribute("aria-expanded", "true");
    title.textContent = SOON[which] ?? "";
    cloth.hidden = false;
    document.body.dataset.soon = which;
    at = tab;
    place();
    title.focus({ preventScroll: true });
  };

  for (const tab of tabs) {
    if (tab.dataset.soon) {
      tab.setAttribute("aria-controls", "soon");
      tab.setAttribute("aria-expanded", "false");
      tab.addEventListener("click", () => show(tab));
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
  addEventListener("keydown", (e) => {
    if (e.key === "Escape" && open) {
      const tab = open;
      close();
      tab.focus();
    }
  });
}
