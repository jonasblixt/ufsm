// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Flattening: the machine as static tables, the way generated code runs it
 * (rework plan S7). Everything a step needs is precomputed except what
 * depends on the configuration (which state is active in each region) and
 * on history.
 *
 *   configuration  cfg[region] = slot of the active vertex (1-based), 0 = inactive
 *   selection      per trigger, a list of offers in post-order; each offer
 *                  names a state and its candidate transitions in order
 *   conflicts      taking a transition blocks the regions in its `blocks`
 *                  list; a transition whose domain is blocked is skipped
 *   exit           every active vertex inside the domain, reverse document order
 *   entry          an entry program per transition; regions entered by
 *                  default run their initializer, or restore history
 *
 * The flat model must behave exactly like the reference interpreter
 * (docs/semantics.md); packages/core/test/flat.test.ts checks that with the
 * conformance traces and random models.
 */
import type { Action, Id, UfsmDocument } from "../format/model";
import {
  SemanticsError,
  buildStructure,
  type CompoundTransition,
  type SemRegion,
  type SemVertex,
  type Structure,
  type Trigger,
} from "./structure";

export interface FlatVertex {
  id: Id;
  name: string;
  kind: "state" | "final";
  region: number;
  /** cfg[region] value while this vertex is active (1-based). */
  slot: number;
  entry: Action[];
  exit: Action[];
  /** The state's timers (indices into `FlatModel.timers`), in list order: started after `entry`, stopped before `exit`. */
  timers: number[];
  /** Child regions, top-down. */
  regions: number[];
}

/** A timer; its index in `FlatModel.timers` is its number (states in document order, then list order). */
export interface FlatTimer {
  id: Id;
  name: string;
  ms: number;
  periodic: boolean;
  /** The event the application sends when the timer expires. */
  event: Id;
}

/** Entering a vertex: set its slot, run its entry actions, then enter its regions in order. */
export interface EntryOp {
  vertex: number;
  regions: RegionOp[];
}

/** How a region is entered: towards an explicit target, or by default (initializer or history). */
export type RegionOp = { region: number; path: EntryOp } | { region: number; default: true };

export interface FlatRegion {
  id: Id;
  name?: string;
  /** Owning state; -1 for the root region. */
  owner: number;
  /** Vertex numbers by slot - 1. */
  slots: number[];
  /** Slots of the region's final states. */
  finalSlots: number[];
  history: "none" | "shallow" | "deep";
  /** Default entry: initializer actions, then the path to its target(s). Undefined: the region stays empty. */
  init: { actions: Action[]; path: EntryOp } | undefined;
  /** Vertices inside this region (any depth) are numbered vertexFrom..vertexTo-1. */
  vertexFrom: number;
  vertexTo: number;
  /** Regions nested inside this one are numbered regionFrom..regionTo-1. */
  regionFrom: number;
  regionTo: number;
  /** This region and the regions containing it, innermost first. */
  ancestry: number[];
}

export type FlatGuard = { call: Id; not?: true } | { in: number; not?: true };

export interface FlatTransition {
  /** Id of the model transition carrying the trigger. */
  id: Id;
  /** All model transitions it is made of (fork/join parts). */
  parts: Id[];
  trigger: Trigger;
  /** States that must all be active. */
  sources: number[];
  /** Regions that must rest in a final state (completion transitions). */
  complete: number[];
  guard: FlatGuard[];
  actions: Action[];
  /** Region whose active contents are exited, and inside which `entry` runs. */
  domain: number;
  /** Regions blocked for the rest of the microstep once this transition is taken: the domain, its ancestors and the regions inside it. */
  blocks: number[];
  /** Entry inside the domain; undefined when the transition only terminates (or is internal). */
  entry: RegionOp | undefined;
  terminate: boolean;
  /** Internal transition: selected like a self-transition (same domain and blocks), but exits and enters nothing. */
  internal: boolean;
}

export interface Candidate {
  transition: number;
  /** False for a join at a source other than its last one: the state offers nothing while the join is its first enabled transition. */
  offer: boolean;
  /** For a join: the other sources, where the join must also be the first enabled candidate. */
  firstAt?: number[];
}

export interface Offer {
  state: number;
  /** In priority order; the first enabled one is the state's offer. */
  candidates: Candidate[];
}

export interface FlatModel {
  name: string;
  events: { id: Id; name: string }[];
  signals: { id: Id; name: string }[];
  actions: { id: Id; name: string }[];
  guards: { id: Id; name: string }[];
  regions: FlatRegion[];
  vertices: FlatVertex[];
  transitions: FlatTransition[];
  /** Offers per event/signal id, in post-order. Triggers nothing reacts to are absent. */
  offers: Record<Id, Offer[]>;
  /** Offers for auto and completion transitions, evaluated in the settle phase. */
  eventless: Offer[];
  /** Every timer; reset() and terminate stop them all, in this order. */
  timers: FlatTimer[];
}

/** The document must pass checkV1 without errors; the SemanticsErrors thrown here are assertions. */
export function flatten(doc: UfsmDocument, prebuilt?: Structure): FlatModel {
  const s = prebuilt ?? buildStructure(doc);
  const regionList = s.ordered.filter((x): x is SemRegion => !("kind" in x));
  const vertexList = s.ordered.filter((x): x is SemVertex => "kind" in x && (x.kind === "state" || x.kind === "final"));
  const rIndex = new Map(regionList.map((r, i) => [r.id, i]));
  const vIndex = new Map(vertexList.map((v, i) => [v.id, i]));
  const ri = (r: SemRegion): number => rIndex.get(r.id)!;
  const vi = (v: SemVertex): number => {
    const i = vIndex.get(v.id);
    if (i === undefined) throw new SemanticsError(`not a state: ${v.id}`);
    return i;
  };

  const vertices: FlatVertex[] = vertexList.map((v) => {
    const slot = v.region.vertices.filter((x) => x.kind === "state" || x.kind === "final").indexOf(v) + 1;
    const st = v.vertex.kind === "state" ? v.vertex : undefined;
    return {
      id: v.id,
      name: v.name,
      kind: v.kind === "final" ? "final" : "state",
      region: ri(v.region),
      slot,
      entry: st?.entry ?? [],
      exit: st?.exit ?? [],
      timers: v.timers.map((t) => t.index),
      regions: v.regions.map(ri),
    };
  });

  /** Entry program for the vertex of region `r` leading to `targets` (all inside r, already validated orthogonal). */
  const pathIn = (r: SemRegion, targets: SemVertex[]): EntryOp => {
    const v = r.vertices.find((x) => targets.some((t) => t === x || x.regions.some((c) => t.within.has(c.id))));
    if (!v || (v.kind !== "state" && v.kind !== "final"))
      throw new SemanticsError(`no state on the path in region ${r.id}`);
    return enterOp(
      v,
      targets.filter((t) => t !== v),
    );
  };
  const enterOp = (v: SemVertex, inner: SemVertex[]): EntryOp => ({
    vertex: vi(v),
    regions: v.regions.map((c) =>
      regionOp(
        c,
        inner.filter((t) => t.within.has(c.id)),
      ),
    ),
  });
  const regionOp = (r: SemRegion, targets: SemVertex[]): RegionOp => {
    if (targets.length === 0) return { region: ri(r), default: true };
    // A history or initial pseudo-state as target means entering its region by default.
    const pseudo = targets.find((t) => t.region === r && t.kind !== "state" && t.kind !== "final");
    if (pseudo) {
      if (targets.length > 1) throw new SemanticsError(`conflicting targets in region ${r.id}`);
      return { region: ri(r), default: true };
    }
    return { region: ri(r), path: pathIn(r, targets) };
  };

  const regions: FlatRegion[] = regionList.map((r) => {
    const inside = vertexList.filter((v) => v.within.has(r.id)).map(vi);
    const innerRegions = regionList.filter((x) => x !== r && x.ancestry.has(r.id)).map(ri);
    const slots = r.vertices.filter((x) => x.kind === "state" || x.kind === "final").map(vi);
    const init = s.initializers.get(r.id);
    const ancestry: number[] = [];
    for (let x: SemRegion | undefined = r; x; x = x.owner?.region) ancestry.push(ri(x));
    const fr: FlatRegion = {
      id: r.id,
      owner: r.owner ? vi(r.owner) : -1,
      slots,
      finalSlots: slots.filter((v) => vertices[v]!.kind === "final").map((v) => vertices[v]!.slot),
      history: r.history ? (r.history.kind === "deep-history" ? "deep" : "shallow") : "none",
      init: undefined,
      vertexFrom: inside.length ? Math.min(...inside) : 0,
      vertexTo: inside.length ? Math.max(...inside) + 1 : 0,
      regionFrom: innerRegions.length ? Math.min(...innerRegions) : ri(r) + 1,
      regionTo: innerRegions.length ? Math.max(...innerRegions) + 1 : ri(r) + 1,
      ancestry,
    };
    if (r.region.name !== undefined) fr.name = r.region.name;
    if (init) {
      const real = init.targets.filter((t) => t.kind !== "terminate");
      if (real.length !== init.targets.length)
        throw new SemanticsError(`initializer of region ${r.id} leads to terminate`);
      fr.init = { actions: init.actions, path: pathIn(r, real) };
    }
    return fr;
  });

  const tIndex = new Map<CompoundTransition, number>();
  const transitions: FlatTransition[] = s.transitions.map((t, i) => {
    tIndex.set(t, i);
    const d = t.domain;
    const real = t.targets.filter((x) => x.kind !== "terminate");
    const domainRegion = ri(d);
    const blocks = new Set<number>(regions[domainRegion]!.ancestry);
    for (let k = regions[domainRegion]!.regionFrom; k < regions[domainRegion]!.regionTo; k++) blocks.add(k);
    return {
      id: t.id,
      parts: t.parts.map((p) => p.id),
      trigger: t.trigger,
      sources: t.sources.map(vi),
      complete: t.trigger.kind === "completion" ? t.sources.flatMap((src) => src.regions.map(ri)) : [],
      guard: t.guard.map((g): FlatGuard =>
        "in" in g ? (g.not ? { in: vi(s.vertices.get(g.in)!), not: true } : { in: vi(s.vertices.get(g.in)!) }) : g,
      ),
      actions: t.actions,
      domain: domainRegion,
      blocks: [...blocks].sort((a, b) => a - b),
      entry: real.length ? regionOp(d, real) : undefined,
      terminate: real.length !== t.targets.length,
      internal: t.internal,
    };
  });

  const offerList = (matches: (t: CompoundTransition) => boolean): Offer[] => {
    const out: Offer[] = [];
    for (const st of s.postOrder) {
      const candidates: Candidate[] = [];
      for (const t of s.bySource.get(st.id) ?? []) {
        if (!matches(t)) continue;
        const c: Candidate = { transition: tIndex.get(t)!, offer: t.offeredBy === st };
        if (c.offer && t.sources.length > 1) c.firstAt = t.sources.filter((x) => x !== st).map(vi);
        candidates.push(c);
      }
      if (candidates.length) out.push({ state: vi(st), candidates });
    }
    return out;
  };

  const offers: Record<Id, Offer[]> = {};
  for (const e of [...doc.declarations.events, ...doc.declarations.signals]) {
    const list = offerList((t) => t.trigger.kind === "event" && t.trigger.id === e.id);
    if (list.length) offers[e.id] = list;
  }
  const decl = (xs: { id: Id; name: string }[]): { id: Id; name: string }[] =>
    xs.map((x) => ({ id: x.id, name: x.name }));
  return {
    name: doc.name,
    events: decl(doc.declarations.events),
    signals: decl(doc.declarations.signals),
    actions: decl(doc.declarations.actions),
    guards: decl(doc.declarations.guards),
    regions,
    vertices,
    transitions,
    offers,
    eventless: offerList((t) => t.trigger.kind === "auto" || t.trigger.kind === "completion"),
    timers: s.timers.map((t) => ({ id: t.id, name: t.name, ms: t.ms, periodic: t.periodic, event: t.event })),
  };
}
