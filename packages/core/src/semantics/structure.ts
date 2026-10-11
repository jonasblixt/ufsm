// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Static structure of a machine, as the semantics see it (docs/semantics.md).
 *
 * - Every region and vertex gets a position in document order (pre-order:
 *   a state before its regions, a region before its vertices, regions
 *   top-down). Entry runs in document order, exit in reverse.
 * - Model transitions are resolved into compound transitions: a transition
 *   into a fork carries the fork's outgoing transitions; a join's outgoing
 *   transition carries the transitions into the join. Transitions out of
 *   initial/history pseudo-states become region initializers.
 *
 * Used by the reference interpreter; the flattener (static rules) builds on
 * the same structure.
 */
import { indexV1, type DocIndex } from "../model/doc-index";
import {
  timerMs,
  type Action,
  type GuardTerm,
  type Id,
  type PseudoKind,
  type Region,
  type State,
  type Transition,
  type UfsmDocument,
  type Vertex,
} from "../format/model";

export interface SemRegion {
  id: Id;
  region: Region;
  /** State owning the region; undefined for the root region. */
  owner: SemVertex | undefined;
  /** Position in document order (shared counter with vertices). */
  order: number;
  vertices: SemVertex[];
  /** The initial or history pseudo-state, if any. */
  initializer: SemVertex | undefined;
  /** Shallow or deep history pseudo-state, if any (also the initializer). */
  history: SemVertex | undefined;
  /** Ids of this region and all regions containing it. */
  ancestry: ReadonlySet<Id>;
  /** Document-order position of the last vertex or region inside this region (its subtree ends there). */
  end: number;
}

export interface SemVertex {
  id: Id;
  kind: "state" | PseudoKind;
  vertex: Vertex;
  /** Display name: state name, or pseudo-state name/kind. */
  name: string;
  region: SemRegion;
  regions: SemRegion[];
  order: number;
  /** Position among states in post-order (a state's regions first, then the state); -1 for pseudo-states. */
  post: number;
  /** 0 for vertices in the root region. */
  depth: number;
  /** Ids of all regions containing this vertex, innermost included. */
  within: ReadonlySet<Id>;
  /** The state's timers, in list order (empty for pseudo-states). */
  timers: SemTimer[];
}

/** A timer of a state: started after the state's entry actions, stopped before its exit actions. */
export interface SemTimer {
  id: Id;
  name: string;
  /** Position in `Structure.timers`: states in document order, then list order. The generated timer enum's value. */
  index: number;
  state: SemVertex;
  /** Duration in ms. */
  ms: number;
  periodic: boolean;
  /** The event the application sends when the timer expires. */
  event: Id;
}

export type Trigger =
  | { kind: "event"; id: Id; name: string; signal: boolean }
  | { kind: "auto" }
  | { kind: "completion" }
  | { kind: "none" };

/** A transition as it executes, with forks and joins resolved. */
export interface CompoundTransition {
  /** Id of the model transition carrying the trigger (for a join: the join's outgoing transition). */
  id: Id;
  /** Model transitions making up this one, in the order their `do` lists run. */
  parts: Transition[];
  /** Source states: one, or several for a join. */
  sources: SemVertex[];
  trigger: Trigger;
  /** All terms must hold (for a join: guards of all parts). */
  guard: GuardTerm[];
  /** Concatenated `do` lists of the parts. */
  actions: Action[];
  /** Entry targets: states, final states, history, initial or terminate pseudo-states. */
  targets: SemVertex[];
  /** Innermost region containing all sources, targets and the forks/joins in between. Exit set = active vertices inside it. */
  domain: SemRegion;
  /** The source at which selection considers this transition: the source itself, or a join's last source in post-order. */
  offeredBy: SemVertex;
  /**
   * An internal transition of its source state: selected and conflict-checked like a transition from the state to
   * itself (domain = the state's region), but it exits and enters nothing (empty exit set, no targets).
   */
  internal: boolean;
}

/** How a region is entered by default: the initializer's transition, resolved. */
export interface Initializer {
  pseudo: SemVertex;
  /** The initializer's outgoing transition, plus a fork's outgoing ones if it targets a fork. */
  parts: Transition[];
  actions: Action[];
  targets: SemVertex[];
}

export interface Structure {
  doc: UfsmDocument;
  index: DocIndex;
  root: SemRegion;
  regions: Map<Id, SemRegion>;
  vertices: Map<Id, SemVertex>;
  /** All vertices and regions in document order. */
  ordered: (SemVertex | SemRegion)[];
  /** States in post-order: the order in which selection visits them. */
  postOrder: SemVertex[];
  /** Compound transitions that can be selected (sources are states), in document order; internal transitions last. */
  transitions: CompoundTransition[];
  /** Candidates by source state id, in document order; a join's transition is listed under each source. */
  bySource: Map<Id, CompoundTransition[]>;
  /** Default entry of each region that has an initializer, by region id. */
  initializers: Map<Id, Initializer>;
  /** Event and signal ids by name. */
  triggers: Map<string, Id>;
  /** Every timer: states in document order, then each state's list order. reset() and terminate stop them in this order. */
  timers: SemTimer[];
}

/**
 * A construct the semantics cannot give a meaning to. Every one of them is a design rule error (check/semantic.ts), so after
 * checkV1 reports no errors this is never thrown: the throws below are assertions, not the place to add a rule.
 */
export class SemanticsError extends Error {
  readonly id: Id | undefined;
  constructor(message: string, id?: Id) {
    super(message);
    this.name = "SemanticsError";
    this.id = id;
  }
}

const INITIALIZER_KINDS = new Set<string>(["initial", "shallow-history", "deep-history"]);
const ENTRY_TARGET_KINDS = new Set<string>([
  "state",
  "final",
  "initial",
  "shallow-history",
  "deep-history",
  "terminate",
]);

/**
 * Build the structure of a document. The document must pass checkV1
 * without errors; otherwise this may throw a SemanticsError.
 */
export function buildStructure(doc: UfsmDocument): Structure {
  const index = indexV1(doc);
  const regions = new Map<Id, SemRegion>();
  const vertices = new Map<Id, SemVertex>();
  const ordered: (SemVertex | SemRegion)[] = [];
  const postOrder: SemVertex[] = [];
  const timers: SemTimer[] = [];
  let order = 0;

  const visitRegion = (
    region: Region,
    owner: SemVertex | undefined,
    within: ReadonlySet<Id>,
    depth: number,
  ): SemRegion => {
    const inner = new Set(within).add(region.id);
    const r: SemRegion = {
      id: region.id,
      region,
      owner,
      order: order++,
      vertices: [],
      initializer: undefined,
      history: undefined,
      ancestry: inner,
      end: 0,
    };
    regions.set(r.id, r);
    ordered.push(r);
    for (const v of region.states) {
      const sv: SemVertex = {
        id: v.id,
        kind: v.kind,
        vertex: v,
        name: v.name ?? v.kind,
        region: r,
        regions: [],
        order: order++,
        post: -1,
        depth,
        within: inner,
        timers: [],
      };
      for (const t of v.kind === "state" ? (v.timers ?? []) : []) {
        const timer: SemTimer = {
          id: t.id,
          name: t.name,
          index: timers.length,
          state: sv,
          ms: timerMs(t),
          periodic: t.every !== undefined,
          event: t.event,
        };
        sv.timers.push(timer);
        timers.push(timer);
      }
      vertices.set(sv.id, sv);
      ordered.push(sv);
      r.vertices.push(sv);
      if (INITIALIZER_KINDS.has(v.kind) && !r.initializer) r.initializer = sv;
      if ((v.kind === "shallow-history" || v.kind === "deep-history") && !r.history) r.history = sv;
      if (v.kind === "state") {
        for (const child of (v as State).regions ?? []) sv.regions.push(visitRegion(child, sv, inner, depth + 1));
        sv.post = postOrder.length;
        postOrder.push(sv);
      }
    }
    r.end = order - 1;
    return r;
  };
  const root = visitRegion(doc.machine.root, undefined, new Set(), 0);

  const vertex = (id: Id): SemVertex => {
    const v = vertices.get(id);
    if (!v) throw new SemanticsError(`unknown vertex '${id}'`, id);
    return v;
  };
  const outgoing = (id: Id): Transition[] => index.outgoing.get(id) ?? [];
  const incoming = new Map<Id, Transition[]>();
  for (const t of doc.machine.transitions) {
    const list = incoming.get(t.to);
    if (list) list.push(t);
    else incoming.set(t.to, [t]);
  }

  /** Follow forks from `t`'s target; returns the parts and entry targets. */
  const resolveTargets = (
    t: Transition,
    seen: Set<Id> = new Set(),
  ): { parts: Transition[]; targets: SemVertex[]; via: SemVertex[] } => {
    const to = vertex(t.to);
    if (to.kind === "fork") {
      if (seen.has(to.id)) throw new SemanticsError(`fork '${to.name}' is part of a cycle`, to.id);
      seen.add(to.id);
      const parts: Transition[] = [t];
      const targets: SemVertex[] = [];
      const via: SemVertex[] = [to];
      const outs = outgoing(to.id);
      if (outs.length === 0) throw new SemanticsError(`fork '${to.name}' has no outgoing transitions`, to.id);
      for (const o of outs) {
        const r = resolveTargets(o, seen);
        parts.push(...r.parts);
        targets.push(...r.targets);
        via.push(...r.via);
      }
      return { parts, targets, via };
    }
    if (!ENTRY_TARGET_KINDS.has(to.kind))
      throw new SemanticsError(`a transition cannot end in a ${to.kind} here`, t.id);
    return { parts: [t], targets: [to], via: [] };
  };

  const domainOf = (vs: SemVertex[]): SemRegion => {
    // Innermost region whose subtree holds every vertex: walk the first vertex's chain outwards.
    let r: SemRegion | undefined = vs[0]!.region;
    while (r && !vs.every((v) => v.within.has(r!.id))) r = r.owner?.region;
    return r ?? root;
  };

  const triggerOf = (t: Transition): Trigger => {
    if (t.on !== undefined) {
      const info = index.decls.get(t.on);
      if (!info || (info.kind !== "event" && info.kind !== "signal"))
        throw new SemanticsError(`unknown trigger '${t.on}'`, t.id);
      return { kind: "event", id: t.on, name: info.decl.name, signal: info.kind === "signal" };
    }
    if (t.auto) return { kind: "auto" };
    if (t.completion) return { kind: "completion" };
    return { kind: "none" };
  };

  const transitions: CompoundTransition[] = [];
  const bySource = new Map<Id, CompoundTransition[]>();
  const joinCompounds = new Map<Id, CompoundTransition[]>();
  const listFor = (id: Id): CompoundTransition[] => {
    let l = bySource.get(id);
    if (!l) bySource.set(id, (l = []));
    return l;
  };

  for (const t of doc.machine.transitions) {
    const from = vertex(t.from);
    const to = vertex(t.to);
    if (from.kind === "state" && to.kind === "join") {
      // Part of the join's compound transitions, which are listed under each source.
      let compounds = joinCompounds.get(to.id);
      if (!compounds) {
        const ins = incoming.get(to.id) ?? [];
        compounds = [];
        for (const out of outgoing(to.id)) {
          const sources = ins.map((i) => vertex(i.from));
          for (const s of sources)
            if (s.kind !== "state")
              throw new SemanticsError(`transitions into join '${to.name}' must come from states`, to.id);
          const r = resolveTargets(out);
          const parts = [...ins, ...r.parts];
          const c: CompoundTransition = {
            id: out.id,
            parts,
            sources,
            trigger: triggerOf(out),
            guard: parts.flatMap((p) => p.guard ?? []),
            actions: parts.flatMap((p) => p.do ?? []),
            targets: r.targets,
            domain: domainOf([...sources, to, ...r.via, ...r.targets]),
            offeredBy: sources.reduce((a, b) => (b.post > a.post ? b : a)),
            internal: false,
          };
          compounds.push(c);
          transitions.push(c);
        }
        joinCompounds.set(to.id, compounds);
      }
      const list = listFor(from.id);
      for (const c of compounds) if (!list.includes(c)) list.push(c);
      continue;
    }
    if (from.kind !== "state") continue; // initializers, forks and joins are handled through their neighbours
    const r = resolveTargets(t);
    const c: CompoundTransition = {
      id: t.id,
      parts: r.parts,
      sources: [from],
      trigger: triggerOf(t),
      guard: r.parts.flatMap((p) => p.guard ?? []),
      actions: r.parts.flatMap((p) => p.do ?? []),
      targets: r.targets,
      domain: domainOf([from, ...r.via, ...r.targets]),
      offeredBy: from,
      internal: false,
    };
    transitions.push(c);
    listFor(from.id).push(c);
  }

  // Internal transitions come after a state's outgoing transitions in its candidate list.
  for (const sv of postOrder) {
    for (const it of (sv.vertex as State).internal ?? []) {
      const part: Transition = { id: it.id, from: sv.id, to: sv.id, on: it.on };
      if (it.guard) part.guard = it.guard;
      if (it.do) part.do = it.do;
      const trigger = triggerOf(part);
      if (trigger.kind !== "event")
        throw new SemanticsError("an internal transition needs an event or signal trigger", it.id);
      const c: CompoundTransition = {
        id: it.id,
        parts: [part],
        sources: [sv],
        trigger,
        guard: it.guard ?? [],
        actions: it.do ?? [],
        targets: [],
        domain: sv.region,
        offeredBy: sv,
        internal: true,
      };
      transitions.push(c);
      listFor(sv.id).push(c);
    }
  }

  const initializers = new Map<Id, Initializer>();
  for (const r of regions.values()) {
    const pseudo = r.initializer;
    if (!pseudo) continue;
    const outs = outgoing(pseudo.id);
    if (outs.length !== 1)
      throw new SemanticsError(`${pseudo.kind} must have exactly one outgoing transition`, pseudo.id);
    const res = resolveTargets(outs[0]!);
    for (const tgt of res.targets) {
      if (!tgt.within.has(r.id) || tgt.id === pseudo.id) {
        throw new SemanticsError(`the ${pseudo.kind} transition of a region must lead into that region`, outs[0]!.id);
      }
    }
    initializers.set(r.id, {
      pseudo,
      parts: res.parts,
      actions: res.parts.flatMap((p) => p.do ?? []),
      targets: res.targets,
    });
  }

  const triggers = new Map<string, Id>();
  for (const e of [...doc.declarations.events, ...doc.declarations.signals]) triggers.set(e.name, e.id);

  return {
    doc,
    index,
    root,
    regions,
    vertices,
    ordered,
    postOrder,
    transitions,
    bySource,
    initializers,
    triggers,
    timers,
  };
}

/** Proper ancestor states of a vertex, innermost first. */
export function ancestorStates(v: SemVertex): SemVertex[] {
  const out: SemVertex[] = [];
  for (let s = v.region.owner; s; s = s.region.owner) out.push(s);
  return out;
}

/** Two transitions conflict when their exit sets can overlap: one domain contains the other. */
export function conflicts(a: CompoundTransition, b: CompoundTransition): boolean {
  return a.domain.ancestry.has(b.domain.id) || b.domain.ancestry.has(a.domain.id);
}

/** True if `v` is a proper descendant of state `s`. */
export function isDescendant(v: SemVertex, s: SemVertex): boolean {
  return s.regions.some((r) => v.within.has(r.id));
}
