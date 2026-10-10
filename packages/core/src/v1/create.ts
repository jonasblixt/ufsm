// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Structure edits: what the editor's add tools and Delete do. Unlike edit.ts these change the `machine` section
 * (and keep `diagram` in step with it). Every function mutates the document it is given (the editor passes an Immer
 * draft, tests a plain object). Positions are absolute sheet coordinates; they are snapped to the grid and stored
 * relative to the owning region (format-v1.md).
 *
 * Validity is checked where the user acts (`cannotAdd`, `cannotConnect`), not after the fact: the design rule check
 * still reports everything else (a transition without a trigger, a region without an initial state, ...).
 */
import { ancestors, commonRegion, indexV1, type DocIndex } from "./doc-index";
import { endAt, followTransitions, nearestEnd,regionLayoutOf, diagramOf, snap, MIN_BAR, MIN_STATE } from "./edit";
import { HEADER_H, actionBlockHeight, isOffPage, isSheet, regionBoxes, regionOrigin, stateLayout, vertexBox, edgeGeometry, edgeOrigin, type Box, type Point } from "./geometry";
import { IdAllocator, ID_PREFIX } from "./ids";
import { GRID, type EdgeEnd, type EdgeLayout, type GuardTerm, type Id, type Region, type State, type StateLayout, type Transition, type UfsmDocument, type Vertex } from "./model";
import { defaultLabel, labelAnchor } from "./route";

export type VertexKind = Vertex["kind"];

/** Size of a new state placed with a click (dragging sizes it). */
export const NEW_STATE_W = 160;
export const NEW_STATE_H = 80;
/** Round pseudo states (initial, final, histories, terminate) are always this size. */
export const PSEUDO_SIZE = 20;
/** Fork/join bars: thickness, and length of one placed with a click. */
export const BAR_THICKNESS = 10;
export const NEW_BAR_LENGTH = 100;
/** Height a new region gets: its state grows by this much (a first region is given at least this much). */
export const NEW_BAND = 100;

const INITIALIZERS: ReadonlySet<VertexKind> = new Set(["initial", "shallow-history", "deep-history"]);
const ROUND: ReadonlySet<VertexKind> = new Set(["initial", "final", "shallow-history", "deep-history", "terminate"]);

export const isRoundKind = (k: VertexKind): boolean => ROUND.has(k);
export const isBarKind = (k: VertexKind): boolean => k === "fork" || k === "join";

const KIND_TEXT: Record<VertexKind, string> = {
  state: "state",
  initial: "initial state",
  final: "final state",
  "shallow-history": "shallow history",
  "deep-history": "deep history",
  fork: "fork",
  join: "join",
  terminate: "terminate",
};

const inside = (b: Box, p: Point): boolean => p.x >= b.x && p.x <= b.x + b.w && p.y >= b.y && p.y <= b.y + b.h;
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);

/**
 * A new, empty machine: no declarations, a root region without states, an A4 sheet. It is valid (parses, passes
 * the schema, round-trips, passes the design rule check) and generates code for every target.
 */
export function newDocument(name: string): UfsmDocument {
  return {
    format: "ufsm",
    version: 1,
    name,
    declarations: { events: [], signals: [], actions: [], guards: [] },
    machine: { root: { id: "r0", name: "Root", states: [] }, transitions: [] },
    diagram: { paper: "A4", states: {}, regions: {}, transitions: {} },
  };
}

/**
 * The innermost region drawn on sheet `page` whose band contains point `p` (the page itself when no state's band
 * does). Where a new vertex or a pasted fragment lands.
 */
export function regionAt(index: DocIndex, page: Region, p: Point): Region {
  let region = page;
  for (;;) {
    let next: Region | undefined;
    // the last drawn vertex is on top
    for (let i = region.states.length - 1; i >= 0 && !next; i--) {
      const v = region.states[i]!;
      if (v.kind !== "state" || !v.regions?.length || !inside(vertexBox(index, v.id), p)) continue;
      next = regionBoxes(index, v).find((rb) => !isOffPage(index, rb.region.id) && inside(rb.box, p))?.region;
      if (!next) return region;
    }
    if (!next) return region;
    region = next;
  }
}

/** Absolute area a region's vertices may occupy: its band in the owner, or the non-negative quadrant of its sheet. */
export function regionArea(index: DocIndex, region: Region): { x0: number; y0: number; x1: number; y1: number } {
  if (!isSheet(index, region)) {
    const owner = index.regions.get(region.id)?.owner;
    const b = owner && regionBoxes(index, owner).find((r) => r.region.id === region.id)?.box;
    if (b) return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
  }
  return { x0: 0, y0: 0, x1: Infinity, y1: Infinity };
}

/**
 * Box of a new vertex of `kind` placed with a click at `p`: centred on it, top-left on the grid. Bars are vertical
 * unless `horizontal`.
 */
export function newVertexBox(kind: VertexKind, p: Point, horizontal = false): Box {
  const [w, h] =
    kind === "state"
      ? [NEW_STATE_W, NEW_STATE_H]
      : isBarKind(kind)
        ? horizontal
          ? [NEW_BAR_LENGTH, BAR_THICKNESS]
          : [BAR_THICKNESS, NEW_BAR_LENGTH]
        : [PSEUDO_SIZE, PSEUDO_SIZE];
  return { x: snap(p.x - w / 2), y: snap(p.y - h / 2), w, h };
}

/**
 * Box of a new vertex drawn by dragging from `a` to `b`: a state spans the rectangle (at least MIN_STATE square), a
 * bar spans it along its axis; round pseudo states are placed at `b`. Snapped to the grid.
 */
export function draggedVertexBox(kind: VertexKind, a: Point, b: Point, horizontal = false): Box {
  if (isRoundKind(kind)) return newVertexBox(kind, b);
  const x0 = snap(Math.min(a.x, b.x)), y0 = snap(Math.min(a.y, b.y));
  const x1 = snap(Math.max(a.x, b.x)), y1 = snap(Math.max(a.y, b.y));
  if (kind === "state") return { x: x0, y: y0, w: Math.max(x1 - x0, MIN_STATE), h: Math.max(y1 - y0, MIN_STATE) };
  return horizontal
    ? { x: x0, y: snap(a.y - BAR_THICKNESS / 2), w: Math.max(x1 - x0, MIN_BAR), h: BAR_THICKNESS }
    : { x: snap(a.x - BAR_THICKNESS / 2), y: y0, w: BAR_THICKNESS, h: Math.max(y1 - y0, MIN_BAR) };
}

/** Why a vertex of `kind` cannot be added to a region (a message for the user), or undefined when it can. */
export function cannotAdd(index: DocIndex, regionId: Id, kind: VertexKind): string | undefined {
  const region = index.regions.get(regionId)?.region;
  if (!region) return `unknown region ${regionId}`;
  if (INITIALIZERS.has(kind)) {
    const other = region.states.find((v) => INITIALIZERS.has(v.kind));
    if (other) return `This region already has ${other.kind === "initial" ? "an initial state" : "a history state"}; a region has one.`;
  }
  return undefined;
}

/** First of "State1", "State2", ... that no state in the document is called. */
export function uniqueStateName(index: DocIndex, base = "State"): string {
  const names = new Set<string>();
  for (const { vertex } of index.vertices.values()) if (vertex.kind === "state") names.add(vertex.name);
  let n = 1;
  while (names.has(`${base}${n}`)) n++;
  return `${base}${n}`;
}

export interface AddOptions {
  /** Shared allocator when several elements are added in one edit. */
  ids?: IdAllocator;
}

/**
 * Add a vertex of `kind` to a region with absolute box `box` (snapped; states and bars keep their minimum size,
 * round pseudo states are PSEUDO_SIZE square). The box is kept inside the region's band where it fits. A state gets
 * `name`, or a fresh "StateN". Returns the new vertex's id. Check cannotAdd first.
 */
export function addVertex(
  doc: UfsmDocument,
  regionId: Id,
  kind: VertexKind,
  box: Box,
  opts: AddOptions & { name?: string; horizontal?: boolean } = {},
): Id {
  const index = indexV1(doc);
  const region = index.regions.get(regionId)?.region;
  if (!region) throw new Error(`unknown region ${regionId}`);
  const ids = opts.ids ?? new IdAllocator(doc);
  const id = ids.take(ID_PREFIX.vertex);
  const v: Vertex = kind === "state" ? { id, kind, name: opts.name ?? uniqueStateName(index) } : { id, kind };

  let w: number, h: number;
  if (kind === "state") [w, h] = [Math.max(snap(box.w), MIN_STATE), Math.max(snap(box.h), MIN_STATE)];
  else if (isBarKind(kind)) [w, h] = opts.horizontal ? [Math.max(snap(box.w), MIN_BAR), BAR_THICKNESS] : [BAR_THICKNESS, Math.max(snap(box.h), MIN_BAR)];
  else [w, h] = [PSEUDO_SIZE, PSEUDO_SIZE];
  const area = regionArea(index, region);
  // shrink to the band (not below the minimum), then move inside it
  if (kind === "state") {
    w = Math.max(Math.min(w, area.x1 - area.x0), MIN_STATE);
    h = Math.max(Math.min(h, area.y1 - area.y0), MIN_STATE);
  }
  const x = clamp(snap(box.x), area.x0, Math.max(area.x1 - w, area.x0));
  const y = clamp(snap(box.y), area.y0, Math.max(area.y1 - h, area.y0));
  const o = regionOrigin(index, region);
  const layout: StateLayout = { x: x - o.x, y: y - o.y, w, h };
  if (isBarKind(kind) && opts.horizontal) layout.orientation = "horizontal";
  region.states.push(v);
  diagramOf(doc).states[id] = layout;
  return id;
}

/**
 * Add a region at the bottom of a state. The state grows by NEW_BAND (a first region gets at least NEW_BAND below
 * the header), the previous last region keeps its height and the new one fills the rest. The growth is not limited
 * by the state's own region band. Returns the new region's id, or undefined when `stateId` is not a state.
 */
export function addRegion(doc: UfsmDocument, stateId: Id, opts: AddOptions & { name?: string } = {}): Id | undefined {
  const index = indexV1(doc);
  const s = index.vertices.get(stateId)?.vertex;
  if (s?.kind !== "state") return undefined;
  const b = vertexBox(index, s.id);
  const bands = regionBoxes(index, s);
  const last = bands[bands.length - 1];
  const top = b.y + HEADER_H + actionBlockHeight(s);
  const grow = last ? NEW_BAND : Math.max(0, NEW_BAND - (b.y + b.h - top));
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.region);
  const region: Region = opts.name ? { id, name: opts.name, states: [] } : { id, states: [] };
  followTransitions(doc, index, () => {
    if (grow > 0) (diagramOf(doc).states[s.id] ??= { ...stateLayout(index, s.id) }).h += grow;
    if (last) regionLayoutOf(doc, last.region.id).h = last.box.h;
    (s.regions ??= []).push(region);
  });
  return id;
}

/** Why a transition from `from` to `to` cannot be drawn (a message for the user), or undefined when it can. */
export function cannotConnect(index: DocIndex, from: Id, to?: Id): string | undefined {
  const a = index.vertices.get(from)?.vertex;
  if (!a) return `unknown vertex ${from}`;
  if (a.kind === "final" || a.kind === "terminate") return `A ${KIND_TEXT[a.kind]} has no outgoing transitions.`;
  if (INITIALIZERS.has(a.kind) && (index.outgoing.get(from)?.length ?? 0) > 0) {
    return `An ${a.kind === "initial" ? "initial state" : "history state"} has exactly one outgoing transition.`;
  }
  if (to === undefined) return undefined;
  const b = index.vertices.get(to)?.vertex;
  if (!b) return `unknown vertex ${to}`;
  // UML: an initial pseudo-state has no incoming transitions (enter its region, or a history state, instead).
  if (b.kind === "initial") return "An initial state cannot be the target of a transition.";
  return undefined;
}

/** Where the segment from `c` (inside box `b`) towards `d` leaves the box. */
function exitPoint(b: Box, c: Point, d: Point): Point {
  const dx = d.x - c.x, dy = d.y - c.y;
  let t = 1;
  if (dx > 0) t = Math.min(t, (b.x + b.w - c.x) / dx);
  if (dx < 0) t = Math.min(t, (b.x - c.x) / dx);
  if (dy > 0) t = Math.min(t, (b.y + b.h - c.y) / dy);
  if (dy < 0) t = Math.min(t, (b.y - c.y) / dy);
  return { x: c.x + t * dx, y: c.y + t * dy };
}

/**
 * Ends of a straight transition between two different vertices: where the line between their centres leaves each
 * box, snapped along the side (nearestEnd). A box that contains the other one's centre (a composite state and its
 * contents) attaches at its side nearest to that centre.
 */
function straightEnds(index: DocIndex, from: Id, to: Id): { from: EdgeEnd; to: EdgeEnd } {
  const a = vertexBox(index, from), b = vertexBox(index, to);
  const ka = index.vertices.get(from)!.vertex.kind, kb = index.vertices.get(to)!.vertex.kind;
  const ca = { x: a.x + a.w / 2, y: a.y + a.h / 2 }, cb = { x: b.x + b.w / 2, y: b.y + b.h / 2 };
  const end = (box: Box, c: Point, other: Point, round: boolean): EdgeEnd =>
    nearestEnd(box, inside(box, other) ? other : exitPoint(box, c, other), round);
  return { from: end(a, ca, cb, isRoundKind(ka)), to: end(b, cb, ca, isRoundKind(kb)) };
}

/** How addTransition lays out a transition without bend points. */
export type NewRoute = "s" | "straight";

/**
 * Add a transition without trigger. Without `via` it is an S route with automatic ends (`route` "s", the default), or
 * with `route` "straight" a free route: one straight line between the boxes, along the line between their centres
 * (a self-transition gets a small free loop around the top-right corner). With bend points (absolute, snapped) it is
 * a free route whose ends attach where the first and last bend point are nearest. `fromAt`/`toAt` (absolute, where
 * the user clicked the source and the target) attach those ends as close to the point as possible instead (pinned on
 * an S route); self-transitions ignore them. Every stored position is on the grid. Returns its id. Check
 * cannotConnect first.
 */
export function addTransition(
  doc: UfsmDocument,
  from: Id,
  to: Id,
  opts: AddOptions & { via?: Point[]; route?: NewRoute; fromAt?: Point; toAt?: Point } = {},
): Id {
  const index = indexV1(doc);
  const a = index.vertices.get(from)?.vertex, b = index.vertices.get(to)?.vertex;
  if (!a || !b) throw new Error(`unknown vertex ${a ? to : from}`);
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.transition);
  let layout: EdgeLayout = { route: "s" };
  let via = (opts.via ?? []).map((p) => ({ x: snap(p.x), y: snap(p.y) }));
  if (via.length === 0 && opts.route === "straight") {
    if (from === to) {
      const box = vertexBox(index, from);
      const r = snap(box.x + box.w), t = snap(box.y);
      via = [{ x: r + 3 * GRID, y: t + 2 * GRID }, { x: r + 3 * GRID, y: t - 3 * GRID }, { x: r - 2 * GRID, y: t - 3 * GRID }];
    } else layout = straightEnds(index, from, to);
  }
  if (via.length > 0) {
    const o = regionOrigin(index, commonRegion(index, from, to));
    layout = {
      from: nearestEnd(vertexBox(index, from), via[0]!, isRoundKind(a.kind)),
      to: nearestEnd(vertexBox(index, to), via[via.length - 1]!, isRoundKind(b.kind)),
      via: via.map((p): [number, number] => [Math.round(p.x - o.x), Math.round(p.y - o.y)]),
    };
  }
  if (from !== to) {
    if (opts.fromAt) layout.from = endAt(index, from, opts.fromAt);
    if (opts.toAt) layout.to = endAt(index, to, opts.toAt);
  }
  const t: Transition = { id, from, to };
  doc.machine.transitions.push(t);
  diagramOf(doc).transitions[id] = layout;

  if (opts.route === "straight") {
    const fresh = indexV1(doc);
    const g = edgeGeometry(fresh, id);
    if (g) {
      const anchor = labelAnchor(g.points).anchor;
      const rel = defaultLabel(g.points);
      const o = edgeOrigin(fresh, id);
      layout.label = {
        x: snap(anchor.x + rel.x - o.x),
        y: snap(anchor.y + rel.y - o.y),
        w: rel.w,
      };
    }
  }

  return id;
}

/**
 * Delete vertices, regions, transitions (internal ones too) and timers by id, with everything that depends on them:
 * a vertex takes its regions and their contents, a region its contents; transitions into or out of anything deleted
 * go too; guard terms `in`/`not in` a deleted state are dropped (a guard left empty is removed); their diagram
 * entries are removed. Deleting a region of a surviving state keeps the state's size: the regions below it move up
 * with their contents, and the last region fills the rest. The root region cannot be deleted. Declarations stay.
 * Returns the ids removed.
 */
export function deleteElements(doc: UfsmDocument, ids: Iterable<Id>): Set<Id> {
  const index = indexV1(doc);
  const goneV = new Set<Id>(), goneR = new Set<Id>(), goneT = new Set<Id>(), goneTimers = new Set<Id>();
  const dropRegion = (r: Region): void => {
    goneR.add(r.id);
    r.states.forEach(dropVertex);
  };
  const dropVertex = (v: Vertex): void => {
    goneV.add(v.id);
    if (v.kind !== "state") return;
    for (const t of v.internal ?? []) goneT.add(t.id);
    v.regions?.forEach(dropRegion);
  };
  const explicitRegions: Region[] = [];
  for (const id of ids) {
    const v = index.vertices.get(id)?.vertex;
    if (v) dropVertex(v);
    else if (index.transitions.has(id) || index.internals.has(id)) goneT.add(id);
    else if (index.timers.has(id)) goneTimers.add(id);
    else {
      const info = index.regions.get(id);
      if (info?.owner) explicitRegions.push(info.region);
    }
  }
  for (const r of explicitRegions) dropRegion(r);
  for (const t of index.doc.machine.transitions) if (goneV.has(t.from) || goneV.has(t.to)) goneT.add(t.id);
  if (goneV.size + goneR.size + goneT.size + goneTimers.size === 0) return new Set();

  followTransitions(doc, index, () => {
    // regions deleted from states that stay: later bands move up, the last band fills
    const owners = new Set<State>();
    for (const r of explicitRegions) {
      const owner = index.regions.get(r.id)?.owner;
      if (owner && !goneV.has(owner.id)) owners.add(owner);
    }
    for (const s of owners) {
      const bands = regionBoxes(index, s);
      let shift = 0;
      for (const { region, box } of bands) {
        if (goneR.has(region.id)) {
          shift += box.h;
          continue;
        }
        if (shift === 0 || isOffPage(index, region.id)) continue;
        for (const c of region.states) {
          const l = (diagramOf(doc).states[c.id] ??= { ...stateLayout(index, c.id) });
          l.y -= shift;
        }
      }
      const keep = (s.regions ?? []).filter((r) => !goneR.has(r.id));
      const lastGone = bands.length > 0 && goneR.has(bands[bands.length - 1]!.region.id);
      if (keep.length === 0) delete s.regions;
      else {
        s.regions = keep;
        const lastId = keep[keep.length - 1]!.id;
        const l = doc.diagram?.regions[lastId];
        if (lastGone && l) {
          delete l.h;
          if (Object.keys(l).length === 0) delete doc.diagram!.regions[lastId];
        }
      }
    }
    // vertices removed from regions that stay
    for (const id of goneV) {
      const region = index.vertices.get(id)!.region;
      if (goneR.has(region.id)) continue;
      const i = region.states.findIndex((v) => v.id === id);
      if (i >= 0) region.states.splice(i, 1);
    }
    doc.machine.transitions = doc.machine.transitions.filter((t) => !goneT.has(t.id));
    const keepTerm = (g: GuardTerm): boolean => !("in" in g && goneV.has(g.in));
    const prune = (t: { guard?: GuardTerm[] }): void => {
      if (!t.guard?.some((g) => !keepTerm(g))) return;
      const guard = t.guard.filter(keepTerm);
      if (guard.length) t.guard = guard;
      else delete t.guard;
    };
    doc.machine.transitions.forEach(prune);
    for (const id of goneTimers) {
      const { timer, state } = index.timers.get(id)!;
      if (goneV.has(state.id)) continue;
      const timers = state.timers!.filter((t) => t !== timer);
      if (timers.length) state.timers = timers;
      else delete state.timers;
    }
    for (const { vertex } of index.vertices.values()) {
      if (vertex.kind !== "state" || goneV.has(vertex.id) || !vertex.internal) continue;
      if (vertex.internal.some((t) => goneT.has(t.id))) {
        const internal = vertex.internal.filter((t) => !goneT.has(t.id));
        if (internal.length) vertex.internal = internal;
        else delete vertex.internal;
      }
      vertex.internal?.forEach(prune);
    }
  });
  const dia = doc.diagram;
  if (dia) {
    for (const id of goneV) delete dia.states[id];
    for (const id of goneR) delete dia.regions[id];
    for (const id of goneT) delete dia.transitions[id];
  }
  return new Set([...goneV, ...goneR, ...goneT, ...goneTimers]);
}

/** True when vertex `id` is `ancestor` or lies inside it. */
export function isWithin(index: DocIndex, id: Id, ancestor: Id): boolean {
  return id === ancestor || ancestors(index, id).some((a) => a.id === ancestor);
}
