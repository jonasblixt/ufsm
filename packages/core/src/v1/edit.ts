// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Layout edits: what the editor does when something is dragged. Every function mutates the document it is given and
 * changes nothing but its `diagram` section. The editor passes an Immer draft and records the patches as one undo
 * step; tests pass a plain object.
 *
 * Positions given to these functions are absolute sheet coordinates (as the editor's pointer reports them); they
 * are snapped to the grid and converted to the file's relative coordinates here. Constraints:
 *   - a vertex stays inside the band of its region (on its sheet: at non-negative coordinates);
 *   - a state cannot shrink past its contents or below a minimum size, region bands keep a minimum height;
 *   - a limit never forces an element to move: one that already breaks it may stay where it is.
 *
 * Transitions follow: free routes map their bend points and label with followPolyline when their ends move; S routes
 * are derived anyway, so only their stored jog changes, and only when the whole route moves (both ends by the same
 * amount); otherwise the jog keeps its absolute position.
 */
import { ancestors, indexV1, type DocIndex } from "./doc-index";
import {
  HEADER_H,
  actionBlockHeight,
  edgeGeometry,
  edgeOrigin,
  isOffPage,
  isSheet,
  regionBoxes,
  routeInfo,
  stateLayout,
  vertexBox,
  type Box,
  type Point,
} from "./geometry";
import { GRID, type Diagram, type EdgeEnd, type FreeEdgeLayout, type Id, type RegionLayout, type Side, type State, type StateLayout, type UfsmDocument } from "./model";
import { followOffset, followPolyline, sideLength } from "./route";

/** Smallest region band. */
export const MIN_BAND = 40;
/** Smallest state width and height (a state with entry/exit lines is at least as tall as its header and lines). */
export const MIN_STATE = 40;
/** Shortest fork/join bar. */
export const MIN_BAR = 20;

export type Edge = "left" | "top" | "right" | "bottom";
/** New absolute positions for some edges of a box. */
export type EdgeTargets = Partial<Record<Edge, number>>;
export type EdgeEndName = "from" | "to";

export const snap = (v: number, grid = GRID): number => Math.round(v / grid) * grid;

const ZERO: Point = { x: 0, y: 0 };
const clamp = (v: number, lo: number, hi: number): number => Math.min(Math.max(v, lo), hi);
/** Clamp to [lo, hi], but never further than `cur` already is: limits stop movement, they do not cause it. */
const fit = (want: number, lo: number, hi: number, cur: number): number => clamp(want, Math.min(lo, cur), Math.max(hi, cur));
const near = (a: Point, b: Point): boolean => Math.abs(a.x - b.x) < 1e-6 && Math.abs(a.y - b.y) < 1e-6;
const sub = (a: Point, b: Point): Point => ({ x: a.x - b.x, y: a.y - b.y });

/** The document's diagram section, created when missing. */
export function diagramOf(doc: UfsmDocument): Diagram {
  return (doc.diagram ??= { paper: "A4", states: {}, regions: {}, transitions: {} });
}

function layoutOf(doc: UfsmDocument, index: DocIndex, id: Id): StateLayout {
  return (diagramOf(doc).states[id] ??= { ...stateLayout(index, id) });
}

/** A region's layout entry, created when missing. */
export function regionLayoutOf(doc: UfsmDocument, id: Id): RegionLayout {
  return (diagramOf(doc).regions[id] ??= {});
}

/** Which edges of a vertex can be dragged: all four for states, the two ends of a fork/join bar, none for the rest. */
export function resizableEdges(index: DocIndex, id: Id): Edge[] {
  const v = index.vertices.get(id)?.vertex;
  if (!v) return [];
  if (v.kind === "state") return ["left", "top", "right", "bottom"];
  if (v.kind === "fork" || v.kind === "join") {
    return stateLayout(index, id).orientation === "horizontal" ? ["left", "right"] : ["top", "bottom"];
  }
  return [];
}

/** Absolute band of the region a vertex lives in; undefined when that region is a sheet (root or off-page). */
export function regionBand(index: DocIndex, id: Id): Box | undefined {
  const info = index.vertices.get(id);
  if (!info || isSheet(index, info.region)) return undefined;
  const owner = index.regions.get(info.region.id)?.owner;
  return owner && regionBoxes(index, owner).find((r) => r.region.id === info.region.id)?.box;
}

export interface Limits {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Where a vertex may be: its region band, or the non-negative quadrant of its sheet. */
export function limitsOf(index: DocIndex, id: Id): Limits {
  const b = regionBand(index, id);
  return b ? { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h } : { x0: 0, y0: 0, x1: Infinity, y1: Infinity };
}

/** The given vertex ids without those inside another one of them (moving a state moves its contents). */
export function topLevelVertices(index: DocIndex, ids: Iterable<Id>): Id[] {
  const set = new Set([...ids].filter((id) => index.vertices.has(id)));
  return [...set].filter((id) => !ancestors(index, id).some((a) => set.has(a.id)));
}

/** Boxes of the vertices drawn inside a state's region (none for an off-page region). */
function contents(index: DocIndex, s: State, k: number): Box[] {
  const r = s.regions?.[k];
  if (!r || isOffPage(index, r.id)) return [];
  return r.states.map((v) => vertexBox(index, v.id));
}

interface Snapshot {
  points: Point[];
  label: Point | undefined;
  origin: Point;
}

/**
 * Run `change` (which moves or resizes vertices) and let the transitions follow: free bend points and labels are
 * mapped by how their ends moved, an S jog moves only with a route that moves as a whole. Transitions whose geometry
 * did not change are not written. `before` must index `doc` as it is before the change.
 */
export function followTransitions(doc: UfsmDocument, before: DocIndex, change: () => void): void {
  const old = new Map<Id, Snapshot>();
  for (const t of doc.machine.transitions) {
    const g = edgeGeometry(before, t.id);
    if (g) old.set(t.id, { points: g.points, label: g.label && { x: g.label.x, y: g.label.y }, origin: edgeOrigin(before, t.id) });
  }
  change();
  const after = indexV1(doc);
  for (const t of doc.machine.transitions) {
    const was = old.get(t.id);
    const e = doc.diagram?.transitions[t.id];
    const g = was && e && edgeGeometry(after, t.id);
    if (!was || !e || !g) continue;
    const o = edgeOrigin(after, t.id);
    const ds = sub(g.points[0]!, was.points[0]!);
    const de = sub(g.points[g.points.length - 1]!, was.points[was.points.length - 1]!);
    if (e.route === "s") {
      if (!e.jog) continue;
      const axis = "x" in e.jog ? "x" : "y";
      const stored = "x" in e.jog ? e.jog.x : e.jog.y;
      const shift = near(ds, de) ? ds[axis] : 0;
      const rel = Math.round(stored + was.origin[axis] + shift - o[axis]);
      if (rel !== stored) e.jog = axis === "x" ? { x: rel } : { y: rel };
      continue;
    }
    if (near(ds, ZERO) && near(de, ZERO) && near(o, was.origin)) continue;
    if (e.via?.length) {
      const via = followPolyline(was.points, ds, de)
        .slice(1, -1)
        .map((p): [number, number] => [Math.round(p.x - o.x), Math.round(p.y - o.y)]);
      if (via.some(([x, y], i) => x !== e.via![i]![0] || y !== e.via![i]![1])) e.via = via;
    }
    if (e.label && was.label) {
      // the label hangs above its text line: follow the point where the first line is drawn
      const d = followOffset(was.points, { x: was.label.x, y: was.label.y + 40 }, ds, de);
      const x = Math.round(was.label.x + d.x - o.x), y = Math.round(was.label.y + d.y - o.y);
      if (x !== e.label.x || y !== e.label.y) e.label = { x, y, w: e.label.w };
    }
  }
}

/**
 * Move vertices (with everything inside them) by (dx, dy). With `anchor`, the delta is first adjusted so the
 * anchor's top-left lands on the grid. The delta is then limited so every moved vertex stays inside its region band.
 * Returns the delta applied.
 */
export function moveVertices(doc: UfsmDocument, ids: Iterable<Id>, dx: number, dy: number, anchor?: Id): Point {
  const index = indexV1(doc);
  const top = topLevelVertices(index, ids);
  if (top.length === 0) return ZERO;
  if (anchor !== undefined && index.vertices.has(anchor)) {
    const a = vertexBox(index, anchor);
    dx = snap(a.x + dx) - a.x;
    dy = snap(a.y + dy) - a.y;
  }
  for (const id of top) {
    const b = vertexBox(index, id);
    const lim = limitsOf(index, id);
    dx = clamp(dx, Math.min(lim.x0 - b.x, 0), Math.max(lim.x1 - b.x - b.w, 0));
    dy = clamp(dy, Math.min(lim.y0 - b.y, 0), Math.max(lim.y1 - b.y - b.h, 0));
  }
  dx = Math.round(dx);
  dy = Math.round(dy);
  if (dx === 0 && dy === 0) return ZERO;
  followTransitions(doc, index, () => {
    for (const id of top) {
      const l = layoutOf(doc, index, id);
      l.x += dx;
      l.y += dy;
    }
  });
  return { x: dx, y: dy };
}

/**
 * Drag some edges of a vertex to new absolute positions (snapped). The other edges stay. Contents keep their absolute
 * positions (moving the left or top edge rewrites their relative coordinates), the top edge takes its height from
 * the first region band and the bottom edge gives it to the last one, and transition ends on the vertex keep their
 * absolute attach points where the side still reaches.
 */
export function resizeVertex(doc: UfsmDocument, id: Id, targets: EdgeTargets): void {
  const index = indexV1(doc);
  const v = index.vertices.get(id)?.vertex;
  if (!v) return;
  const allowed = new Set(resizableEdges(index, id));
  const b = vertexBox(index, id);
  const lim = limitsOf(index, id);
  const s = v.kind === "state" ? v : undefined;
  const header = s ? HEADER_H + actionBlockHeight(s) : 0;
  const regions = s?.regions ?? [];
  const bands = s ? regionBoxes(index, s) : [];
  const fixed = (k: number): number | undefined => index.doc.diagram?.regions[regions[k]!.id]?.h;
  const all = s ? regions.flatMap((_, k) => contents(index, s, k)) : [];
  const minSide = s ? MIN_STATE : MIN_BAR;
  const want = (e: Edge): number | undefined => (allowed.has(e) && targets[e] !== undefined ? snap(targets[e]) : undefined);

  let x0 = b.x, y0 = b.y, x1 = b.x + b.w, y1 = b.y + b.h;
  const left = want("left"), right = want("right"), top = want("top"), bottom = want("bottom");
  if (left !== undefined) x0 = fit(left, lim.x0, Math.min(x1 - minSide, ...all.map((c) => c.x)), b.x);
  if (right !== undefined) x1 = fit(right, Math.max(x0 + minSide, ...all.map((c) => c.x + c.w)), lim.x1, b.x + b.w);
  const last = regions.length - 1;
  if (top !== undefined) {
    let hi: number;
    if (regions.length === 0) hi = y1 - Math.max(minSide, header);
    else {
      // the first band's bottom stays where it is; its top moves with the state's top
      const h0 = fixed(0);
      const bandBottom = h0 !== undefined ? b.y + header + h0 : bands[0]!.box.y + bands[0]!.box.h;
      hi = Math.min(bandBottom - header - MIN_BAND, ...contents(index, s!, 0).map((c) => c.y - header));
    }
    y0 = fit(top, lim.y0, hi, b.y);
  }
  // top of the last band after the top edge moved (later bands do not move: the first band absorbs it)
  const lastTop = last < 0 ? 0 : last === 0 ? y0 + header : bands[last]!.box.y;
  if (bottom !== undefined) {
    const lo = last < 0 ? y0 + Math.max(minSide, header) : Math.max(lastTop + MIN_BAND, ...contents(index, s!, last).map((c) => c.y + c.h));
    y1 = fit(bottom, lo, lim.y1, b.y + b.h);
  }
  const dl = x0 - b.x, dt = y0 - b.y;
  if (dl === 0 && dt === 0 && x1 === b.x + b.w && y1 === b.y + b.h) return;

  followTransitions(doc, index, () => {
    const l = layoutOf(doc, index, id);
    l.x += dl;
    l.y += dt;
    l.w = x1 - x0;
    l.h = y1 - y0;
    if (s) {
      if (dl !== 0 || dt !== 0) {
        for (const r of regions) {
          if (isOffPage(index, r.id)) continue;
          for (const c of r.states) {
            const cl = layoutOf(doc, index, c.id);
            cl.x -= dl;
            cl.y -= dt;
          }
        }
      }
      const h0 = regions.length ? fixed(0) : undefined;
      if (dt !== 0 && h0 !== undefined) regionLayoutOf(doc, regions[0]!.id).h = h0 - dt;
      if (y1 !== b.y + b.h && last >= 0 && fixed(last) !== undefined) regionLayoutOf(doc, regions[last]!.id).h = y1 - lastTop;
    }
    if (dl === 0 && dt === 0) return;
    for (const t of doc.machine.transitions) {
      const e = doc.diagram?.transitions[t.id];
      if (!e) continue;
      for (const which of ["from", "to"] as const) {
        const end = e[which];
        if (t[which] !== id || !end) continue;
        const alongY = end.side === "left" || end.side === "right";
        const shift = alongY ? dt : dl;
        if (shift !== 0) end.offset = clamp(end.offset - shift, 0, alongY ? y1 - y0 : x1 - x0);
      }
    }
  });
}

/**
 * Move the separator below region band `k` of a state to absolute height `y` (snapped). Band k takes the difference
 * from band k+1, so the state keeps its size; both keep their contents and a minimum height.
 */
export function moveRegionSplit(doc: UfsmDocument, stateId: Id, k: number, y: number): void {
  const index = indexV1(doc);
  const s = index.vertices.get(stateId)?.vertex;
  if (s?.kind !== "state" || !s.regions || k < 0 || k >= s.regions.length - 1) return;
  const bands = regionBoxes(index, s);
  const a = bands[k]!.box, b = bands[k + 1]!.box;
  const cur = a.y + a.h;
  const lo = Math.max(a.y + MIN_BAND, ...contents(index, s, k).map((c) => c.y + c.h));
  const hi = Math.min(b.y + b.h - MIN_BAND, ...contents(index, s, k + 1).map((c) => c.y));
  const sep = fit(snap(y), lo, hi, cur);
  if (sep === cur) return;
  regionLayoutOf(doc, s.regions[k]!.id).h = sep - a.y;
  const next = s.regions[k + 1]!;
  if (index.doc.diagram?.regions[next.id]?.h !== undefined) regionLayoutOf(doc, next.id).h = b.y + b.h - sep;
}

/**
 * The end on box `b` nearest to point `p`: the closest side, at the snapped position along it (kept 10 units from
 * the corners). `centred` (round pseudo states) always attaches at the middle.
 */
export function nearestEnd(b: Box, p: Point, centred = false): EdgeEnd {
  const outY = Math.max(b.y - p.y, 0, p.y - b.y - b.h);
  const outX = Math.max(b.x - p.x, 0, p.x - b.x - b.w);
  const dist: [Side, number][] = [
    ["left", Math.hypot(p.x - b.x, outY)],
    ["right", Math.hypot(p.x - b.x - b.w, outY)],
    ["top", Math.hypot(p.y - b.y, outX)],
    ["bottom", Math.hypot(p.y - b.y - b.h, outX)],
  ];
  const side = dist.reduce((m, d) => (d[1] < m[1] ? d : m))[0];
  const len = sideLength(b, side);
  if (centred) return { side, offset: Math.round(len / 2) };
  const margin = Math.min(GRID, len / 2);
  const along = side === "left" || side === "right" ? snap(p.y) - b.y : snap(p.x) - b.x;
  return { side, offset: Math.round(clamp(along, margin, len - margin)) };
}

const ROUND = new Set(["initial", "final", "shallow-history", "deep-history", "terminate"]);

/** The end on vertex `vertexId` nearest to point `p` (see nearestEnd; round pseudo states attach at the middle). */
export function endAt(index: DocIndex, vertexId: Id, p: Point): EdgeEnd {
  const kind = index.vertices.get(vertexId)?.vertex.kind;
  return nearestEnd(vertexBox(index, vertexId), p, kind !== undefined && ROUND.has(kind));
}

/** Attach one end of a transition where `p` is (see nearestEnd). On an S route this pins the end. */
export function setEdgeEnd(doc: UfsmDocument, transitionId: Id, which: EdgeEndName, p: Point): void {
  const index = indexV1(doc);
  const t = index.transitions.get(transitionId);
  const e = doc.diagram?.transitions[transitionId];
  if (!t || !e) return;
  const vid = t[which];
  if (!index.vertices.has(vid)) return;
  const end = endAt(index, vid, p);
  const cur = e[which];
  if (cur && cur.side === end.side && cur.offset === end.offset) return;
  e[which] = end;
}

/** Give a pinned S route end back to automatic placement. */
export function unpinEdgeEnd(doc: UfsmDocument, transitionId: Id, which: EdgeEndName): void {
  const e = doc.diagram?.transitions[transitionId];
  if (e?.route === "s" && e[which]) delete e[which];
}

/** Put an S route's movable segment at absolute position `value` (snapped) on the axis it currently has. */
export function setJog(doc: UfsmDocument, transitionId: Id, value: number): void {
  const index = indexV1(doc);
  const e = doc.diagram?.transitions[transitionId];
  const info = routeInfo(index, transitionId);
  if (e?.route !== "s" || !info?.jog) return;
  const o = edgeOrigin(index, transitionId);
  const v = Math.round(snap(value) - o[info.jog.axis]);
  if (info.jog.axis === "x") {
    if (!e.jog || !("x" in e.jog) || e.jog.x !== v) e.jog = { x: v };
  } else if (!e.jog || !("y" in e.jog) || e.jog.y !== v) e.jog = { y: v };
}

/** Let an S route centre its movable segment again. */
export function resetJog(doc: UfsmDocument, transitionId: Id): void {
  const e = doc.diagram?.transitions[transitionId];
  if (e?.route === "s" && e.jog) delete e.jog;
}

/** Move bend point `i` of a free route to absolute point `p` (snapped). */
export function setBendPoint(doc: UfsmDocument, transitionId: Id, i: number, p: Point): void {
  const index = indexV1(doc);
  const e = doc.diagram?.transitions[transitionId];
  if (!e || e.route === "s" || !e.via?.[i] || !index.transitions.has(transitionId)) return;
  const o = edgeOrigin(index, transitionId);
  const x = Math.round(snap(p.x) - o.x), y = Math.round(snap(p.y) - o.y);
  if (e.via[i]![0] !== x || e.via[i]![1] !== y) e.via[i] = [x, y];
}

/**
 * Put a transition's label with its top-left at absolute point `p` (snapped), keeping its width. S labels are stored
 * relative to the route's label anchor, so they keep following the route. A free route without a label has none to
 * move.
 */
export function setLabel(doc: UfsmDocument, transitionId: Id, p: Point): void {
  const index = indexV1(doc);
  const e = doc.diagram?.transitions[transitionId];
  const g = edgeGeometry(index, transitionId);
  if (!e || !g?.label) return;
  const base = e.route === "s" ? routeInfo(index, transitionId)!.labelAnchor : edgeOrigin(index, transitionId);
  const x = Math.round(snap(p.x) - base.x), y = Math.round(snap(p.y) - base.y);
  if (!e.label || e.label.x !== x || e.label.y !== y) e.label = { x, y, w: g.label.w };
}

/** Give an S route its default label position again. */
export function resetLabel(doc: UfsmDocument, transitionId: Id): void {
  const e = doc.diagram?.transitions[transitionId];
  if (e?.route === "s" && e.label) delete e.label;
}

/**
 * Make a transition a free route with the shape it has now: an S route's ends are pinned where they are, its corners
 * become bend points and its label keeps its place. Free routes are left alone.
 */
export function toFreeRoute(doc: UfsmDocument, transitionId: Id): void {
  const index = indexV1(doc);
  const e = doc.diagram?.transitions[transitionId];
  const info = routeInfo(index, transitionId);
  const g = edgeGeometry(index, transitionId);
  if (e?.route !== "s" || !info || !g) return;
  const o = edgeOrigin(index, transitionId);
  const free: FreeEdgeLayout = { from: { ...info.from }, to: { ...info.to } };
  const via = g.points.slice(1, -1).map((p): [number, number] => [Math.round(p.x - o.x), Math.round(p.y - o.y)]);
  if (via.length) free.via = via;
  if (g.label) free.label = { x: Math.round(g.label.x - o.x), y: Math.round(g.label.y - o.y), w: g.label.w };
  diagramOf(doc).transitions[transitionId] = free;
}

/**
 * Make a transition an S route with automatic ends, a centred jog and the default label (the "convert to S"
 * command). S routes are left alone.
 */
export function toSRoute(doc: UfsmDocument, transitionId: Id): void {
  const e = doc.diagram?.transitions[transitionId];
  if (!e || e.route === "s" || !doc.machine.transitions.some((t) => t.id === transitionId)) return;
  diagramOf(doc).transitions[transitionId] = { route: "s" };
}

/**
 * Add a bend point at absolute point `p` (snapped) to the segment of a transition nearest to it. An S route becomes
 * a free route first (toFreeRoute), keeping its shape. Returns the new bend point's index, or -1.
 */
export function insertBendPoint(doc: UfsmDocument, transitionId: Id, p: Point): number {
  toFreeRoute(doc, transitionId);
  const index = indexV1(doc);
  const e = doc.diagram?.transitions[transitionId];
  const g = edgeGeometry(index, transitionId);
  if (!e || e.route === "s" || !g || g.points.length < 2) return -1;
  let best = Infinity, seg = 0;
  for (let i = 1; i < g.points.length; i++) {
    const d = segmentDistance(p, g.points[i - 1]!, g.points[i]!);
    if (d < best) {
      best = d;
      seg = i - 1;
    }
  }
  const o = edgeOrigin(index, transitionId);
  const via = [...(e.via ?? [])];
  via.splice(seg, 0, [Math.round(snap(p.x) - o.x), Math.round(snap(p.y) - o.y)]);
  e.via = via;
  return seg;
}

/** Remove bend point `i` of a free route. */
export function removeBendPoint(doc: UfsmDocument, transitionId: Id, i: number): void {
  const e = doc.diagram?.transitions[transitionId];
  if (!e || e.route === "s" || !e.via?.[i]) return;
  if (e.via.length === 1) delete e.via;
  else e.via.splice(i, 1);
}

/** Distance from point p to segment a-b. */
export function segmentDistance(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const t = len2 > 0 ? clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0, 1) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
