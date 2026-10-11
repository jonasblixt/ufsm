// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import {
  V0ActionRefKind,
  V0GuardKind,
  V0TriggerKind,
  type V0ActionRef,
  type V0GuardRef,
  type V0Model,
  type V0Named,
  type V0Region,
  type V0State,
  type V0Transition,
} from "./format";

export interface V0StateInfo {
  state: V0State;
  parent: V0Region;
}

export interface V0RegionInfo {
  region: V0Region;
  /** Undefined for the root region. */
  parent: V0State | undefined;
}

/** Lookup tables over a v0 model. Build once, after loading. */
export interface V0Index {
  model: V0Model;
  states: Map<string, V0StateInfo>;
  regions: Map<string, V0RegionInfo>;
  transitions: V0Transition[];
  triggers: Map<string, V0Named>;
  signals: Map<string, V0Named>;
  actions: Map<string, V0Named>;
  guards: Map<string, V0Named>;
}

/**
 * A state's regions in on-screen order, top to bottom.
 *
 * The GTK editor loads regions through a stack (old/compose/src/model/model.c),
 * so the visual order is the REVERSE of the order in the file. The old Python
 * generator compensates the same way (`regions.insert(0, region)`).
 */
export function regionsTopDown(state: V0State): V0Region[] {
  return [...state.region].reverse();
}

function byId(list: V0Named[]): Map<string, V0Named> {
  return new Map(list.map((x) => [x.id, x]));
}

export function indexV0(model: V0Model): V0Index {
  const index: V0Index = {
    model,
    states: new Map(),
    regions: new Map(),
    transitions: [],
    triggers: byId(model.triggers),
    signals: byId(model.signals),
    actions: byId(model.actions),
    guards: byId(model.guards),
  };

  const visit = (region: V0Region, parent: V0State | undefined): void => {
    index.regions.set(region.id, { region, parent });
    for (const s of region.states) {
      index.states.set(s.id, { state: s, parent: region });
      index.transitions.push(...s.transitions);
      for (const r of s.region) visit(r, s);
    }
  };
  visit(model.region, undefined);
  return index;
}

/**
 * Check that every id reference in the model resolves. Returns a list of
 * human readable problems; an empty list means the model is consistent.
 */
export function checkV0References(index: V0Index): string[] {
  const problems: string[] = [];

  const checkAction = (ref: V0ActionRef, where: string): void => {
    if (ref.kind === V0ActionRefKind.Signal) {
      if (!ref["signal-id"] || !index.signals.has(ref["signal-id"])) {
        problems.push(`${where}: unknown signal '${ref["signal-id"]}'`);
      }
    } else if (!ref["action-id"] || !index.actions.has(ref["action-id"])) {
      problems.push(`${where}: unknown action '${ref["action-id"]}'`);
    }
  };

  const checkGuard = (ref: V0GuardRef, where: string): void => {
    if (ref.kind === V0GuardKind.PState || ref.kind === V0GuardKind.NState) {
      if (!ref["state-id"] || !index.states.has(ref["state-id"])) {
        problems.push(`${where}: unknown state '${ref["state-id"]}' in state guard`);
      }
    } else if (!ref["action-id"] || !index.guards.has(ref["action-id"])) {
      problems.push(`${where}: unknown guard function '${ref["action-id"]}'`);
    }
  };

  for (const { state } of index.states.values()) {
    const where = `state '${state.name}'`;
    state.entries.forEach((a) => checkAction(a, `${where} entry`));
    state.exits.forEach((a) => checkAction(a, `${where} exit`));
  }

  for (const t of index.transitions) {
    const src = index.states.get(t.source.state);
    const dst = index.states.get(t.dest.state);
    const where = `transition ${src?.state.name ?? "?"} -> ${dst?.state.name ?? "?"}`;
    if (!src) problems.push(`${where}: unknown source state '${t.source.state}'`);
    if (!dst) problems.push(`${where}: unknown destination state '${t.dest.state}'`);
    const kind = t["trigger-kind"];
    if (t.trigger !== undefined) {
      const table = kind === V0TriggerKind.Signal ? index.signals : index.triggers;
      if (!table.has(t.trigger)) problems.push(`${where}: unknown trigger '${t.trigger}'`);
    }
    t.actions.forEach((a) => checkAction(a, `${where} action`));
    t.guards.forEach((g) => checkGuard(g, `${where} guard`));
  }

  return problems;
}

export interface V0Summary {
  name: string;
  states: number;
  regions: number;
  transitions: number;
  triggers: number;
  signals: number;
  actions: number;
  guards: number;
  stateKinds: Record<string, number>;
}

export function summarizeV0(index: V0Index): V0Summary {
  const stateKinds: Record<string, number> = {};
  for (const { state } of index.states.values()) {
    stateKinds[state.kind] = (stateKinds[state.kind] ?? 0) + 1;
  }
  return {
    name: index.model.name,
    states: index.states.size,
    regions: index.regions.size,
    transitions: index.transitions.length,
    triggers: index.triggers.size,
    signals: index.signals.size,
    actions: index.actions.size,
    guards: index.guards.size,
    stateKinds,
  };
}
