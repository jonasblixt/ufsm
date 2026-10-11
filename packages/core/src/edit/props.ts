// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Property edits: what the editor's Properties and Project panels change. Names, documentation, entry/exit actions,
 * triggers, guards and actions of transitions (internal ones too), timers, region names, declarations (add, rename, delete) and the file-level settings (name, description, paper size, title block fields,
 * generator options). Every function mutates the document it is given
 * (an Immer draft in the editor). Checks that need a message for the user are separate (`declNameProblem`);
 * the setters assume their input passed them. Putting a region on its own sheet and turning a bar are layout edits
 * (layout.ts).
 *
 * References are by id, so renaming a declaration or a state changes nothing else: every label, guard and generated
 * name follows. Deleting a declaration removes its uses (see deleteDecl).
 */
import { indexV1, type DocIndex } from "../model/doc-index";
import { diagramOf } from "./layout";
import { DECL_PREFIX, ID_PREFIX, IdAllocator } from "../format/ids";
import type { OptionKey } from "../format/options";
import {
  IDENTIFIER,
  TIMER_MAX_MS,
  TIMER_UNIT_MS,
  type Action,
  type Decl,
  type DeclKind,
  type GuardTerm,
  type Id,
  type InternalTransition,
  type ModelOptions,
  type Paper,
  type Region,
  type State,
  type Timer,
  type TimerUnit,
  type TitleBlock,
  type Transition,
  type UfsmDocument,
} from "../format/model";

export const DECL_LISTS = { event: "events", signal: "signals", action: "actions", guard: "guards" } as const;

const DECL_TEXT: Record<DeclKind, string> = {
  event: "an event",
  signal: "a signal",
  action: "an action",
  guard: "a guard",
};

/** Why `name` cannot name a declaration (a message for the user), or undefined. `except` is the one being renamed. */
export function declNameProblem(index: DocIndex, name: string, except?: Id): string | undefined {
  if (name === "") return "A name is needed.";
  if (!IDENTIFIER.test(name))
    return `'${name}' is not an identifier: letters, digits and _, not starting with a digit.`;
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

/** Every place that uses a declaration, as the ids of the elements (states, transitions, internal transitions, timers). */
export function declUses(index: DocIndex, id: Id): Id[] {
  const out: Id[] = [];
  const inActions = (list: Action[] | undefined): boolean =>
    !!list?.some((a) => ("call" in a ? a.call : a.emit) === id);
  const inGuard = (list: GuardTerm[] | undefined): boolean => !!list?.some((g) => "call" in g && g.call === id);
  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind !== "state") continue;
    if (inActions(vertex.entry) || inActions(vertex.exit)) out.push(vertex.id);
    for (const t of vertex.timers ?? []) if (t.event === id) out.push(t.id);
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
 * internal transitions triggered by it and timers firing it are deleted (they need one).
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
      if (v.timers?.some((t) => t.event === id))
        setList(
          v,
          "timers",
          v.timers.filter((t) => t.event !== id),
        );
      if (v.internal) {
        if (v.internal.some((t) => t.on === id))
          setList(
            v,
            "internal",
            v.internal.filter((t) => t.on !== id),
          );
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

/** Set (or with "" remove) the `doc` text of a declaration, state, transition, internal transition or timer. */
export function setDocText(doc: UfsmDocument, id: Id, text: string): void {
  const index = indexV1(doc);
  const target: { doc?: string } | undefined =
    index.decls.get(id)?.decl ??
    (index.vertices.get(id)?.vertex.kind === "state" ? (index.vertices.get(id)!.vertex as State) : undefined) ??
    index.transitions.get(id) ??
    index.internals.get(id)?.transition ??
    index.timers.get(id)?.timer;
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
export function setModelOption<K extends OptionKey>(
  doc: UfsmDocument,
  key: K,
  value: ModelOptions[K] | undefined,
): void {
  if (value === undefined) {
    if (doc.options?.[key] === undefined) return;
    delete doc.options[key];
    if (Object.keys(doc.options).length === 0) delete doc.options;
    return;
  }
  if (doc.options?.[key] !== value) (doc.options ??= {})[key] = value;
}

/** Set one code generator setting (`targets[target][key]`), or remove it with undefined (empty targets go too). */
export function setTargetOption(
  doc: UfsmDocument,
  target: string,
  key: string,
  value: string | number | boolean | undefined,
): void {
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

/** Select the code generator (`target`), or remove the selection with undefined. */
export function setTarget(doc: UfsmDocument, target: string | undefined): void {
  if (target === undefined) delete doc.target;
  else if (doc.target !== target) doc.target = target;
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
  if (v?.kind === "state")
    setList(
      v,
      which,
      actions.map((a) => ({ ...a })),
    );
}

/** A transition or internal transition by id. */
function transitionOf(doc: UfsmDocument, id: Id): Transition | InternalTransition | undefined {
  const index = indexV1(doc);
  return index.transitions.get(id) ?? index.internals.get(id)?.transition;
}

/** Actions of a transition or internal transition, in order. */
export function setTransitionActions(doc: UfsmDocument, transitionId: Id, actions: Action[]): void {
  const t = transitionOf(doc, transitionId);
  if (t)
    setList(
      t,
      "do",
      actions.map((a) => ({ ...a })),
    );
}

/** Guard terms of a transition or internal transition (all must hold). */
export function setGuard(doc: UfsmDocument, transitionId: Id, terms: GuardTerm[]): void {
  const t = transitionOf(doc, transitionId);
  if (t)
    setList(
      t,
      "guard",
      terms.map((g) => ({ ...g })),
    );
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

/** Why `name` cannot name a timer (a message for the user), or undefined. `except` is the timer being renamed. */
export function timerNameProblem(index: DocIndex, name: string, except?: Id): string | undefined {
  if (name === "") return "A name is needed.";
  if (!IDENTIFIER.test(name))
    return `'${name}' is not an identifier: letters, digits and _, not starting with a digit.`;
  for (const { timer, state } of index.timers.values()) {
    if (timer.name === name && timer.id !== except)
      return `'${name}' is the name of a timer of '${state.name}' already.`;
  }
  return undefined;
}

/** Why `count` `unit` cannot be a timer's duration (a message for the user), or undefined. */
export function timerDurationProblem(count: number, unit: TimerUnit): string | undefined {
  if (!Number.isInteger(count) || count < 1) return "A whole number from 1 up is needed.";
  if (count * TIMER_UNIT_MS[unit] > TIMER_MAX_MS) {
    return `At most ${Math.floor(TIMER_MAX_MS / TIMER_UNIT_MS[unit])} ${unit} (2^32 - 1 ms, about 49.7 days).`;
  }
  return undefined;
}

/** A timer name no timer of the machine has: `timer1`, `timer2`, ... */
export function freshTimerName(index: DocIndex): string {
  const taken = new Set([...index.timers.values()].map((t) => t.timer.name));
  let n = 1;
  while (taken.has(`timer${n}`)) n++;
  return `timer${n}`;
}

/** Add a timer to a state: one-shot after 1 s, firing event `event`; returns its id (undefined for a non-state). */
export function addTimer(
  doc: UfsmDocument,
  stateId: Id,
  event: Id,
  opts: { ids?: IdAllocator; name?: string } = {},
): Id | undefined {
  const index = indexV1(doc);
  const v = index.vertices.get(stateId)?.vertex;
  if (v?.kind !== "state") return undefined;
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.timer);
  (v.timers ??= []).push({ id, name: opts.name ?? freshTimerName(index), after: 1, unit: "s", event });
  return id;
}

/** What `setTimer` changes; fields left out stay as they are. */
export interface TimerChange {
  name?: string;
  /** One-shot (`after`) or periodic (`every`); the count is kept. */
  kind?: "after" | "every";
  count?: number;
  unit?: TimerUnit;
  event?: Id;
}

/** Change a timer (check timerNameProblem and timerDurationProblem first). */
export function setTimer(doc: UfsmDocument, timerId: Id, change: TimerChange): void {
  const found = indexV1(doc).timers.get(timerId);
  if (!found) return;
  const t: Timer = found.timer;
  const kind = change.kind ?? (t.every !== undefined ? "every" : "after");
  const count = change.count ?? t.after ?? t.every ?? 1;
  if (change.name !== undefined && t.name !== change.name) t.name = change.name;
  if (change.unit !== undefined && t.unit !== change.unit) t.unit = change.unit;
  if (change.event !== undefined && t.event !== change.event) t.event = change.event;
  if (t[kind === "after" ? "every" : "after"] !== undefined) delete t[kind === "after" ? "every" : "after"];
  if (t[kind] !== count) t[kind] = count;
}
