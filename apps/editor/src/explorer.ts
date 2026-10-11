// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Explorer in the left sidebar: one collapsible section per open machine, each holding that machine's model tree.
 * The sections are kept (not rebuilt) while the machine is open, so what the user expanded stays expanded.
 */

export interface ExplorerEntry {
  /** The section; append it to the explorer. */
  root: HTMLDetailsElement;
  /** Where the machine's model tree goes (tree.ts). */
  body: HTMLElement;
  /** Update name, tooltip, unsaved marker and highlight. */
  update(name: string, title: string, dirty: boolean, active: boolean): void;
}

export function explorerEntry(onActivate: () => void, onClose: () => void): ExplorerEntry {
  const root = document.createElement("details");
  root.className = "machine";
  root.open = true;
  const summary = document.createElement("summary");
  summary.className = "machine-row";
  const twisty = document.createElement("span");
  twisty.className = "twisty";
  twisty.setAttribute("aria-hidden", "true");
  const name = document.createElement("span");
  name.className = "machine-name";
  const dot = document.createElement("span");
  dot.className = "machine-dirty";
  dot.textContent = "●";
  dot.title = "Unsaved changes";
  const close = document.createElement("button");
  close.type = "button";
  close.className = "machine-close";
  close.textContent = "×";
  close.addEventListener("click", (e) => {
    e.preventDefault();
    e.stopPropagation();
    onClose();
  });
  summary.append(twisty, name, dot, close);
  // A click on another machine's row switches to it (and opens its section); on the active one it folds the section.
  let isActive = false;
  summary.addEventListener("click", (e) => {
    if (isActive) return;
    e.preventDefault();
    root.open = true;
    onActivate();
  });
  const body = document.createElement("div");
  body.className = "tree";
  root.append(summary, body);
  return {
    root,
    body,
    update(text, title, dirty, active) {
      name.textContent = text;
      summary.title = title;
      close.setAttribute("aria-label", `Close ${text}`);
      root.classList.toggle("dirty", dirty);
      root.classList.toggle("active", active);
      isActive = active;
    },
  };
}
