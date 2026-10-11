// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Design rule check for v1 documents: things the JSON structure alone
 * cannot express. Errors make code generation impossible or wrong;
 * warnings point at likely mistakes.
 */
import { ancestors, indexV1, regionChain, vertexName, type DocIndex } from "../model/doc-index";
import { ACTION_CHAR_W, ACTION_ICON, ACTION_ICON_GAP, actionBlock } from "./action-block";
import { HEADER_H, isOffPage, vertexBox } from "./geometry";
import { sheetFit, sheetFitMessage } from "./sheet";
import { isApiOption, isBehaviourOption } from "../format/options";
import { IDENTIFIER, TIMER_MAX_MS, timerMs, type Action, type DeclKind, type GuardTerm, type Id, type Transition, type UfsmDocument, type Vertex } from "../format/model";

export type Severity = "error" | "warning";

export interface Diagnostic {
  severity: Severity;
  /** Stable identifier for tests and filtering, e.g. "dangling-ref". */
  code: string;
  message: string;
  /** Element the diagnostic is about, when there is one. */
  id?: Id;
}

const INITIALIZERS = new Set(["initial", "shallow-history", "deep-history"]);

export function checkV1(doc: UfsmDocument, prebuilt?: DocIndex): Diagnostic[] {
  const index = prebuilt ?? indexV1(doc);
  const out: Diagnostic[] = [];
  const err = (code: string, message: string, id?: Id): void => {
    out.push(id === undefined ? { severity: "error", code, message } : { severity: "error", code, message, id });
  };
  const warn = (code: string, message: string, id?: Id): void => {
    out.push(id === undefined ? { severity: "warning", code, message } : { severity: "warning", code, message, id });
  };

  // ---- ids are unique across the whole document
  const seen = new Map<Id, string>();
  const claim = (id: Id, what: string): void => {
    const prev = seen.get(id);
    if (prev) err("duplicate-id", `id '${id}' is used by both ${prev} and ${what}`, id);
    else seen.set(id, what);
  };
  const d = doc.declarations;
  for (const [kind, list] of [
    ["event", d.events],
    ["signal", d.signals],
    ["action", d.actions],
    ["guard", d.guards],
  ] as const) {
    for (const x of list) claim(x.id, `${kind} '${x.name}'`);
  }
  for (const { region } of index.regions.values()) claim(region.id, `region '${region.name ?? ""}'`);
  for (const { vertex } of index.vertices.values()) claim(vertex.id, `${vertex.kind} '${vertex.name ?? ""}'`);
  for (const t of doc.machine.transitions) claim(t.id, "a transition");
  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind === "state") for (const t of vertex.internal ?? []) claim(t.id, `an internal transition of '${vertex.name}'`);
  }
  for (const { timer, state } of index.timers.values()) claim(timer.id, `timer '${timer.name}' of '${state.name}'`);

  // ---- declaration names: identifiers, unique across all kinds (they share the generated namespace)
  const names = new Map<string, Id>();
  for (const { decl, kind } of index.decls.values()) {
    if (!IDENTIFIER.test(decl.name)) err("bad-name", `${kind} name '${decl.name}' is not a valid identifier`, decl.id);
    const other = names.get(decl.name);
    if (other) err("duplicate-name", `name '${decl.name}' is declared more than once`, decl.id);
    else names.set(decl.name, decl.id);
  }

  // ---- references
  const used = new Set<Id>();
  const expectDecl = (id: Id, kind: DeclKind, where: string, owner: Id): void => {
    used.add(id);
    const info = index.decls.get(id);
    if (!info) err("dangling-ref", `${where}: unknown ${kind} '${id}'`, owner);
    else if (info.kind !== kind) err("wrong-ref", `${where}: '${info.decl.name}' is a ${info.kind}, not a ${kind}`, owner);
  };
  let emits = false;
  const checkActions = (list: Action[] | undefined, where: string, owner: Id): void => {
    for (const a of list ?? []) {
      if ("call" in a) expectDecl(a.call, "action", where, owner);
      else {
        expectDecl(a.emit, "signal", where, owner);
        emits = true;
      }
    }
  };
  const checkGuards = (list: GuardTerm[] | undefined, where: string, owner: Id): void => {
    for (const g of list ?? []) {
      if ("in" in g) {
        const v = index.vertices.get(g.in)?.vertex;
        if (!v) err("dangling-ref", `${where}: unknown state '${g.in}'`, owner);
        else if (v.kind !== "state" && v.kind !== "final") err("wrong-ref", `${where}: '${g.in}' is a ${v.kind}, not a state`, owner);
      } else {
        expectDecl(g.call, "guard", where, owner);
      }
    }
  };

  for (const { vertex, region } of index.vertices.values()) {
    if (vertex.kind !== "state") continue;
    checkActions(vertex.entry, `state '${vertex.name}' entry`, vertex.id);
    checkActions(vertex.exit, `state '${vertex.name}' exit`, vertex.id);
    for (const t of vertex.internal ?? []) {
      const where = `internal transition of state '${vertex.name}'`;
      used.add(t.on);
      const info = index.decls.get(t.on);
      if (!info) err("dangling-ref", `${where}: unknown trigger '${t.on}'`, t.id);
      else if (info.kind !== "event" && info.kind !== "signal") {
        err("wrong-ref", `${where}: trigger '${info.decl.name}' is a ${info.kind}, not an event or signal`, t.id);
      }
      checkGuards(t.guard, where, t.id);
      checkActions(t.do, where, t.id);
      for (const g of t.guard ?? []) if ("call" in g) used.add(g.call);
      for (const a of t.do ?? []) used.add("call" in a ? a.call : a.emit);
    }
    const twins = region.states.filter((s) => s.kind === "state" && s.name === vertex.name);
    if (twins.length > 1 && twins[0] === vertex) {
      warn("duplicate-state-name", `${twins.length} states named '${vertex.name}' in the same region`, vertex.id);
    }
  }

  const describe = (t: Transition): string => `transition ${vertexName(index, t.from)} -> ${vertexName(index, t.to)}`;
  for (const t of doc.machine.transitions) {
    const where = describe(t);
    const from = index.vertices.get(t.from)?.vertex;
    const to = index.vertices.get(t.to)?.vertex;
    if (!from) err("dangling-ref", `${where}: unknown source '${t.from}'`, t.id);
    if (!to) err("dangling-ref", `${where}: unknown target '${t.to}'`, t.id);
    if (t.on !== undefined) {
      used.add(t.on);
      const info = index.decls.get(t.on);
      if (!info) err("dangling-ref", `${where}: unknown trigger '${t.on}'`, t.id);
      else if (info.kind !== "event" && info.kind !== "signal") {
        err("wrong-ref", `${where}: trigger '${info.decl.name}' is a ${info.kind}, not an event or signal`, t.id);
      }
    }
    checkGuards(t.guard, where, t.id);
    checkActions(t.do, where, t.id);
    for (const g of t.guard ?? []) if ("call" in g) used.add(g.call);
    for (const a of t.do ?? []) used.add("call" in a ? a.call : a.emit);

    if (!from) continue;
    const hasTrigger = t.on !== undefined || t.auto || t.completion;
    if (INITIALIZERS.has(from.kind) || from.kind === "fork") {
      if (hasTrigger || t.guard?.length) err("pseudo-trigger", `${where}: transitions out of a ${from.kind} cannot have a trigger or guard`, t.id);
    } else if (from.kind === "final" || from.kind === "terminate") {
      err("final-outgoing", `${where}: a ${from.kind} state cannot have outgoing transitions`, t.id);
    } else if ((from.kind === "state" && to?.kind !== "join") || from.kind === "join") {
      if (!hasTrigger) warn("no-trigger", `${where} has no trigger and will never fire`, t.id);
    }
    if (from.kind === "state" && to?.kind === "join" && hasTrigger) {
      err("join-trigger", `${where}: transitions into a join cannot have a trigger; put it on the join's outgoing transition`, t.id);
    }
    if (t.completion && from.kind === "state" && !(from.regions?.length)) {
      warn("completion-without-regions", `${where}: completion transition from a state without regions`, t.id);
    }
  }
  // ---- timers: names are identifiers unique in the machine (they name the generated timer enum), they fire a
  // declared event, and their duration fits an unsigned 32-bit count of ms
  const timerNames = new Map<string, Id>();
  for (const { timer, state } of index.timers.values()) {
    const where = `timer '${timer.name}' of state '${state.name}'`;
    if (!IDENTIFIER.test(timer.name)) err("timer-name", `${where}: the name is not a valid identifier`, timer.id);
    else if (timerNames.has(timer.name)) err("timer-name", `${where}: another timer of the machine has the same name`, timer.id);
    else timerNames.set(timer.name, timer.id);
    expectDecl(timer.event, "event", where, timer.id);
    const ms = timerMs(timer);
    if (!Number.isInteger(ms) || ms < 1 || ms > TIMER_MAX_MS) {
      err("timer-duration", `${where}: the duration must be a whole number of ms from 1 to ${TIMER_MAX_MS} (about 49.7 days)`, timer.id);
    }
  }

  // ---- forks and joins connect states in different orthogonal regions of one state
  const orthogonal = (a: Id, b: Id): boolean => {
    const ca = regionChain(index, a);
    const cb = regionChain(index, b);
    let i = 0;
    while (i < ca.length && i < cb.length && ca[i] === cb[i]) i++;
    if (i === ca.length || i === cb.length) return false; // same region, or one inside the other's region
    const oa = index.regions.get(ca[i]!.id)?.owner;
    return oa !== undefined && oa === index.regions.get(cb[i]!.id)?.owner;
  };
  // ---- two timers that can run at the same time fire the same event: the machine cannot tell them apart. They can when
  // their states are one and the same, one contains the other, or they lie in orthogonal regions of one state.
  const timerList = [...index.timers.values()];
  const together = (a: Id, b: Id): boolean =>
    a === b || ancestors(index, a).some((s) => s.id === b) || ancestors(index, b).some((s) => s.id === a) || orthogonal(a, b);
  const reported = new Set<Id>();
  for (let i = 0; i < timerList.length; i++) {
    for (let j = i + 1; j < timerList.length; j++) {
      const a = timerList[i]!;
      const b = timerList[j]!;
      if (a.timer.event !== b.timer.event || reported.has(b.timer.id) || !together(a.state.id, b.state.id)) continue;
      reported.add(b.timer.id);
      const ev = index.decls.get(b.timer.event)?.decl.name ?? b.timer.event;
      warn(
        "timer-same-event",
        `timer '${b.timer.name}' of '${b.state.name}' fires '${ev}' like timer '${a.timer.name}' of '${a.state.name}', and both can run at the same time`,
        b.timer.id,
      );
    }
  }

  // ---- forks pass a transition on to every outgoing transition, so they need at least one and cannot form a cycle;
  // joins merge transitions out of states (semantics/structure.ts resolves both the same way)
  const forkCycle = new Set<Id>();
  const visitFork = (id: Id, path: Id[]): void => {
    if (path.includes(id)) {
      for (const f of path.slice(path.indexOf(id))) forkCycle.add(f);
      return;
    }
    for (const t of index.outgoing.get(id) ?? []) {
      if (index.vertices.get(t.to)?.vertex.kind === "fork") visitFork(t.to, [...path, id]);
    }
  };
  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind !== "fork") continue;
    if (!(index.outgoing.get(vertex.id)?.length)) err("fork-no-outgoing", `fork '${vertex.name ?? vertex.id}' has no outgoing transitions`, vertex.id);
    visitFork(vertex.id, []);
  }
  for (const id of forkCycle) err("fork-cycle", `fork '${vertexName(index, id)}' is part of a cycle of forks`, id);
  for (const t of doc.machine.transitions) {
    const from = index.vertices.get(t.from)?.vertex;
    if (from && from.kind !== "state" && index.vertices.get(t.to)?.vertex.kind === "join") {
      err("join-incoming", `${describe(t)}: transitions into a join must come from states`, t.id);
    }
  }
  /** The vertices a transition enters, following forks (cycles are reported above). */
  const entered = (t: Transition, seen = new Set<Id>()): Vertex[] => {
    const to = index.vertices.get(t.to)?.vertex;
    if (!to) return [];
    if (to.kind !== "fork") return [to];
    if (seen.has(to.id)) return [];
    seen.add(to.id);
    return (index.outgoing.get(to.id) ?? []).flatMap((o) => entered(o, seen));
  };

  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind !== "fork" && vertex.kind !== "join") continue;
    const ends = vertex.kind === "fork"
      ? (index.outgoing.get(vertex.id) ?? []).map((t) => t.to)
      : doc.machine.transitions.filter((t) => t.to === vertex.id).map((t) => t.from);
    const known = ends.filter((id) => index.vertices.has(id));
    let bad = false;
    for (let i = 0; i < known.length && !bad; i++) {
      for (let j = i + 1; j < known.length && !bad; j++) if (!orthogonal(known[i]!, known[j]!)) bad = true;
    }
    if (bad) {
      const what = vertex.kind === "fork" ? "targets" : "sources";
      err(`${vertex.kind}-${what}`, `the ${what} of ${vertex.kind} '${vertex.name ?? vertex.id}' must lie in different orthogonal regions of one state`, vertex.id);
    }
  }

  // ---- shadowed transitions: an earlier transition of the same state, same trigger, no guard.
  // A state's transitions are tried in order: outgoing ones (file order), then its internal ones (list order).
  for (const { vertex } of index.vertices.values()) {
    if (vertex.kind !== "state") continue;
    const unguarded = new Set<string>();
    const candidates = [
      ...(index.outgoing.get(vertex.id) ?? [])
        .filter((t) => index.vertices.get(t.to)?.vertex.kind !== "join")
        .map((t) => ({ t, key: t.on !== undefined ? `on:${t.on}` : t.auto ? "auto" : t.completion ? "completion" : undefined, what: describe(t) })),
      ...(vertex.internal ?? []).map((t) => ({ t, key: `on:${t.on}`, what: `internal transition ${index.decls.get(t.on)?.decl.name ?? t.on} of '${vertex.name}'` })),
    ];
    for (const { t, key, what } of candidates) {
      if (key === undefined) continue;
      if (unguarded.has(key)) {
        warn("shadowed", `${what} can never fire: an earlier transition of the same state has the same trigger and no guard`, t.id);
      }
      if (!t.guard?.length) unguarded.add(key);
    }
  }

  for (const { vertex } of index.vertices.values()) {
    for (const a of vertex.kind === "state" ? [...(vertex.entry ?? []), ...(vertex.exit ?? [])] : []) {
      used.add("call" in a ? a.call : a.emit);
    }
  }

  // ---- initializers
  // A region is entered "by default" when something transitions to its owner
  // state itself (not to a state inside it), or when it is the root region.
  const defaultEntered = new Set<Id>([doc.machine.root.id]);
  for (const t of doc.machine.transitions) {
    const target = index.vertices.get(t.to)?.vertex;
    if (target?.kind === "state") target.regions?.forEach((r) => defaultEntered.add(r.id));
  }
  for (const { region } of index.regions.values()) {
    const inits = region.states.filter((s) => INITIALIZERS.has(s.kind));
    if (inits.length > 1) err("multiple-initial", `region '${region.name ?? region.id}' has ${inits.length} initial/history states`, region.id);
    for (const i of inits) {
      const outs = index.outgoing.get(i.id) ?? [];
      if (outs.length !== 1) {
        err("initial-transitions", `${i.kind} in region '${region.name ?? region.id}' must have exactly one outgoing transition (has ${outs.length})`, i.id);
        continue;
      }
      // the default entry stays inside the region and enters something
      const t = outs[0]!;
      for (const v of entered(t)) {
        if (v.kind === "terminate") err("initial-target", `${describe(t)}: the ${i.kind} transition of a region cannot lead to a terminate`, t.id);
        else if (v.id === i.id || !regionChain(index, v.id).includes(region)) {
          err("initial-target", `${describe(t)}: the ${i.kind} transition of region '${region.name ?? region.id}' must lead into that region`, t.id);
        } else continue;
        break;
      }
    }
    if (inits.length === 0 && defaultEntered.has(region.id) && region.states.some((s) => s.kind === "state")) {
      const owner = index.regions.get(region.id)?.owner;
      const what = owner ? `region '${region.name ?? region.id}' of '${owner.name}'` : "the root region";
      warn("no-initial", `${what} is entered by default but has no initial state`, region.id);
    }
  }

  // ---- unused declarations
  for (const { decl, kind } of index.decls.values()) {
    if (kind === "event") continue; // events may be accepted and ignored on purpose
    if (!used.has(decl.id)) warn("unused", `${kind} '${decl.name}' is never used`, decl.id);
  }

  // ---- options: behaviour options are the same for every target
  if (emits && doc.options?.signalQueue === 0) err("signal-queue", "the model emits signals, so options.signalQueue must be at least 1");
  for (const [target, set] of Object.entries(doc.targets ?? {})) {
    for (const k of Object.keys(set)) {
      if (isBehaviourOption(k)) {
        warn("target-option", `targets.${target}.${k} is ignored: it changes behaviour, so it is set in options for every target`);
      } else if (isApiOption(k) && typeof set[k] !== "boolean") {
        warn("target-option", `targets.${target}.${k} is ignored: expected true or false`);
      }
    }
  }

  // ---- diagram consistency
  const dia = doc.diagram;
  if (dia) {
    for (const id of Object.keys(dia.states)) if (!index.vertices.has(id)) warn("stale-layout", `diagram has layout for unknown state '${id}'`, id);
    for (const id of Object.keys(dia.regions)) if (!index.regions.has(id)) warn("stale-layout", `diagram has layout for unknown region '${id}'`, id);
    for (const id of Object.keys(dia.transitions)) if (!index.transitions.has(id)) warn("stale-layout", `diagram has layout for unknown transition '${id}'`, id);
    for (const id of index.vertices.keys()) if (!dia.states[id]) warn("missing-layout", `state '${vertexName(index, id)}' has no diagram position`, id);
    // ---- fit on the sheet (needs every position and both ends of every transition)
    const geometry =
      !out.some((d) => d.code === "missing-layout" || d.code === "duplicate-id") &&
      doc.machine.transitions.every((t) => index.vertices.has(t.from) && index.vertices.has(t.to));
    if (geometry) {
      for (const p of sheetFit(index)) warn(p.problem === "outside" ? "outside-frame" : "title-block", sheetFitMessage(index, p), p.id);
      // ---- action blocks fit their states. Lines hidden by a height the user set are not reported: the block marks them.
      for (const { vertex } of index.vertices.values()) {
        if (vertex.kind !== "state") continue;
        const block = actionBlock(index, vertex);
        if (block.auto === 0) continue;
        const b = vertexBox(index, vertex.id);
        const shown = block.summary ? [block.summaryRow] : block.rows.slice(0, block.visible).map((r) => r.segments);
        const right = Math.max(...shown.flat().map((g) => g.x + (g.icon ? ACTION_ICON + ACTION_ICON_GAP : 0) + g.text.length * ACTION_CHAR_W));
        if (HEADER_H + block.height > b.h || right > b.w) {
          warn("actions-clipped", `state '${vertexName(index, vertex.id)}' is too small to show its actions, timers and internal transitions`, vertex.id);
        }
        const first = vertex.regions?.[0];
        if (!first || isOffPage(index, first.id)) continue;
        const covered = first.states.find((c) => vertexBox(index, c.id).y < b.y + HEADER_H + block.height);
        if (covered) {
          warn("actions-overlap", `the actions of state '${vertexName(index, vertex.id)}' are drawn over '${vertexName(index, covered.id)}'`, vertex.id);
        }
      }
    }
  }

  return out;
}
