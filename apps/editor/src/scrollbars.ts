// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Scrollbars show only while an area scrolls (style.css hides the thumb unless the element has `.scrolling`).
 * Scroll events do not bubble, so one capturing listener on the document sees every scrolling element.
 */
const HIDE_AFTER_MS = 900;

export function autoHideScrollbars(): void {
  const timers = new WeakMap<Element, number>();
  document.addEventListener(
    "scroll",
    (e) => {
      const target = e.target === document ? document.scrollingElement : e.target;
      if (!(target instanceof Element)) return;
      target.classList.add("scrolling");
      clearTimeout(timers.get(target));
      timers.set(
        target,
        window.setTimeout(() => target.classList.remove("scrolling"), HIDE_AFTER_MS),
      );
    },
    { capture: true, passive: true },
  );
}

/** Let the mouse wheel scroll a horizontal strip (the tab bar), as in VS Code. */
export function wheelScrollsHorizontally(el: HTMLElement): void {
  el.addEventListener(
    "wheel",
    (e) => {
      if (e.deltaY === 0 || Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      if (el.scrollWidth <= el.clientWidth) return;
      e.preventDefault();
      el.scrollLeft += e.deltaY;
    },
    { passive: false },
  );
}
