// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Draggable divider between the canvas and a side panel. The width lives in a CSS custom property on <html> and is
 * remembered per browser profile (localStorage, best effort). Double-click restores the default width.
 */
export interface SashOptions {
  /** CSS custom property holding the panel width in px, e.g. "--sidebar-w". */
  property: string;
  /** Which side of the canvas the panel is on: dragging away from the canvas widens it. */
  side: "left" | "right";
  initial: number;
  min: number;
  max: number;
  storageKey: string;
  /** How much the panel is zoomed (UI zoom): the pointer moves in screen pixels, the width is in the panel's own. */
  scale?: () => number;
}

function load(key: string): number | undefined {
  try {
    const v = Number(localStorage.getItem(key));
    return Number.isFinite(v) && v > 0 ? v : undefined;
  } catch {
    return undefined;
  }
}

function store(key: string, value: number): void {
  try {
    localStorage.setItem(key, String(value));
  } catch {
    // private mode or blocked storage: the width just isn't remembered
  }
}

export function attachSash(sash: HTMLElement, o: SashOptions): void {
  const root = document.documentElement;
  const clamp = (w: number): number => Math.round(Math.min(Math.max(w, o.min), o.max));
  const set = (w: number): void => root.style.setProperty(o.property, `${clamp(w)}px`);
  set(load(o.storageKey) ?? o.initial);

  let start: { x: number; w: number; id: number } | undefined;
  sash.addEventListener("pointerdown", (e) => {
    if (e.button !== 0) return;
    e.preventDefault();
    const w = parseFloat(getComputedStyle(root).getPropertyValue(o.property)) || o.initial;
    start = { x: e.clientX, w, id: e.pointerId };
    sash.setPointerCapture(e.pointerId);
    sash.classList.add("active");
  });
  sash.addEventListener("pointermove", (e) => {
    if (!start || e.pointerId !== start.id) return;
    const dx = (e.clientX - start.x) / (o.scale?.() ?? 1);
    set(start.w + (o.side === "left" ? dx : -dx));
  });
  const end = (e: PointerEvent): void => {
    if (!start || e.pointerId !== start.id) return;
    start = undefined;
    sash.classList.remove("active");
    store(o.storageKey, parseFloat(getComputedStyle(root).getPropertyValue(o.property)));
  };
  sash.addEventListener("pointerup", end);
  sash.addEventListener("pointercancel", end);
  sash.addEventListener("dblclick", () => {
    set(o.initial);
    store(o.storageKey, o.initial);
  });
}
