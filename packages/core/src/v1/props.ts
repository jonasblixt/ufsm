// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Property edits: what the editor's Properties and Project panels change. Names, documentation, entry/exit actions,
 * triggers, guards and actions of transitions (internal ones too), regions (name, off-page), fork/join orientation,
 * declarations (add, rename, delete) and the file-level settings (name, description, paper size, title block fields,
 * generator options). Every function mutates the document it is given
 * (an Immer draft in the editor). Checks that need a message for the user are separate (`declNameProblem`,
 * `cannotOffPage`); the setters assume their input passed them.
 *
 * References are by id, so renaming a declaration or a state changes nothing else: every label, guard and generated
 * name follows. Deleting a declaration removes its uses (see deleteDecl).
 */
import { commonRegion, indexV1, type DocIndex } from "./doc-index";
import { diagramOf, regionLayoutOf } from "./edit";
import { regionBoxes, stateLayout, vertexBox } from "./geometry";
import { DECL_PREFIX, ID_PREFIX, IdAllocator } from "./ids";
import type { OptionKey } from "./options";
import {
  IDENTIFIER,
  type Action,
  type Decl,
  type DeclKind,
  type GuardTerm,
  type Id,
  type InternalTransition,
  type Paper,
  type Region,
  type State,
  type TitleBlock,
  type Transition,
  type UfsmDocument,
} from "./model";

export const DECL_LISTS = { event: "events", signal: "signals", action: "actions", guard: "guards" } as const;

const DECL_TEXT: Record<DeclKind, string> = { event: "an event", signal: "a signal", action: "an action", guard: "a guard" };

/** Why `name` cannot name a declaration (a message for the user), or undefined. `except` is the one being renamed. */
export function declNameProblem(index: DocIndex, name: string, except?: Id): string | undefined {
  if (name === "") return "A name is needed.";
  if (!IDENTIFIER.test(name)) return `'${name}' is not an identifier: letters, digits and _, not starting with a digit.`;
  for (const { kind, decl } of index.decls.values()) {
    if (decl.name === name && decl.id !== except) return `'${name}' is already declared as ${DECL_TEXT[kind]}.`;
  }
  return undefined;
}

/** Add a declaration; returns its id. Check declNameProblem first. */
export function addDecl(doc: UfsmDocument, kind: DeclKind, name: string, opts: { ids?: IdAllocator } = {}): Id {
  const id = (opts.ids ?? new IdAllocator(doc)).take(DECL_PREFIX[kind]);
  doc.declarations[DECL_LISTS[kind]].push({ id, name });
  return id;
}

function findDecl(doc: UfsmDocument, id: Id): { kind: DeclKind; decl: Decl; list: Decl[] } | undefined {
  for (const kind of ["event", "signal", "action", "guard"] as const) {
    const list = doc.declarations[DECL_LISTS[kind]];
    const decl = list.find((d) => d.id === id);
    if (decl) return { kind, decl, list };
  }
  return undefined;
}

/** Rename a declaration (check declNameProblem first). Its uses refer to it by id, so they follow. */
export function renameDecl(doc: UfsmDocument, id: Id, name: string): void {
  const d = findDecl(doc, id);
  if (d && d.decl.name !== name) d.decl.name = name;
}

/** Every place that uses a declaration, as the ids of the elements (states, transitions, internal transitions). */
export function declUses(index: DocIndex, id: Id): Id[] {
  const out: Id[] = [];
  const inActions = (list: Action[] | undefined): boolean => !!list?.some((a) => ("call" in a ? a.call : a.emit) === id);
  const inGuard = (list: GuardTerm[] | undefined): boolean => !!list?.some((g) => "call" in g && g.call === id);
  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind !== "state") continue;
    if (inActions(vertex.entry) || inActions(vertex.exit)) out.push(vertex.id);
    for (const t of vertex.internal ?? []) if (t.on === id || inGuard(t.guard) || inActions(t.do)) out.push(t.id);
  }
  for (const t of index.doc.machine.transitions) if (t.on === id || inGuard(t.guard) || inActions(t.do)) out.push(t.id);
  return out;
}

/** Drop the list when it became empty. */
function setList<O extends object, K extends keyof O>(o: O, k: K, list: NonNullable<O[K]> & unknown[]): void {
  if (list.length) o[k] = list;
  else delete o[k];
}

/**
 * Delete a declaration and its uses: action calls and emits are removed from entry, exit and transition actions,
 * guard terms calling it are removed (an empty guard goes), transitions triggered by it lose their trigger, and
 * internal transitions triggered by it are deleted (they need a trigger).
 */
export function deleteDecl(doc: UfsmDocument, id: Id): void {
  const d = findDecl(doc, id);
  if (!d) return;
  d.list.splice(d.list.indexOf(d.decl), 1);
  const keepA = (a: Action): boolean => ("call" in a ? a.call : a.emit) !== id;
  const keepG = (g: GuardTerm): boolean => !("call" in g) || g.call !== id;
  const clean = (t: { guard?: GuardTerm[]; do?: Action[] }): void => {
    if (t.guard?.some((g) => !keepG(g))) setList(t, "guard", t.guard.filter(keepG));
    if (t.do?.some((a) => !keepA(a))) setList(t, "do", t.do.filter(keepA));
  };
  const visit = (r: Region): void => {
    for (const v of r.states) {
      if (v.kind !== "state") continue;
      if (v.entry?.some((a) => !keepA(a))) setList(v, "entry", v.entry.filter(keepA));
      if (v.exit?.some((a) => !keepA(a))) setList(v, "exit", v.exit.filter(keepA));
      if (v.internal) {
        if (v.internal.some((t) => t.on === id)) setList(v, "internal", v.internal.filter((t) => t.on !== id));
        v.internal?.forEach(clean);
      }
      v.regions?.forEach(visit);
    }
  };
  visit(doc.machine.root);
  for (const t of doc.machine.transitions) {
    if (t.on === id) delete t.on;
    clean(t);
  }
}

/** Set (or with "" remove) the `doc` text of a declaration, state, transition or internal transition. */
export function setDocText(doc: UfsmDocument, id: Id, text: string): void {
  const index = indexV1(doc);
  const target: { doc?: string } | undefined =
    index.decls.get(id)?.decl ??
    (index.vertices.get(id)?.vertex.kind === "state" ? (index.vertices.get(id)!.vertex as State) : undefined) ??
    index.transitions.get(id) ??
    index.internals.get(id)?.transition;
  if (!target) return;
  if (text === "") delete target.doc;
  else if (target.doc !== text) target.doc = text;
}

/** The machine's own name and description. */
export function setMachineName(doc: UfsmDocument, name: string): void {
  if (doc.name !== name) doc.name = name;
}

export function setMachineDoc(doc: UfsmDocument, text: string): void {
  if (text === "") delete doc.doc;
  else if (doc.doc !== text) doc.doc = text;
}

/** The sheet size of every page (Project tab). Nothing moves: content beyond a smaller sheet stays where it is. */
export function setPaper(doc: UfsmDocument, paper: Paper): void {
  const d = diagramOf(doc);
  if (d.paper !== paper) d.paper = paper;
}

/**
 * One free field of the title block (Project tab); the text is trimmed, an empty text removes the field (and the block
 * when it was the last). The other cells come from the model (`titleBlockCells`).
 */
export function setTitleField(doc: UfsmDocument, key: keyof TitleBlock, text: string): void {
  const d = diagramOf(doc);
  const v = text.trim();
  if (v === "") {
    if (!d.titleBlock || d.titleBlock[key] === undefined) return;
    delete d.titleBlock[key];
    if (Object.keys(d.titleBlock).length === 0) delete d.titleBlock;
    return;
  }
  if (d.titleBlock?.[key] !== v) (d.titleBlock ??= {})[key] = v;
}

/** Set one option of the `options` section, or remove it with undefined (an empty section goes too). */
export function setModelOption(doc: UfsmDocument, key: OptionKey, value: number | undefined): void {
  if (value === undefined) {
    if (doc.options?.[key] === undefined) return;
    delete doc.options[key];
    if (Object.keys(doc.options).length === 0) delete doc.options;
    return;
  }
  if (doc.options?.[key] !== value) (doc.options ??= {})[key] = value;
}

/** Set one code generator setting (`targets[target][key]`), or remove it with undefined (empty targets go too). */
export function setTargetOption(doc: UfsmDocument, target: string, key: string, value: string | number | boolean | undefined): void {
  if (value === undefined) {
    const t = doc.targets?.[target];
    if (!t || !(key in t)) return;
    delete t[key];
    if (Object.keys(t).length === 0) delete doc.targets![target];
    if (Object.keys(doc.targets!).length === 0) delete doc.targets;
    return;
  }
  const t = ((doc.targets ??= {})[target] ??= {});
  if (t[key] !== value) t[key] = value;
}

/** Rename a state (free text), or name a pseudo state (empty removes the name). */
export function renameVertex(doc: UfsmDocument, id: Id, name: string): void {
  const v = indexV1(doc).vertices.get(id)?.vertex;
  if (!v) return;
  if (v.kind === "state") {
    if (v.name !== name) v.name = name;
  } else if (name === "") delete v.name;
  else if (v.name !== name) v.name = name;
}

/** Name a region (empty removes the name). */
export function renameRegion(doc: UfsmDocument, id: Id, name: string): void {
  const r = indexV1(doc).regions.get(id)?.region;
  if (!r) return;
  if (name === "") delete r.name;
  else if (r.name !== name) r.name = name;
}

/** Entry or exit actions of a state, in order. */
export function setStateActions(doc: UfsmDocument, stateId: Id, which: "entry" | "exit", actions: Action[]): void {
  const v = indexV1(doc).vertices.get(stateId)?.vertex;
  if (v?.kind === "state") setList(v, which, actions.map((a) => ({ ...a })));
}

/** A transition or internal transition by id. */
function transitionOf(doc: UfsmDocument, id: Id): Transition | InternalTransition | undefined {
  const index = indexV1(doc);
  return index.transitions.get(id) ?? index.internals.get(id)?.transition;
}

/** Actions of a transition or internal transition, in order. */
export function setTransitionActions(doc: UfsmDocument, transitionId: Id, actions: Action[]): void {
  const t = transitionOf(doc, transitionId);
  if (t) setList(t, "do", actions.map((a) => ({ ...a })));
}

/** Guard terms of a transition or internal transition (all must hold). */
export function setGuard(doc: UfsmDocument, transitionId: Id, terms: GuardTerm[]): void {
  const t = transitionOf(doc, transitionId);
  if (t) setList(t, "guard", terms.map((g) => ({ ...g })));
}

export type TriggerSpec = { on: Id } | { auto: true } | { completion: true } | undefined;

/** The trigger of a transition: an event or signal, auto, completion or none. An internal transition takes only `on`. */
export function setTrigger(doc: UfsmDocument, transitionId: Id, trigger: TriggerSpec): void {
  const index = indexV1(doc);
  const t = index.transitions.get(transitionId);
  if (t) {
    delete t.on;
    delete t.auto;
    delete t.completion;
    if (trigger) Object.assign(t, trigger);
    return;
  }
  const it = index.internals.get(transitionId)?.transition;
  if (it && trigger && "on" in trigger) it.on = trigger.on;
}

/** Add an internal transition on event or signal `on` to a state; returns its id. */
export function addInternal(doc: UfsmDocument, stateId: Id, on: Id, opts: { ids?: IdAllocator } = {}): Id | undefined {
  const v = indexV1(doc).vertices.get(stateId)?.vertex;
  if (v?.kind !== "state") return undefined;
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.transition);
  (v.internal ??= []).push({ id, on });
  return id;
}

/**
 * Why a region cannot be put on a page of its own: transitions between its contents and the rest of the machine
 * would cross sheets. Undefined when it can (or is off-page already).
 */
export function cannotOffPage(index: DocIndex, regionId: Id): string | undefined {
  const info = index.regions.get(regionId);
  if (!info?.owner) return "The root region is a page already.";
  const inside = new Set<Id>();
  const visit = (r: Region): void => {
    for (const v of r.states) {
      inside.add(v.id);
      if (v.kind === "state") v.regions?.forEach(visit);
    }
  };
  visit(info.region);
  const crossing = index.doc.machine.transitions.filter((t) => inside.has(t.from) !== inside.has(t.to));
  if (crossing.length) {
    return `${crossing.length} transition${crossing.length > 1 ? "s" : ""} cross${crossing.length > 1 ? "" : "es"} the region's border; an off-page region must be self-contained.`;
  }
  return undefined;
}

/**
 * Put a region on a page of its own, or back inline. Its contents keep their place relative to the region's band:
 * off-page, a vertex at (x, y) in the band goes to (x, y) on the new sheet; inline again, the reverse. Bend points,
 * free labels and jogs of the transitions inside it move with them. Check cannotOffPage before going off-page.
 */
export function setOffPage(doc: UfsmDocument, regionId: Id, offPage: boolean): void {
  const index = indexV1(doc);
  const info = index.regions.get(regionId);
  if (!info?.owner || (index.doc.diagram?.regions[regionId]?.offPage === true) === offPage) return;
  const band = regionBoxes(index, info.owner).find((b) => b.region.id === regionId)!.box;
  // inline coordinates are relative to the owner's corner, a sheet's to its origin; a band spans the owner's width,
  // so only y changes
  const dy = band.y - vertexBox(index, info.owner.id).y;
  const sx = 0, sy = offPage ? -dy : dy;
  const l = regionLayoutOf(doc, regionId);
  if (offPage) l.offPage = true;
  else {
    delete l.offPage;
    if (Object.keys(l).length === 0) delete diagramOf(doc).regions[regionId];
  }
  const dia = diagramOf(doc);
  for (const v of info.region.states) {
    const s = (dia.states[v.id] ??= { ...stateLayout(index, v.id) });
    s.x += sx;
    s.y += sy;
  }
  for (const t of doc.machine.transitions) {
    const e = dia.transitions[t.id];
    if (!e || commonRegion(index, t.from, t.to).id !== regionId) continue;
    if (e.route === "s") {
      if (e.jog) e.jog = "x" in e.jog ? { x: e.jog.x + sx } : { y: e.jog.y + sy };
    } else {
      if (e.via) e.via = e.via.map(([x, y]) => [x + sx, y + sy]);
      if (e.label) e.label = { ...e.label, x: e.label.x + sx, y: e.label.y + sy };
    }
  }
}

/** Turn a fork or join bar: horizontal or vertical, keeping its centre and length. */
export function setBarOrientation(doc: UfsmDocument, id: Id, horizontal: boolean): void {
  const index = indexV1(doc);
  const v = index.vertices.get(id)?.vertex;
  if (v?.kind !== "fork" && v?.kind !== "join") return;
  const l = (diagramOf(doc).states[id] ??= { ...stateLayout(index, id) });
  if ((l.orientation === "horizontal") === horizontal) return;
  const cx = l.x + l.w / 2, cy = l.y + l.h / 2;
  const long = Math.max(l.w, l.h), thick = Math.min(l.w, l.h);
  [l.w, l.h] = horizontal ? [long, thick] : [thick, long];
  l.x = Math.round(cx - l.w / 2);
  l.y = Math.round(cy - l.h / 2);
  if (horizontal) l.orientation = "horizontal";
  else delete l.orientation;
}
