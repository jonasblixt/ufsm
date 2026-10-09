// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Random but valid models for differential testing (interpreter vs flat
 * rules vs generated code). Deterministic for a given seed.
 */
import type { Action, GuardTerm, InternalTransition, Region, State, Transition, UfsmDocument, Vertex } from "../src/index";

export interface RandomModelOptions {
  maxDepth?: number;
  maxStates?: number;
  transitions?: number;
  events?: number;
  signals?: number;
  guards?: number;
  /** Allow joins (selection rules for joins are uFSM-specific, see docs/semantics.md). */
  joins?: boolean;
}

/** mulberry32 */
export function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t ^= t + Math.imul(t ^ (t >>> 7), 61 | t);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function randomModel(seed: number, opts: RandomModelOptions = {}): UfsmDocument {
  const r = rng(seed);
  const int = (n: number): number => Math.floor(r() * n);
  const pick = <T>(xs: readonly T[]): T => xs[int(xs.length)]!;
  const chance = (p: number): boolean => r() < p;
  const maxDepth = opts.maxDepth ?? 3;
  const maxStates = opts.maxStates ?? 14;

  let nState = 0;
  let nRegion = 0;
  let nTrans = 0;
  const events = Array.from({ length: opts.events ?? 3 }, (_, i) => ({ id: `ev${i + 1}`, name: `e${i + 1}` }));
  const signals = Array.from({ length: opts.signals ?? 1 }, (_, i) => ({ id: `sig${i + 1}`, name: `s${i + 1}` }));
  const guards = Array.from({ length: opts.guards ?? 2 }, (_, i) => ({ id: `grd${i + 1}`, name: `g${i + 1}` }));
  const actions: { id: string; name: string }[] = [];
  const action = (name: string): string => {
    actions.push({ id: `act${actions.length + 1}`, name });
    return actions[actions.length - 1]!.id;
  };
  const transitions: Transition[] = [];
  const add = (t: Omit<Transition, "id">): Transition => {
    const full = { id: `t${++nTrans}`, ...t } as Transition;
    transitions.push(full);
    return full;
  };

  // entry/exit lists: usually one call, sometimes none or two, now and then a signal
  const entryExit = (name: string): Pick<State, "entry" | "exit"> => {
    const list = (p: string): Action[] => {
      const n = chance(0.15) ? 0 : chance(0.2) ? 2 : 1;
      const out: Action[] = [];
      for (let i = 0; i < n; i++) out.push({ call: action(i ? `${p}${name}_${i + 1}` : `${p}${name}`) });
      if (signals.length && chance(0.08)) out.splice(int(out.length + 1), 0, { emit: pick(signals).id });
      return out;
    };
    const entry = list("e");
    const exit = list("x");
    return { ...(entry.length ? { entry } : {}), ...(exit.length ? { exit } : {}) };
  };

  const states: State[] = [];
  const finals: Vertex[] = [];
  const initOf = new Map<string, Transition>();
  const regionOf = new Map<string, Region>();
  const ownerOf = new Map<string, State | undefined>();
  const regions: Region[] = [];

  const makeRegion = (depth: number, owner: State | undefined): Region => {
    const region: Region = { id: `r${nRegion++}`, states: [] };
    regions.push(region);
    ownerOf.set(region.id, owner);
    const n = 1 + int(depth === 0 ? 4 : 3);
    for (let i = 0; i < n && states.length < maxStates; i++) {
      const id = `s${++nState}`;
      const name = `S${nState}`;
      const s: State = { id, kind: "state", name, ...entryExit(name) };
      states.push(s);
      region.states.push(s);
      regionOf.set(id, region);
      if (depth < maxDepth && chance(0.35)) {
        const k = chance(0.4) ? 2 + int(2) : 1;
        s.regions = [];
        for (let j = 0; j < k; j++) s.regions.push(makeRegion(depth + 1, s));
      }
    }
    if (region.states.length === 0) {
      // keep regions non-empty
      const id = `s${++nState}`;
      const s: State = { id, kind: "state", name: `S${nState}`, ...entryExit(`S${nState}`) };
      states.push(s);
      region.states.push(s);
      regionOf.set(id, region);
    }
    // a final state now and then, sometimes two (completion then tests "any of the finals")
    for (let k = chance(0.35) ? (chance(0.25) ? 2 : 1) : 0; k > 0; k--) {
      const f: Vertex = { id: `s${++nState}`, kind: "final" };
      region.states.push(f);
      regionOf.set(f.id, region);
      finals.push(f);
    }
    // initializer: initial (mostly) or history, targeting a state of this region, sometimes nested deeper
    const kind = chance(0.8) ? "initial" : chance(0.5) ? "shallow-history" : "deep-history";
    const init: Vertex = { id: `s${++nState}`, kind };
    region.states.unshift(init);
    regionOf.set(init.id, region);
    let target = pick(region.states.filter((v) => v.kind === "state")) as State;
    if (target.regions && chance(0.3)) {
      const inner = pick(target.regions).states.filter((v) => v.kind === "state");
      if (inner.length) target = pick(inner) as State;
    }
    const t: Omit<Transition, "id"> = { from: init.id, to: target.id };
    if (chance(0.3)) t.do = [{ call: action(`i${init.id}`) }];
    initOf.set(region.id, add(t));
    return region;
  };

  const root = makeRegion(0, undefined);
  const stateIds = states.map((s) => s.id);
  const regionChain = (id: string): Region[] => {
    const out: Region[] = [];
    let reg = regionOf.get(id);
    while (reg) {
      out.push(reg);
      const o = ownerOf.get(reg.id);
      reg = o ? regionOf.get(o.id) : undefined;
    }
    return out;
  };
  const isAncestor = (a: string, b: string): boolean => {
    const s = states.find((x) => x.id === a);
    return !!s?.regions?.some((reg) => regionChain(b).includes(reg));
  };

  const trigger = (): Pick<Transition, "on" | "auto" | "completion"> => {
    const x = r();
    if (x < 0.7) return { on: pick(events).id };
    if (x < 0.82 && signals.length) return { on: pick(signals).id };
    if (x < 0.92) return { auto: true };
    return { completion: true };
  };
  const guard = (auto: boolean): GuardTerm[] | undefined => {
    if (!auto && !chance(0.35)) return undefined;
    const terms: GuardTerm[] = [];
    const n = 1 + int(2);
    for (let i = 0; i < n; i++) {
      const x = r();
      if (x < 0.45 && guards.length) terms.push({ call: pick(guards).id });
      else if (x < 0.75 && guards.length) terms.push({ call: pick(guards).id, not: true });
      else terms.push(chance(0.5) ? { in: pick(stateIds) } : { in: pick(stateIds), not: true });
    }
    return terms;
  };
  const doList = (): Action[] | undefined => {
    if (!chance(0.4)) return undefined;
    const out: Action[] = [];
    if (chance(0.7)) out.push({ call: action(`a${nTrans + 1}`) });
    if (signals.length && chance(0.35)) out.push({ emit: pick(signals).id });
    return out.length ? out : undefined;
  };

  const nT = opts.transitions ?? 12;
  for (let i = 0; i < nT; i++) {
    const from = pick(states);
    const x = r();
    let to: string;
    if (x < 0.1 && finals.length) to = pick(finals).id;
    else if (x < 0.14) {
      // into a history pseudo-state of some region
      const hs = regions.flatMap((reg) => reg.states.filter((v) => v.kind === "shallow-history" || v.kind === "deep-history"));
      to = hs.length ? pick(hs).id : pick(stateIds);
    } else to = pick(stateIds);
    let trig = trigger();
    if (trig.completion && !from.regions) trig = { on: pick(events).id }; // simple states complete at once: endless loops
    const t: Omit<Transition, "id"> = { from: from.id, to, ...trig };
    const g = guard(trig.auto === true);
    if (g) t.guard = g;
    const d = doList();
    if (d) t.do = d;
    add(t);
  }

  // internal transitions (no exit/entry), now and then; they draw from their own generator so that adding them
  // leaves the rest of each random model as it was
  const ri = rng(seed * 7919 + 13);
  const pickI = <T>(xs: readonly T[]): T => xs[Math.floor(ri() * xs.length)]!;
  for (const st of states) {
    if (ri() >= 0.25) continue;
    for (let k = ri() < 0.3 ? 2 : 1; k > 0; k--) {
      const it: InternalTransition = { id: `t${++nTrans}`, on: signals.length && ri() < 0.25 ? pickI(signals).id : pickI(events).id };
      if (ri() < 0.35 && guards.length) it.guard = [ri() < 0.5 ? { call: pickI(guards).id } : { call: pickI(guards).id, not: true }];
      const d: Action[] = [{ call: action(`n${it.id}`) }];
      if (signals.length && ri() < 0.2) d.push({ emit: pickI(signals).id });
      it.do = d;
      (st.internal ??= []).push(it);
    }
  }

  // forks and joins across orthogonal regions
  const parallel = states.filter((s) => (s.regions?.length ?? 0) >= 2);
  // a state of the region, sometimes one nested a level deeper
  const endIn = (reg: Region): Vertex => {
    const s = pick(reg.states.filter((v) => v.kind === "state")) as State;
    if (s.regions && chance(0.25)) {
      const inner = pick(s.regions).states.filter((v) => v.kind === "state");
      if (inner.length) return pick(inner);
    }
    return s;
  };
  for (const p of parallel) {
    const [ra, rb] = [p.regions![0]!, p.regions![1]!];
    const sa = ra.states.filter((v) => v.kind === "state");
    const sb = rb.states.filter((v) => v.kind === "state");
    // all regions of a three-region state now and then, else the first two
    const use = p.regions!.length >= 3 && chance(0.5) ? p.regions! : [ra, rb];
    const host = regionOf.get(p.id)!;
    const newFork = (): Vertex => {
      const fork: Vertex = { id: `s${++nState}`, kind: "fork" };
      host.states.push(fork);
      regionOf.set(fork.id, host);
      for (const reg of use) add(chance(0.2) ? { from: fork.id, to: endIn(reg).id, do: [{ call: action(`f${nTrans + 1}`) }] } : { from: fork.id, to: endIn(reg).id });
      return fork;
    };
    if (chance(0.6)) {
      const outside = states.filter((s) => s.id !== p.id && !isAncestor(p.id, s.id));
      if (outside.length) {
        const from = pick(outside).id;
        const on = pick(events).id;
        add({ from, to: newFork().id, on });
      }
    }
    // the host region's initial transition into a fork
    const init = initOf.get(host.id);
    if (init && host.states.find((v) => v.id === init.from)?.kind === "initial" && chance(0.15)) init.to = newFork().id;
    // one or two joins; a second one shares the first one's source in the first region
    const nJoins = opts.joins === false ? 0 : chance(0.6) ? (chance(0.35) ? 2 : 1) : 0;
    let shared: Vertex | undefined;
    for (let j = 0; j < nJoins; j++) {
      const join: Vertex = { id: `s${++nState}`, kind: "join" };
      const host = regionOf.get(p.id)!;
      host.states.push(join);
      regionOf.set(join.id, host);
      shared ??= pick(sa);
      add({ from: shared.id, to: join.id });
      add({ from: pick(sb).id, to: join.id });
      for (const reg of use.slice(2)) add({ from: endIn(reg).id, to: join.id });
      const targets = states.filter((s) => s.id !== p.id && !isAncestor(p.id, s.id));
      const t: Omit<Transition, "id"> = { from: join.id, to: pick(targets.length ? targets : [p]).id, ...(chance(0.7) ? { on: pick(events).id } : { auto: true as const }) };
      if (chance(0.3)) t.guard = guard(false) ?? [];
      if (t.guard?.length === 0) delete t.guard;
      add(t);
    }
  }
  if (chance(0.25)) {
    // terminate in a random region; the transition comes from a state in that region
    const host = pick(regions);
    const inHost = host.states.filter((v) => v.kind === "state");
    const term: Vertex = { id: `s${++nState}`, kind: "terminate" };
    host.states.push(term);
    regionOf.set(term.id, host);
    add({ from: pick(inHost.length ? inHost : states).id, to: term.id, on: pick(events).id, ...(chance(0.5) ? { do: [{ call: action(`q${nState}`) }] } : {}) });
  }

  return {
    format: "ufsm",
    version: 1,
    name: `random_${seed}`,
    declarations: { events, signals, actions, guards },
    machine: { root, transitions },
  };
}
