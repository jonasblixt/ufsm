// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Model tree sidebar: states and regions as a collapsible outline.
 * Clicking a label navigates; the disclosure arrow only expands/collapses.
 */
import { ancestors, type DocIndex, type Region, type State, type Vertex } from "@ufsm/core";
import { isOffPage } from "@ufsm/core/diagram";

export interface TreeCallbacks {
  onState(state: State): void;
  onRegion(region: Region): void;
}

export interface Tree {
  /** Highlight a vertex and expand its ancestors. */
  reveal(id: string | undefined): void;
  /** Mark which sheet is currently shown. */
  setSheet(sheetId: string): void;
}

/** Pseudo states (initial, history, fork, …) are left out to keep the outline readable. */
function listed(v: Vertex): v is State {
  return v.kind === "state";
}

function twisty(leaf = false): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = leaf ? "twisty leaf" : "twisty";
  span.setAttribute("aria-hidden", "true");
  return span;
}

function label(text: string, cls: string, title?: string): HTMLSpanElement {
  const span = document.createElement("span");
  span.className = `label ${cls}`;
  span.textContent = text;
  if (title) span.title = title;
  return span;
}

export function buildTree(container: HTMLElement, index: DocIndex, cb: TreeCallbacks): Tree {
  container.replaceChildren();
  const stateNodes = new Map<string, { row: HTMLElement; details?: HTMLDetailsElement }>();
  const regionRows = new Map<string, HTMLElement>();
  const regionDetails = new Map<string, HTMLDetailsElement>();

  const onLabel = (details: HTMLDetailsElement | undefined, go: () => void) => (e: MouseEvent) => {
    e.preventDefault(); // don't let <summary> toggle; navigate instead
    if (details) details.open = true;
    go();
  };

  const stateNode = (s: State, depth: number): HTMLElement => {
    const children = (s.regions ?? []).filter((r) => r.states.some(listed) || isOffPage(index, r.id));
    const lbl = label(s.name || "(unnamed)", "state");
    if (children.length === 0) {
      const row = document.createElement("div");
      row.className = "row";
      row.append(twisty(true), lbl);
      row.addEventListener("click", onLabel(undefined, () => cb.onState(s)));
      stateNodes.set(s.id, { row });
      return row;
    }
    const details = document.createElement("details");
    details.open = depth < 1;
    const summary = document.createElement("summary");
    summary.className = "row";
    summary.append(twisty(), lbl);
    lbl.addEventListener("click", onLabel(details, () => cb.onState(s)));
    details.append(summary);
    for (const r of children) details.append(regionNode(r, depth + 1));
    stateNodes.set(s.id, { row: summary, details });
    return details;
  };

  const regionNode = (r: Region, depth: number): HTMLElement => {
    const offPage = isOffPage(index, r.id);
    const details = document.createElement("details");
    details.open = depth < 2 && !offPage;
    const summary = document.createElement("summary");
    summary.className = "row";
    const lbl = label(r.name || "(region)", offPage ? "region off-page" : "region", offPage ? "Off-page region: opens on its own sheet" : undefined);
    lbl.addEventListener("click", onLabel(details, () => cb.onRegion(r)));
    summary.append(twisty(), lbl);
    details.append(summary);
    for (const s of r.states.filter(listed)) details.append(stateNode(s, depth + 1));
    regionRows.set(r.id, summary);
    regionDetails.set(r.id, details);
    return details;
  };

  const root = index.doc.machine.root;
  const rootRow = document.createElement("div");
  rootRow.className = "row root";
  rootRow.append(twisty(true), label(index.doc.name, "model"));
  rootRow.addEventListener("click", () => cb.onRegion(root));
  regionRows.set(root.id, rootRow);
  container.append(rootRow);
  for (const s of root.states.filter(listed)) container.append(stateNode(s, 0));

  let active: HTMLElement | undefined;
  let activeSheet: HTMLElement | undefined;

  return {
    reveal(id) {
      active?.classList.remove("active");
      active = undefined;
      if (!id) return;
      const node = stateNodes.get(id);
      if (!node) return;
      // Open every ancestor state and the region each one (and the target) lives in.
      for (const s of [...ancestors(index, id), { id }]) {
        const n = stateNodes.get(s.id);
        if (n?.details && s.id !== id) n.details.open = true;
        const parent = index.vertices.get(s.id)?.region;
        const rd = parent && regionDetails.get(parent.id);
        if (rd) rd.open = true;
      }
      active = node.row;
      active.classList.add("active");
      active.scrollIntoView({ block: "nearest" });
    },
    setSheet(sheetId) {
      activeSheet?.classList.remove("sheet");
      activeSheet = regionRows.get(sheetId);
      activeSheet?.classList.add("sheet");
    },
  };
}
