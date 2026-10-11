// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Structure edits on the selection, as the menus and keys run them: delete, copy/cut/paste, add a region or a bend
 * point, convert routes to S, turn a fork/join bar, put a region on its own sheet. Each is one undo step (ws.edit).
 */
import {
  addRegion,
  cannotOffPage,
  copyFragment,
  deleteElements,
  insertBendPoint,
  pasteFragment,
  regionAt,
  setBarOrientation,
  setOffPage,
  toSRoute,
} from "@ufsm/core/edit";
import { edgeGeometry, type Point } from "@ufsm/core/diagram";
import type { App } from "./app";
import { hitTest } from "./hit";

export interface EditCommands {
  deleteSelection(): void;
  /** Copy the selected states (and the transitions between them); false when nothing could be copied. */
  copySelection(): boolean;
  cutSelection(): void;
  pasteClipboard(): void;
  addRegionTo(stateId: string): void;
  /** Add › Region: a region for the selected state, else arm the region tool. */
  addRegionOrTool(): void;
  /** Add a bend point to the selected transition: at the pointer when it is over the canvas, else mid-route. */
  addBendPointToSelected(): void;
  /** Selected transitions with free routes. */
  freeRoutesSelected(): string[];
  /** Selected transitions with free routes become S routes with automatic ends. */
  convertToS(): void;
  /** Turn the selected fork or join bar. */
  turnBar(): void;
  /** Put the region under the pointer (or the selected state's only region) on its own sheet, or back inline. */
  toggleOffPage(): void;
}

export function createEditCommands(app: App): EditCommands {
  const ws = app.ws;

  /** Where paste puts things: the pointer while it is over the canvas, else the middle of the view. */
  const targetPoint = (): Point => {
    const i = app.input;
    if (i.over) return app.canvas.worldAt(i.x, i.y);
    const r = app.canvas.canvas.getBoundingClientRect();
    return app.canvas.worldAt(r.left + r.width / 2, r.top + r.height / 2);
  };

  const deleteSelection = (): void => {
    const d = ws.active;
    if (!d || d.selection.size === 0) return;
    const ids = [...d.selection];
    ws.edit((x) => void deleteElements(x, ids));
  };

  const copySelection = (): boolean => {
    const d = ws.active;
    if (!d) return false;
    const frag = copyFragment(d.index, d.selection);
    if (!frag) {
      ws.say("Select the states to copy (a transition comes along when both its ends do).");
      return false;
    }
    ws.clipboard = { frag, key: d.key };
    const t = frag.transitions.length;
    ws.say(`Copied ${frag.vertices.length} state${frag.vertices.length > 1 ? "s" : ""}${t ? ` and ${t} transition${t > 1 ? "s" : ""}` : ""}`);
    return true;
  };

  const addRegionTo = (stateId: string): void => ws.edit((x) => void addRegion(x, stateId));

  const freeRoutesSelected = (): string[] => {
    const d = ws.active;
    if (!d) return [];
    return [...d.selection].filter((id) => d.index.transitions.has(id) && d.index.doc.diagram?.transitions[id]?.route !== "s");
  };

  return {
    deleteSelection,
    copySelection,
    cutSelection: () => {
      if (copySelection()) deleteSelection();
    },
    pasteClipboard: () => {
      const d0 = ws.active, c = ws.clipboard;
      if (!d0) return;
      if (!c) {
        ws.say("Nothing to paste: copy (Ctrl+C) or cut (Ctrl+X) states first.");
        return;
      }
      const at = targetPoint();
      const region = regionAt(d0.index, d0.sheet, at);
      let ids: string[] = [];
      ws.edit((d) => void (ids = pasteFragment(d, c.frag, region.id, at, { keepOuterStateRefs: c.key === d0.key })));
      ws.select(ids);
    },
    addRegionTo,
    addRegionOrTool: () => {
      const v = ws.single();
      if (v?.kind === "state") addRegionTo(v.id);
      else app.pickTool("region");
    },
    addBendPointToSelected: () => {
      const id = ws.singleTransition();
      const d = ws.active;
      if (!d || !id) return;
      let p = targetPoint();
      if (!app.input.over) {
        const pts = edgeGeometry(d.index, id)?.points ?? [];
        const k = Math.max(Math.floor((pts.length - 2) / 2), 0);
        const a = pts[k], b = pts[k + 1];
        if (a && b) p = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      }
      ws.edit((x) => void insertBendPoint(x, id, p));
    },
    freeRoutesSelected,
    convertToS: () => {
      const ids = freeRoutesSelected();
      if (ids.length) ws.edit((d) => ids.forEach((id) => toSRoute(d, id)));
    },
    turnBar: () => {
      const v = ws.single();
      const d = ws.active;
      if (!d || (v?.kind !== "fork" && v?.kind !== "join")) return;
      const horizontalNow = d.index.doc.diagram?.states[v.id]?.orientation === "horizontal";
      ws.edit((x) => setBarOrientation(x, v.id, !horizontalNow));
    },
    toggleOffPage: () => {
      const v = ws.single();
      const d = ws.active;
      if (!d || v?.kind !== "state") return;
      const regions = v.regions ?? [];
      // the region under the pointer, else the state's only region
      const p = app.canvas.worldAt(app.input.x, app.input.y);
      const hit = app.input.over ? hitTest(d.index, d.sheet, p.x, p.y).region : undefined;
      const r = regions.find((x) => x.id === hit?.id) ?? (regions.length === 1 ? regions[0] : undefined);
      if (!r) {
        ws.say(regions.length ? "Point at the region to put on its own sheet (e O)." : `${v.name} has no regions.`);
        return;
      }
      const off = d.index.doc.diagram?.regions[r.id]?.offPage === true;
      const why = off ? undefined : cannotOffPage(d.index, r.id);
      if (why) ws.say(why);
      else ws.edit((x) => setOffPage(x, r.id, !off));
    },
  };
}
