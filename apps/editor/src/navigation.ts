// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Moving around a machine: which sheet is shown (the root region, or an off-page region), entering a state, going up,
 * and showing an element picked in the explorer, the panel, the search or the Problems list.
 */
import type { Region, State, Vertex } from "@ufsm/core";
import { sheetOfRegion, sheetOfVertex } from "@ufsm/core/diagram";
import type { App } from "./app";
import { boxSelect, vertexBounds } from "./hit";
import { parentSheet } from "./nav";

export interface Navigation {
  /** Switch sheet. With `focus`, select that vertex and zoom to it. */
  showSheet(sheet: Region, focus?: Vertex): void;
  revealVertex(v: Vertex): void;
  /** "Enter" a state: open its off-page region, or zoom in on it if everything is inline. */
  enterState(s: State, region?: Region): void;
  enterSelected(): void;
  goUp(): void;
  goRoot(): void;
  /** A region picked in the explorer: its own sheet, or its state on the sheet it is drawn on. */
  onTreeRegion(r: Region): void;
  /** Select a vertex or transition from a link in the panel, switching sheet when it lives on another one. */
  selectFromPanel(id: string): void;
  /** Show the element a problem is about: a vertex, a transition, a region's or internal transition's state, a declaration. */
  jumpTo(id: string): void;
  /** Show an element picked in the search: a region's sheet (or its state), else what a problem's jump shows. */
  revealElement(id: string): void;
  selectAll(): void;
}

export function createNavigation(app: App): Navigation {
  const ws = app.ws;

  const showSheet = (sheet: Region, focus?: Vertex): void => {
    const d = ws.active;
    if (!d) return;
    if (sheet !== d.sheet) {
      d.views.set(d.sheet.id, { ...d.view });
      d.sheet = sheet;
      const saved = d.views.get(sheet.id);
      if (saved && !focus) Object.assign(d.view, saved);
      else app.canvas.fit();
    }
    if (focus) {
      d.selection = new Set([focus.id]);
      app.canvas.fitBounds(vertexBounds(d.index, focus.id), 1.5);
    }
    ws.changed("selection", "view");
  };

  const revealVertex = (v: Vertex): void => {
    const d = ws.active;
    if (d) showSheet(sheetOfVertex(d.index, v.id), v);
  };

  const enterState = (s: State, region?: Region): void => {
    const d = ws.active;
    if (!d) return;
    const offPage = (r: Region): boolean => d.index.doc.diagram?.regions[r.id]?.offPage === true;
    const target = region && offPage(region) ? region : s.regions?.find(offPage);
    if (target) {
      d.selection = new Set();
      showSheet(target);
    } else {
      ws.select([s.id]);
      app.canvas.fitBounds(vertexBounds(d.index, s.id), 1.5);
    }
  };

  const onTreeRegion = (r: Region): void => {
    const d = ws.active;
    if (!d) return;
    if (sheetOfRegion(d.index, r) === r) {
      d.selection = new Set();
      showSheet(r);
      app.canvas.fit();
      return;
    }
    showSheet(sheetOfRegion(d.index, r), d.index.regions.get(r.id)?.owner);
  };

  const jumpTo = (id: string): void => {
    const d = ws.active;
    if (!d) return;
    const index = d.index;
    if (index.decls.has(id)) {
      app.shell.highlightDecl(id);
      return;
    }
    const t = index.transitions.get(id);
    if (t) {
      const sheet = sheetOfVertex(index, t.from);
      if (sheet !== d.sheet) showSheet(sheet);
      ws.select([id]);
      return;
    }
    const vid = index.vertices.has(id)
      ? id
      : (index.internals.get(id)?.state.id ?? index.timers.get(id)?.state.id ?? index.regions.get(id)?.owner?.id);
    const v = vid ? index.vertices.get(vid)?.vertex : undefined;
    if (v) revealVertex(v);
  };

  return {
    showSheet,
    revealVertex,
    enterState,
    enterSelected: () => {
      const v = ws.single();
      if (v?.kind === "state") enterState(v);
    },
    goUp: () => {
      const d = ws.active;
      if (!d) return;
      const up = parentSheet(d.index, d.sheet);
      if (up) showSheet(up.sheet, up.owner);
    },
    goRoot: () => {
      const d = ws.active;
      if (d) showSheet(d.index.doc.machine.root);
    },
    onTreeRegion,
    selectFromPanel: (id) => {
      const d = ws.active;
      if (!d) return;
      const vid = d.index.vertices.has(id) ? id : d.index.transitions.get(id)?.from;
      if (!vid) return;
      const sheet = sheetOfVertex(d.index, vid);
      if (sheet !== d.sheet) showSheet(sheet);
      ws.select([id]);
    },
    jumpTo,
    revealElement: (id) => {
      const d = ws.active;
      if (!d) return;
      const r = d.index.regions.get(id);
      if (r) onTreeRegion(r.region);
      else jumpTo(id);
    },
    selectAll: () => {
      const d = ws.active;
      if (!d) return;
      const all = { x0: -Infinity, y0: -Infinity, x1: Infinity, y1: Infinity };
      ws.select(boxSelect(d.index, d.sheet, all, "enclosed"));
    },
  };
}
