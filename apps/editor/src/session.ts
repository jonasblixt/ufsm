// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * One open machine (a tab): the document and its undo steps, what is derived from it (index, design rule findings),
 * where it is shown (sheet, selection, pan/zoom per sheet) and its simulator session. Switching tabs swaps the whole
 * editing context. No DOM: the explorer section is attached by the shell (`explorer`), everything else is data.
 *
 * Queries take the session's `index`; every edit goes through `edit` (one undo step) or `begin`/`preview`/`commit`
 * (an interactive edit, previewed from its start). After either, `index` is a new object, so caches keyed by it
 * (WeakMaps in core and the editor) never see a stale document.
 */
import { checkV1, indexV1, type Diagnostic, type DocIndex, type LoadedModel, type Region, type UfsmDocument } from "@ufsm/core";
import type { View } from "./hit";
import { History } from "./history";
import type { SimHighlight } from "./render";
import type { Simulation, SimOptions } from "./sim";
import type { ExplorerEntry } from "./explorer";
import type { Tree } from "./tree";

export class DocSession {
  /** Stable key for the tab strip and the search rows. */
  readonly key: number;
  /** The document and its undo steps; `index` is always built from `history.current`. */
  readonly history: History<UfsmDocument>;
  index: DocIndex;
  fileName: string;
  /** Where Ctrl+S writes. Undefined until the document has been saved as v1. */
  path: string | undefined;
  /** History version that equals the file; -1 when no version does (converted from v0, never saved). */
  savedVersion: number;
  /** Made with File › New and never saved: the placeholder machine name, which the first save replaces by the file's name. */
  untitled: string | undefined;
  notes: LoadedModel["notes"];
  diagnostics: Diagnostic[];

  // ---- where it is shown
  sheet: Region;
  /** Selected vertex and transition ids. */
  selection = new Set<string>();
  /** Remembered pan/zoom per sheet so going back up restores the view. */
  readonly views = new Map<string, View>();
  /** Pan/zoom of the sheet on screen. */
  readonly view: View = { scale: 0.5, x: 0, y: 0 };
  /** Which generated file the Code tab shows. */
  codeView = "c-header";
  /** The explorer section and its tree, attached by the shell. */
  explorer: { entry: ExplorerEntry; tree: Tree; syncTree(): void } | undefined;

  // ---- simulator
  /** The running simulation (undefined: stopped) and why the last start failed. */
  sim: Simulation | undefined;
  simError: string | undefined;
  /** Guard values by guard name, kept across simulations; `guardsVersion` is bumped on every change. */
  readonly guards = new Map<string, boolean>();
  guardsVersion = 0;
  /** The session's overrides of the model's options for the simulator (the Simulator tab's Options). */
  simOptions: Partial<SimOptions> = {};
  /** Record the innermost active states in saved traces. */
  recordActive = true;
  /** Event under the pointer in the Simulator tab: its transitions are shown on the canvas. */
  hoverEvent: string | undefined;
  private would: { sim: Simulation; version: number; guards: number; map: Map<string, string[]> } | undefined;

  constructor(key: number, loaded: LoadedModel, fileName: string, path: string | undefined, untitled?: string) {
    const converted = loaded.sourceVersion === 0;
    this.key = key;
    this.history = new History(loaded.doc);
    this.index = indexV1(loaded.doc);
    this.fileName = fileName;
    // A converted v0 file is never overwritten silently: the first save asks where to put the v1 file.
    this.path = converted ? undefined : path;
    this.savedVersion = converted ? -1 : 0;
    this.untitled = untitled;
    this.notes = loaded.notes;
    this.diagnostics = checkV1(loaded.doc, this.index);
    this.sheet = this.index.doc.machine.root;
  }

  /** True when the in-memory document differs from the file. */
  get dirty(): boolean {
    return this.history.version !== this.savedVersion;
  }

  /** Rebuild everything derived from the document after an edit, undo or redo. `recheck` reruns the design rule check. */
  refresh(recheck = false): void {
    const index = indexV1(this.history.current);
    this.index = index;
    this.sheet = index.regions.get(this.sheet.id)?.region ?? index.doc.machine.root;
    this.selection = new Set([...this.selection].filter((id) => index.vertices.has(id) || index.transitions.has(id)));
    if (recheck) this.diagnostics = checkV1(index.doc, index);
    if (!this.history.editing) this.explorer?.syncTree();
  }

  /** Apply one edit as one undo step; false when it changed nothing. */
  edit(recipe: (d: UfsmDocument) => void): boolean {
    if (!this.history.edit((d) => recipe(d as UfsmDocument))) return false;
    this.refresh(true);
    return true;
  }

  undo(): boolean {
    if (!this.history.undo()) return false;
    this.refresh(true);
    return true;
  }

  redo(): boolean {
    if (!this.history.redo()) return false;
    this.refresh(true);
    return true;
  }

  /** Start an interactive edit (a drag, placing a vertex): previews start from the document as it is now. */
  begin(): void {
    this.history.begin();
  }

  /** Show the interactive edit at its current state (not an undo step yet). */
  preview(recipe: (d: UfsmDocument) => void): void {
    this.history.preview((d) => recipe(d as UfsmDocument));
    this.refresh();
  }

  /** Make the interactive edit one undo step. */
  commit(): void {
    this.refresh(this.history.commit());
  }

  cancel(): void {
    this.history.cancel();
    this.refresh();
  }

  // ---- simulator queries

  /** True when the machine changed since the simulation started (layout edits do not count). */
  get simStale(): boolean {
    return this.sim !== undefined && this.sim.staleFor(this.history.current);
  }

  /** Events that would take transitions now, recomputed only after a step or a guard change. */
  wouldMap(): Map<string, string[]> {
    const sim = this.sim;
    if (!sim || this.simStale) return new Map();
    const w = this.would;
    if (w && w.sim === sim && w.version === sim.version && w.guards === this.guardsVersion) return w.map;
    const map = new Map<string, string[]>();
    for (const e of sim.doc.declarations.events) {
      const ids = sim.wouldTake(e.name);
      if (ids.length) map.set(e.name, ids);
    }
    this.would = { sim, version: sim.version, guards: this.guardsVersion, map };
    return map;
  }

  /** What the canvas shows of the simulation: active states, the last step's transitions, the hovered event's. */
  simHighlight(): SimHighlight | undefined {
    const sim = this.sim;
    if (!sim || this.simStale) return undefined;
    return {
      active: new Set(sim.activeIds()),
      leaves: new Set(sim.leafIds()),
      fired: sim.fired,
      would: new Set(this.hoverEvent ? (this.wouldMap().get(this.hoverEvent) ?? []) : []),
    };
  }
}
