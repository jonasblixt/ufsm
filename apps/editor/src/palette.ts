// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Tool palette at the top of the sidebar. A click picks a tool through the editor's interaction model (ePalette);
 * the highlight shows the tool the model has armed (setActive), so the palette, the `a` + key map and the Add menu
 * stay in step. Every tool except select is one-shot: it disarms after placing or connecting. There are two transition
 * tools: S transitions (a derived orthogonal route that follows its states) and straight ones (a free route: one line
 * between the states, or through the bend points clicked on the way).
 */

export type ToolId =
  | "select"
  | "state"
  | "region"
  | "transition"
  | "straight"
  | "initial"
  | "final"
  | "shallow-history"
  | "deep-history"
  | "fork"
  | "join"
  | "terminate";

interface ToolDef {
  id: ToolId;
  name: string;
  /** The old editor's key for the tool, after `a`. */
  keys?: string;
  /** SVG body for a 20x20 viewBox; drawn with currentColor. */
  icon: string;
}

const S = `fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"`;
const F = `fill="currentColor" stroke="none"`;
const arrow = (x: number, y: number): string => `<path d="M${x - 4} ${y - 3}L${x} ${y}L${x - 4} ${y + 3}" ${S}/>`;

/** Groups are separated in the palette. */
const GROUPS: ToolDef[][] = [
  [
    {
      id: "select",
      name: "Select",
      keys: "Esc",
      icon: `<path d="M5 3L5 16L8.5 12.5L11 17.5L13 16.5L10.5 11.5L15 11.5Z" ${S}/>`,
    },
  ],
  [
    {
      id: "state",
      name: "State",
      keys: "A S",
      icon: `<rect x="2.5" y="4" width="15" height="12" rx="2.5" ${S}/><path d="M2.5 8H17.5" ${S}/>`,
    },
    {
      id: "region",
      name: "Region",
      keys: "A R",
      icon: `<rect x="2.5" y="3" width="15" height="14" rx="2.5" ${S}/><path d="M2.5 7H17.5" ${S}/><path d="M2.5 12H17.5" ${S} stroke-dasharray="2 2"/>`,
    },
    // an orthogonal S: out, one jog, in (the shape the S route derives)
    { id: "transition", name: "S transition", keys: "A T", icon: `<path d="M2.5 15H9.5V5H17" ${S}/>${arrow(17, 5)}` },
    {
      id: "straight",
      name: "Straight transition",
      keys: "A L",
      icon: `<path d="M3 17L16.5 3.5" ${S}/><path d="M10.5 3.5H16.5V9.5" ${S}/>`,
    },
  ],
  [
    { id: "initial", name: "Initial state", keys: "A I", icon: `<circle cx="10" cy="10" r="5" ${F}/>` },
    {
      id: "final",
      name: "Final state",
      keys: "A F",
      icon: `<circle cx="10" cy="10" r="6" ${S}/><circle cx="10" cy="10" r="3.5" ${F}/>`,
    },
    {
      id: "shallow-history",
      name: "Shallow history",
      keys: "A H",
      icon: `<circle cx="10" cy="10" r="7" ${S}/><text x="10" y="13.5" text-anchor="middle" font-size="9" font-weight="700" font-family="sans-serif" ${F}>H</text>`,
    },
    {
      id: "deep-history",
      name: "Deep history",
      keys: "A Shift+H",
      icon: `<circle cx="10" cy="10" r="7" ${S}/><text x="10" y="13.5" text-anchor="middle" font-size="8" font-weight="700" font-family="sans-serif" ${F}>H*</text>`,
    },
    {
      id: "fork",
      name: "Fork",
      keys: "A Shift+F",
      icon: `<rect x="9" y="3" width="2.5" height="14" ${F}/><path d="M2 10H9" ${S}/><path d="M11.5 6H17M11.5 14H17" ${S}/>${arrow(17, 6)}${arrow(17, 14)}`,
    },
    {
      id: "join",
      name: "Join",
      keys: "A J",
      icon: `<rect x="8.5" y="3" width="2.5" height="14" ${F}/><path d="M2 6H8.5M2 14H8.5" ${S}/><path d="M11 10H17" ${S}/>${arrow(17, 10)}`,
    },
    {
      id: "terminate",
      name: "Terminate",
      keys: "A Shift+T",
      icon: `<path d="M4.5 4.5L15.5 15.5M15.5 4.5L4.5 15.5" ${S} stroke-width="2"/>`,
    },
  ],
];

export const TOOL_NAMES: Readonly<Record<ToolId, string>> = Object.fromEntries(
  GROUPS.flat().map((d) => [d.id, d.name]),
) as Record<ToolId, string>;
export const TOOL_KEYS: Readonly<Partial<Record<ToolId, string>>> = Object.fromEntries(
  GROUPS.flat().map((d) => [d.id, d.keys]),
) as Partial<Record<ToolId, string>>;

export interface Palette {
  readonly active: ToolId;
  /** Highlight a tool (what the interaction model has armed); does not call back. */
  setActive(id: ToolId): void;
  /** Disable the whole palette, e.g. while no model is open. */
  setEnabled(enabled: boolean): void;
}

export function buildPalette(container: HTMLElement, onPick: (id: ToolId) => void): Palette {
  const buttons = new Map<ToolId, { button: HTMLButtonElement; def: ToolDef }>();
  let active: ToolId = "select";
  let enabled = false;

  const heading = document.createElement("div");
  heading.className = "sidebar-heading";
  heading.textContent = "Tools";
  const grid = document.createElement("div");
  grid.className = "palette-grid";
  grid.setAttribute("role", "toolbar");
  grid.setAttribute("aria-label", "Tools");

  GROUPS.forEach((group, gi) => {
    if (gi > 0) {
      // Select | state, region, transition on the first row; pseudo-states on the second.
      const sep = document.createElement("span");
      sep.className = gi === 1 ? "palette-divider" : "palette-break";
      grid.append(sep);
    }
    for (const def of group) {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "tool";
      b.dataset["tool"] = def.id;
      b.title = def.keys ? `${def.name} (${def.keys})` : def.name;
      b.setAttribute("aria-label", def.name);
      b.innerHTML = `<svg viewBox="0 0 20 20" width="20" height="20" aria-hidden="true">${def.icon}</svg>`;
      b.addEventListener("click", () => onPick(def.id));
      buttons.set(def.id, { button: b, def });
      grid.append(b);
    }
  });
  container.replaceChildren(heading, grid);

  const refresh = (): void => {
    for (const [id, { button }] of buttons) {
      button.disabled = !enabled;
      button.classList.toggle("active", id === active);
      button.setAttribute("aria-pressed", String(id === active));
    }
  };

  const palette: Palette = {
    get active() {
      return active;
    },
    setActive(id) {
      if (id === active) return;
      active = id;
      refresh();
    },
    setEnabled(on) {
      enabled = on;
      refresh();
    },
  };
  refresh();
  return palette;
}
