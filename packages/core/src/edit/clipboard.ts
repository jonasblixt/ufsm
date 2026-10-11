// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Copy and paste. A fragment is a self-contained piece of a document: the copied vertices with everything inside
 * them, the transitions between them, the declarations they use and their layout, with the top-level positions made
 * relative to the fragment's top-left corner. Pasting gives every element a fresh id, so a fragment can be pasted
 * any number of times, into the same machine or another one.
 */
import { commonRegion, indexV1, type DocIndex } from "../model/doc-index";
import { diagramOf, snap, topLevelVertices } from "./layout";
import { edgeOrigin, regionOrigin, vertexBox, type Point } from "../diagram/geometry";
import { regionArea } from "./create";
import { DECL_PREFIX, ID_PREFIX, IdAllocator } from "../format/ids";
import type {
  Action,
  Decl,
  DeclKind,
  EdgeLayout,
  GuardTerm,
  Id,
  InternalTransition,
  Region,
  RegionLayout,
  StateLayout,
  Timer,
  Transition,
  UfsmDocument,
  Vertex,
} from "../format/model";

export interface Fragment {
  /** Declarations the copied elements use, with their kind (pasting matches them by kind and name). */
  declarations: { kind: DeclKind; decl: Decl }[];
  /** Top-level vertices with their subtrees, in document order. */
  vertices: Vertex[];
  /** Transitions whose both ends were copied, in document order. */
  transitions: Transition[];
  /**
   * Layout keyed by the original ids. Top-level vertices are relative to the fragment's top-left; so are the bend
   * points, free labels and jogs of the transitions listed in `outer`, whose common region is the one the fragment is
   * pasted into. Everything else stays relative to its own (copied) region.
   */
  diagram: { states: Record<Id, StateLayout>; regions: Record<Id, RegionLayout>; transitions: Record<Id, EdgeLayout> };
  outer: Id[];
  /** Size of the bounding box of the top-level vertices. */
  w: number;
  h: number;
}

const clone = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;

function actionsDecls(list: Action[] | undefined, out: Set<Id>): void {
  for (const a of list ?? []) out.add("call" in a ? a.call : a.emit);
}

function guardDecls(list: GuardTerm[] | undefined, out: Set<Id>): void {
  for (const g of list ?? []) if ("call" in g) out.add(g.call);
}

/**
 * Copy the given vertices (vertices inside another given one come with it; transition ids are ignored: a transition
 * is copied when both its ends are). Returns undefined when no vertex is given.
 */
export function copyFragment(index: DocIndex, ids: Iterable<Id>): Fragment | undefined {
  const top = topLevelVertices(index, ids);
  if (top.length === 0) return undefined;
  const doc = index.doc;
  const copied = new Set<Id>();
  const insideRegions = new Set<Id>();
  const visit = (v: Vertex): void => {
    copied.add(v.id);
    if (v.kind !== "state") return;
    for (const r of v.regions ?? []) {
      insideRegions.add(r.id);
      r.states.forEach(visit);
    }
  };
  // document order: walk the machine, keep the top-level ones
  const topSet = new Set(top);
  const vertices: Vertex[] = [];
  const walk = (r: Region): void => {
    for (const v of r.states) {
      if (topSet.has(v.id)) {
        vertices.push(v);
        visit(v);
      } else if (v.kind === "state") v.regions?.forEach(walk);
    }
  };
  walk(doc.machine.root);
  const transitions = doc.machine.transitions.filter((t) => copied.has(t.from) && copied.has(t.to));

  const boxes = vertices.map((v) => vertexBox(index, v.id));
  const x0 = Math.min(...boxes.map((b) => b.x)), y0 = Math.min(...boxes.map((b) => b.y));
  const x1 = Math.max(...boxes.map((b) => b.x + b.w)), y1 = Math.max(...boxes.map((b) => b.y + b.h));

  const dia = doc.diagram;
  const diagram: Fragment["diagram"] = { states: {}, regions: {}, transitions: {} };
  for (const id of copied) {
    const l = dia?.states[id];
    if (l) diagram.states[id] = clone(l);
  }
  vertices.forEach((v, i) => {
    const b = boxes[i]!;
    diagram.states[v.id] = { ...(diagram.states[v.id] ?? { w: b.w, h: b.h }), x: b.x - x0, y: b.y - y0 };
  });
  for (const id of insideRegions) {
    const l = dia?.regions[id];
    if (l) diagram.regions[id] = clone(l);
  }
  const outer: Id[] = [];
  for (const t of transitions) {
    const l = dia?.transitions[t.id];
    if (!l) continue;
    const e = clone(l);
    if (!insideRegions.has(commonRegion(index, t.from, t.to).id)) {
      // relative to the fragment's corner instead of the source region
      outer.push(t.id);
      const o = edgeOrigin(index, t.id);
      const dx = o.x - x0, dy = o.y - y0;
      if (e.route === "s") {
        if (e.jog) e.jog = "x" in e.jog ? { x: e.jog.x + dx } : { y: e.jog.y + dy };
      } else {
        if (e.via) e.via = e.via.map(([x, y]) => [x + dx, y + dy]);
        if (e.label) e.label = { ...e.label, x: e.label.x + dx, y: e.label.y + dy };
      }
    }
    diagram.transitions[t.id] = e;
  }

  const used = new Set<Id>();
  for (const id of copied) {
    const v = index.vertices.get(id)!.vertex;
    if (v.kind !== "state") continue;
    actionsDecls(v.entry, used);
    actionsDecls(v.exit, used);
    for (const t of v.timers ?? []) used.add(t.event);
    for (const t of v.internal ?? []) {
      used.add(t.on);
      guardDecls(t.guard, used);
      actionsDecls(t.do, used);
    }
  }
  for (const t of transitions) {
    if (t.on) used.add(t.on);
    guardDecls(t.guard, used);
    actionsDecls(t.do, used);
  }
  const declarations: Fragment["declarations"] = [];
  for (const id of used) {
    const d = index.decls.get(id);
    if (d) declarations.push({ kind: d.kind, decl: clone(d.decl) });
  }
  return { declarations, vertices: clone(vertices), transitions: clone(transitions), diagram, outer, w: x1 - x0, h: y1 - y0 };
}

const DECL_LIST = { event: "events", signal: "signals", action: "actions", guard: "guards" } as const;

export interface PasteOptions {
  /**
   * Keep `in`/`not in` guard terms on states that were not copied, when such a state exists in the target (pasting
   * into the machine the fragment came from). Otherwise those terms are dropped.
   */
  keepOuterStateRefs?: boolean;
}

/**
 * Paste a fragment into a region with its top-left corner at absolute point `at` (snapped; moved inside the region's
 * band where the fragment fits). Declarations are matched by kind and name, and added when missing (renamed
 * `name_2`, ... when the name is taken by another kind). Returns the new ids: top-level vertices first, then
 * transitions, in fragment order.
 */
export function pasteFragment(doc: UfsmDocument, frag: Fragment, regionId: Id, at: Point, opts: PasteOptions = {}): Id[] {
  const index = indexV1(doc);
  const region = index.regions.get(regionId)?.region;
  if (!region) throw new Error(`unknown region ${regionId}`);
  const ids = new IdAllocator(doc);

  // declarations
  const declMap = new Map<Id, Id>();
  const names = new Map<string, { kind: DeclKind; id: Id }>();
  for (const { kind, decl } of index.decls.values()) names.set(decl.name, { kind, id: decl.id });
  for (const { kind, decl } of frag.declarations) {
    const same = names.get(decl.name);
    if (same?.kind === kind) {
      declMap.set(decl.id, same.id);
      continue;
    }
    let name = decl.name;
    for (let n = 2; names.has(name); n++) name = `${decl.name}_${n}`;
    const id = ids.take(DECL_PREFIX[kind]);
    const d: Decl = { id, name };
    if (decl.doc !== undefined) d.doc = decl.doc;
    doc.declarations[DECL_LIST[kind]].push(d);
    names.set(name, { kind, id });
    declMap.set(decl.id, id);
  }
  const decl = (id: Id): Id => declMap.get(id) ?? id;

  // fresh ids for everything in the fragment
  const map = new Map<Id, Id>();
  const assign = (v: Vertex): void => {
    map.set(v.id, ids.take(ID_PREFIX.vertex));
    if (v.kind !== "state") return;
    for (const r of v.regions ?? []) {
      map.set(r.id, ids.take(ID_PREFIX.region));
      r.states.forEach(assign);
    }
  };
  frag.vertices.forEach(assign);
  const internalIds = (v: Vertex): void => {
    if (v.kind !== "state") return;
    for (const t of v.internal ?? []) map.set(t.id, ids.take(ID_PREFIX.transition));
    for (const t of v.timers ?? []) map.set(t.id, ids.take(ID_PREFIX.timer));
    v.regions?.forEach((r) => r.states.forEach(internalIds));
  };
  frag.vertices.forEach(internalIds);
  for (const t of frag.transitions) map.set(t.id, ids.take(ID_PREFIX.transition));

  const actions = (list: Action[] | undefined): Action[] | undefined =>
    list?.map((a) => ("call" in a ? { call: decl(a.call) } : { emit: decl(a.emit) }));
  const guard = (list: GuardTerm[] | undefined): GuardTerm[] | undefined => {
    if (!list) return undefined;
    const out: GuardTerm[] = [];
    for (const g of list) {
      if ("call" in g) out.push({ ...g, call: decl(g.call) });
      else if (map.has(g.in)) out.push({ ...g, in: map.get(g.in)! });
      else if (opts.keepOuterStateRefs && index.vertices.has(g.in)) out.push({ ...g });
    }
    return out.length ? out : undefined;
  };
  // timer names are unique in the machine: a pasted timer whose name is taken becomes name_2, name_3, ...
  const timerNames = new Set([...index.timers.values()].map((t) => t.timer.name));
  const timerName = (name: string): string => {
    let n = name;
    for (let k = 2; timerNames.has(n); k++) n = `${name}_${k}`;
    timerNames.add(n);
    return n;
  };
  const set = <T extends object, K extends keyof T>(o: T, k: K, v: T[K] | undefined): void => {
    if (v === undefined) delete o[k];
    else o[k] = v;
  };
  const rewrite = (v: Vertex): Vertex => {
    const c = clone(v);
    c.id = map.get(v.id)!;
    if (c.kind === "state" && v.kind === "state") {
      set(c, "entry", actions(v.entry));
      set(c, "exit", actions(v.exit));
      if (v.timers) c.timers = v.timers.map((t): Timer => ({ ...clone(t), id: map.get(t.id)!, name: timerName(t.name), event: decl(t.event) }));
      if (v.internal) {
        c.internal = v.internal.map((t): InternalTransition => {
          const n: InternalTransition = { ...clone(t), id: map.get(t.id)!, on: decl(t.on) };
          set(n, "guard", guard(t.guard));
          set(n, "do", actions(t.do));
          return n;
        });
      }
      if (v.regions) c.regions = v.regions.map((r) => ({ ...clone(r), id: map.get(r.id)!, states: r.states.map(rewrite) }));
    }
    return c;
  };
  const vertices = frag.vertices.map(rewrite);
  const transitions = frag.transitions.map((t): Transition => {
    const n: Transition = { ...clone(t), id: map.get(t.id)!, from: map.get(t.from)!, to: map.get(t.to)! };
    if (t.on !== undefined) n.on = decl(t.on);
    set(n, "guard", guard(t.guard));
    set(n, "do", actions(t.do));
    return n;
  });

  // place: the corner on the grid, inside the band where the fragment fits
  const area = regionArea(index, region);
  const x = Math.min(Math.max(snap(at.x), area.x0), Math.max(area.x1 - frag.w, area.x0));
  const y = Math.min(Math.max(snap(at.y), area.y0), Math.max(area.y1 - frag.h, area.y0));
  const o = regionOrigin(index, region);
  const dx = x - o.x, dy = y - o.y;

  const dia = diagramOf(doc);
  const topIds = new Set(frag.vertices.map((v) => v.id));
  for (const [id, l] of Object.entries(frag.diagram.states)) {
    const n = map.get(id);
    if (!n) continue;
    dia.states[n] = topIds.has(id) ? { ...clone(l), x: l.x + dx, y: l.y + dy } : clone(l);
  }
  for (const [id, l] of Object.entries(frag.diagram.regions)) {
    const n = map.get(id);
    if (n) dia.regions[n] = clone(l);
  }
  const outer = new Set(frag.outer);
  for (const [id, l] of Object.entries(frag.diagram.transitions)) {
    const n = map.get(id);
    if (!n) continue;
    const e = clone(l);
    if (outer.has(id)) {
      if (e.route === "s") {
        if (e.jog) e.jog = "x" in e.jog ? { x: e.jog.x + dx } : { y: e.jog.y + dy };
      } else {
        if (e.via) e.via = e.via.map(([vx, vy]) => [vx + dx, vy + dy]);
        if (e.label) e.label = { ...e.label, x: e.label.x + dx, y: e.label.y + dy };
      }
    }
    dia.transitions[n] = e;
  }
  region.states.push(...vertices);
  doc.machine.transitions.push(...transitions);
  return [...vertices.map((v) => v.id), ...transitions.map((t) => t.id)];
}
