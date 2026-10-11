// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Absolute diagram geometry for a v1 document.
 *
 * The file stores positions relative to their region's origin (see
 * StateLayout). This module resolves them to absolute coordinates on the
 * sheet where each element is drawn. A "sheet" is the root region or an
 * off-page region.
 */
import { HEADER, actionBlock } from "./action-block";
import { commonRegion, type DocIndex } from "./doc-index";
import { GRID, type EdgeEnd, type Id, type LabelLayout, type Region, type Side, type State, type StateLayout } from "./model";
import { autoSides, defaultLabel, labelAnchor, sRoute, sideLength, sideTowards, type JogAxis } from "./route";

export interface Point {
  x: number;
  y: number;
}

export interface Box extends Point {
  w: number;
  h: number;
}

/** Height of a state's name header. */
export const HEADER_H = HEADER;

const ZERO: Point = { x: 0, y: 0 };
const NO_LAYOUT: StateLayout = { x: 0, y: 0, w: 100, h: 60 };

export function isOffPage(index: DocIndex, regionId: Id): boolean {
  return index.doc.diagram?.regions[regionId]?.offPage === true;
}

/** True for the root region and off-page regions: they get a sheet of their own. */
export function isSheet(index: DocIndex, region: Region): boolean {
  return region === index.doc.machine.root || isOffPage(index, region.id);
}

/** The sheet a region's contents are drawn on. */
export function sheetOfRegion(index: DocIndex, region: Region): Region {
  let r = region;
  while (!isSheet(index, r)) {
    const owner = index.regions.get(r.id)?.owner;
    if (!owner) break;
    r = index.vertices.get(owner.id)!.region;
  }
  return r;
}

export function sheetOfVertex(index: DocIndex, id: Id): Region {
  const info = index.vertices.get(id);
  if (!info) throw new Error(`unknown vertex ${id}`);
  return sheetOfRegion(index, info.region);
}

export function stateLayout(index: DocIndex, id: Id): StateLayout {
  return index.doc.diagram?.states[id] ?? NO_LAYOUT;
}

/** Absolute origin of a region: the owner's top-left, or (0,0) for sheets. */
export function regionOrigin(index: DocIndex, region: Region): Point {
  if (isSheet(index, region)) return ZERO;
  const owner = index.regions.get(region.id)?.owner;
  if (!owner) return ZERO;
  const b = vertexBox(index, owner.id);
  return { x: b.x, y: b.y };
}

/** Absolute box of a vertex on its sheet. */
export function vertexBox(index: DocIndex, id: Id): Box {
  const info = index.vertices.get(id);
  if (!info) throw new Error(`unknown vertex ${id}`);
  const l = stateLayout(index, id);
  const o = regionOrigin(index, info.region);
  return { x: o.x + l.x, y: o.y + l.y, w: l.w, h: l.h };
}

/**
 * Space taken by the action block below the header (entry, exit, timer and internal transition lines): as tall as
 * its lines at the state's width, or the height stored for the state when that is smaller (v1/action-block.ts).
 */
export function actionBlockHeight(index: DocIndex, s: State): number {
  return actionBlock(index, s).height;
}

/**
 * Absolute bands of a state's regions, top-down. Regions start below the
 * header and the entry/exit block; each takes its layout height, and a
 * region without one fills what is left.
 */
export function regionBoxes(index: DocIndex, s: State): { region: Region; box: Box }[] {
  const sb = vertexBox(index, s.id);
  let y = sb.y + HEADER_H + actionBlockHeight(index, s);
  const bottom = sb.y + sb.h;
  return (s.regions ?? []).map((region) => {
    const h = index.doc.diagram?.regions[region.id]?.h ?? Math.max(bottom - y, 0);
    const box = { x: sb.x, y, w: sb.w, h };
    y += h;
    return { region, box };
  });
}

/** Absolute origin used for a transition's `via` and `label` coordinates. */
export function edgeOrigin(index: DocIndex, transitionId: Id): Point {
  const t = index.transitions.get(transitionId);
  if (!t) throw new Error(`unknown transition ${transitionId}`);
  return regionOrigin(index, commonRegion(index, t.from, t.to));
}

/** Point on a vertex's outline where an edge attaches. */
export function attachPoint(index: DocIndex, vertexId: Id, end: EdgeEnd): Point {
  const b = vertexBox(index, vertexId);
  const kind = index.vertices.get(vertexId)?.vertex.kind;
  // Round pseudo states always attach at the middle of the side.
  const centred =
    kind === "initial" || kind === "final" || kind === "shallow-history" || kind === "deep-history" || kind === "terminate";
  const oy = centred ? b.h / 2 : Math.min(end.offset, b.h);
  const ox = centred ? b.w / 2 : Math.min(end.offset, b.w);
  switch (end.side) {
    case "left":
      return { x: b.x, y: b.y + oy };
    case "right":
      return { x: b.x + b.w, y: b.y + oy };
    case "top":
      return { x: b.x + ox, y: b.y };
    case "bottom":
      return { x: b.x + ox, y: b.y + b.h };
  }
}

export interface EdgeGeometry {
  points: Point[];
  label: (Point & { w: number }) | undefined;
}

/** How an S route's ends and movable segment were resolved (for the editor's handles). */
export interface SRouteInfo {
  from: EdgeEnd;
  to: EdgeEnd;
  /** True for an end the file pins; false for one chosen automatically. */
  fromPinned: boolean;
  toPinned: boolean;
  /** Movable segment: axis and absolute position, or undefined (straight or L). */
  jog: { axis: JogAxis; value: number } | undefined;
  /** Absolute point that the stored label is relative to. */
  labelAnchor: Point;
}

/** Gap between the default jogs of parallel S routes (same two vertices). */
const PARALLEL_GAP = 14;

interface ResolvedEnds {
  from: EdgeEnd;
  to: EdgeEnd;
  fromPinned: boolean;
  toPinned: boolean;
  stagger: number;
  lane: number;
}

const resolvedCache = new WeakMap<DocIndex, Map<Id, ResolvedEnds>>();

/**
 * Sides and offsets of every S route's ends. Automatic ends on the same side of
 * a vertex are spread evenly along it, ordered by where their other end lies
 * (so they do not cross); parallel routes get staggered default jogs.
 */
function resolveSEnds(index: DocIndex): Map<Id, ResolvedEnds> {
  const cached = resolvedCache.get(index);
  if (cached) return cached;
  const out = new Map<Id, ResolvedEnds>();
  const layouts = index.doc.diagram?.transitions ?? {};
  type Pending = { id: Id; end: "from" | "to"; vertex: Id; side: Side; other: Point; order: number };
  const pending: Pending[] = [];
  const pairs = new Map<string, Id[]>();
  const selfLoops = new Map<Id, number>();
  index.doc.machine.transitions.forEach((t, order) => {
    const e = layouts[t.id];
    if (e?.route !== "s" || !index.vertices.has(t.from) || !index.vertices.has(t.to)) return;
    const a = vertexBox(index, t.from), b = vertexBox(index, t.to);
    let sf: Side, st: Side;
    if (e.from && e.to) [sf, st] = [e.from.side, e.to.side];
    else if (e.from) [sf, st] = [e.from.side, sideTowards(b, attachPoint(index, t.from, e.from), e.from.side === "left" || e.from.side === "right")];
    else if (e.to) [sf, st] = [sideTowards(a, attachPoint(index, t.to, e.to), e.to.side === "left" || e.to.side === "right"), e.to.side];
    else if (t.from === t.to) {
      // a self-transition loops around the top-right corner: out of the right side near the top, into the top near the right
      const loops = (selfLoops.get(t.from) ?? 0) + 1;
      selfLoops.set(t.from, loops);
      const k = loops - 1;
      out.set(t.id, {
        from: { side: "right", offset: Math.min(2 * GRID + GRID * k, a.h / 2) },
        to: { side: "top", offset: Math.max(a.w - 2 * GRID - GRID * k, a.w / 2) },
        fromPinned: false,
        toPinned: false,
        stagger: 0,
        lane: 0,
      });
      return;
    } else [sf, st] = autoSides(a, b);
    const centre = (x: Box): Point => ({ x: x.x + x.w / 2, y: x.y + x.h / 2 });
    out.set(t.id, { from: e.from ?? { side: sf, offset: 0 }, to: e.to ?? { side: st, offset: 0 }, fromPinned: !!e.from, toPinned: !!e.to, stagger: 0, lane: 0 });
    if (!e.from) pending.push({ id: t.id, end: "from", vertex: t.from, side: sf, other: e.to ? attachPoint(index, t.to, e.to) : centre(b), order: 2 * order });
    if (!e.to) pending.push({ id: t.id, end: "to", vertex: t.to, side: st, other: e.from ? attachPoint(index, t.from, e.from) : centre(a), order: 2 * order + 1 });
    const key = [t.from, t.to].sort().join(" ");
    pairs.set(key, [...(pairs.get(key) ?? []), t.id]);
  });
  const groups = new Map<string, Pending[]>();
  const exactOffsets = new Map<string, number>();
  for (const p of pending) groups.set(`${p.vertex} ${p.side}`, [...(groups.get(`${p.vertex} ${p.side}`) ?? []), p]);
  for (const list of groups.values()) {
    const box = vertexBox(index, list[0]!.vertex);
    const side = list[0]!.side;
    const along = (pt: Point): number => (side === "left" || side === "right" ? pt.y : pt.x);
    list.sort((u, v) => along(u.other) - along(v.other) || u.order - v.order);
    const len = sideLength(box, side);
    const start = side === "left" || side === "right" ? box.y : box.x;
    // evenly spread, each on the grid line nearest to its place when those stay distinct and off the corners
    const exact = list.map((_, i) => Math.round((len * (i + 1)) / (list.length + 1)));
    const snapped = exact.map((o) => Math.round((start + o) / GRID) * GRID - start);
    const useGrid = snapped.every((o, i) => o > 0 && o < len && (i === 0 || o > snapped[i - 1]!));
    list.forEach((p, i) => {
      const r = out.get(p.id)!;
      r[p.end] = { side, offset: (useGrid ? snapped : exact)[i]! };
      exactOffsets.set(`${p.id} ${p.end}`, exact[i]!);
    });
  }
  // Snapping can put both ends of a U (same side) level with each other, which folds the route back on itself: such
  // routes keep their exact automatic offsets.
  for (const [id, r] of out) {
    if (r.from.side !== r.to.side || (r.fromPinned && r.toPinned)) continue;
    const t = index.transitions.get(id)!;
    const along = (v: Id, end: EdgeEnd): number => {
      const pt = attachPoint(index, v, end);
      return end.side === "left" || end.side === "right" ? pt.y : pt.x;
    };
    if (Math.abs(along(t.from, r.from) - along(t.to, r.to)) > 0.5) continue;
    for (const end of ["from", "to"] as const) {
      const exact = exactOffsets.get(`${id} ${end}`);
      if (exact !== undefined) r[end] = { side: r[end].side, offset: exact };
    }
  }
  for (const ids of pairs.values()) {
    if (ids.length < 2) continue;
    ids.forEach((id, k) => {
      const r = out.get(id)!;
      r.stagger = (k - (ids.length - 1) / 2) * PARALLEL_GAP;
      r.lane = k * PARALLEL_GAP;
    });
  }
  resolvedCache.set(index, out);
  return out;
}

/** Absolute polyline and label of an S route, plus how it was resolved. */
function sGeometry(index: DocIndex, transitionId: Id): (EdgeGeometry & { info: SRouteInfo }) | undefined {
  const t = index.transitions.get(transitionId);
  const e = index.doc.diagram?.transitions[transitionId];
  const r = resolveSEnds(index).get(transitionId);
  if (!t || e?.route !== "s" || !r) return undefined;
  const o = edgeOrigin(index, transitionId);
  const p = attachPoint(index, t.from, r.from), q = attachPoint(index, t.to, r.to);
  const jog = e.jog ? ("x" in e.jog ? { x: e.jog.x + o.x } : { y: e.jog.y + o.y }) : undefined;
  const route = sRoute(p, r.from.side, q, r.to.side, jog, r.stagger, r.lane);
  const anchor = labelAnchor(route.points).anchor;
  const rel: LabelLayout = e.label ?? defaultLabel(route.points);
  return {
    points: route.points,
    label: { x: anchor.x + rel.x, y: anchor.y + rel.y, w: rel.w },
    info: { from: r.from, to: r.to, fromPinned: r.fromPinned, toPinned: r.toPinned, jog: route.jog, labelAnchor: anchor },
  };
}

/** Resolved ends and movable segment of an S route; undefined for free routes. */
export function routeInfo(index: DocIndex, transitionId: Id): SRouteInfo | undefined {
  return sGeometry(index, transitionId)?.info;
}

/** Absolute polyline (start, bends..., end) and label position of a transition, free or S. */
export function edgeGeometry(index: DocIndex, transitionId: Id): EdgeGeometry | undefined {
  const t = index.transitions.get(transitionId);
  const e = index.doc.diagram?.transitions[transitionId];
  if (!t || !e || !index.vertices.has(t.from) || !index.vertices.has(t.to)) return undefined;
  if (e.route === "s") {
    const g = sGeometry(index, transitionId);
    return g && { points: g.points, label: g.label };
  }
  const o = edgeOrigin(index, transitionId);
  const points = [
    attachPoint(index, t.from, e.from),
    ...(e.via ?? []).map(([x, y]) => ({ x: o.x + x, y: o.y + y })),
    attachPoint(index, t.to, e.to),
  ];
  const label = e.label ? { x: o.x + e.label.x, y: o.y + e.label.y, w: e.label.w } : undefined;
  return { points, label };
}
