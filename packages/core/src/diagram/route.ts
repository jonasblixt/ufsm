// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Orthogonal "S" routes (diagram `route: "s"`): the file stores intent, this
 * module derives the polyline, so a transition follows when its states move.
 *
 * Both ends sit on a side of their vertex. Facing sides give an S (leave,
 * one jog, enter); perpendicular sides an L; the same side on both ends a U;
 * sides that face away from each other a five-segment detour. The one
 * segment the user may move is the jog: its position is stored as an
 * absolute coordinate together with its axis (`{x}` or `{y}`), so a value
 * that no longer fits the shape (the states were rearranged) is ignored.
 *
 * Everything here is pure geometry on absolute coordinates; geometry.ts
 * supplies the boxes, picks automatic sides and spreads parallel routes.
 * Default positions (jogs, stubs, lanes) lie on the 10-unit grid whenever the
 * shape allows it, so a new transition between grid-aligned states is
 * grid-aligned too.
 */
import type { Box } from "./geometry";
import { GRID, type Side } from "../format/model";

export interface Pt {
  x: number;
  y: number;
}


/** Axis of the movable segment, if the shape has one: `x` = a vertical segment at that x, `y` = a horizontal one. */
export type JogAxis = "x" | "y";
export type Jog = { x: number } | { y: number };

export interface SRoute {
  /** Start, bends, end; consecutive points differ, every segment is horizontal or vertical. */
  points: Pt[];
  /** Axis and position of the movable segment, or undefined for shapes without one (straight, L). */
  jog: { axis: JogAxis; value: number } | undefined;
}

/** Length of the stubs a detour or U uses to get away from a box before turning. */
export const STUB = 24;

const horizontal = (s: Side): boolean => s === "left" || s === "right";
/** +1 if leaving the side moves towards larger coordinates (right, bottom), -1 otherwise. */
const outward = (s: Side): number => (s === "right" || s === "bottom" ? 1 : -1);
const EPS = 0.5;

/** Nearest grid line. */
const onGrid = (v: number): number => Math.round(v / GRID) * GRID;
/** The first grid line at or beyond `v` in direction `dir` (+1 or -1): stubs and lanes around boxes stay outside. */
const gridOut = (v: number, dir: number): number => (dir > 0 ? Math.ceil(v / GRID - 1e-9) : Math.floor(v / GRID + 1e-9)) * GRID;
/** The first candidate that `ok` accepts (grid-aligned defaults first, then the exact ones), else the last. */
const firstOk = (ok: (v: number) => boolean, ...vs: number[]): number => vs.find(ok) ?? vs[vs.length - 1]!;

function jogValue(jog: Jog | undefined, axis: JogAxis, dflt: number): number {
  if (jog && axis in jog) return (jog as Record<JogAxis, number>)[axis];
  return dflt;
}

/** Drop repeated points and merge collinear runs, keeping the first and last point. */
export function simplifyPolyline(points: Pt[]): Pt[] {
  const out: Pt[] = [];
  for (const p of points) {
    const last = out[out.length - 1];
    if (last && Math.abs(last.x - p.x) < 1e-9 && Math.abs(last.y - p.y) < 1e-9) continue;
    out.push({ x: p.x, y: p.y });
  }
  for (let i = out.length - 2; i >= 1; i--) {
    const a = out[i - 1]!, b = out[i]!, c = out[i + 1]!;
    const straight = (Math.abs(a.x - b.x) < 1e-9 && Math.abs(b.x - c.x) < 1e-9) || (Math.abs(a.y - b.y) < 1e-9 && Math.abs(b.y - c.y) < 1e-9);
    // only merge when b lies between a and c (no fold back)
    if (straight && (b.x - a.x) * (c.x - b.x) >= 0 && (b.y - a.y) * (c.y - b.y) >= 0) out.splice(i, 1);
  }
  return out;
}

/**
 * Route from point `p` on side `sp` to point `q` on side `sq`. Parallel routes between the same states get different
 * default jogs so their movable segments do not coincide: `stagger` (centred on 0) shifts a jog that lies between the
 * ends, `lane` (0, 1·gap, 2·gap, ...) pushes a jog that goes around the ends further out. `lane` defaults to
 * `|stagger|`, which is only distinct for one-sided staggers.
 */
export function sRoute(p: Pt, sp: Side, q: Pt, sq: Side, jog?: Jog, stagger = 0, lane = Math.abs(stagger)): SRoute {
  const dp = outward(sp), dq = outward(sq);
  const result = (pts: Pt[], j: SRoute["jog"]): SRoute => ({ points: simplifyPolyline(pts), jog: j });

  if (horizontal(sp) === horizontal(sq)) {
    // Both ends horizontal (left/right) or both vertical (top/bottom). Work in "along" (a) / "across" (c) coordinates.
    const h = horizontal(sp);
    const A = (pt: Pt): number => (h ? pt.x : pt.y);
    const Cc = (pt: Pt): number => (h ? pt.y : pt.x);
    const make = (a: number, c: number): Pt => (h ? { x: a, y: c } : { x: c, y: a });
    const along: JogAxis = h ? "x" : "y";
    const across: JogAxis = h ? "y" : "x";
    if (dp === -dq) {
      const facing = dp * (A(q) - A(p)) > EPS;
      if (facing) {
        if (Math.abs(Cc(p) - Cc(q)) < EPS && !(jog && along in jog)) return result([p, q], undefined); // straight
        // the stagger must keep the jog strictly between the two ends, else the route would leave or enter backwards
        const mid = (A(p) + A(q)) / 2;
        const staggered = mid + stagger;
        const fits = (v: number): boolean => Math.min(A(p), A(q)) + 1 < v && v < Math.max(A(p), A(q)) - 1;
        const j = jogValue(jog, along, firstOk(fits, onGrid(staggered), gridOut(staggered, 1), gridOut(staggered, -1), staggered, onGrid(mid), mid));
        return result([p, make(j, Cc(p)), make(j, Cc(q)), q], { axis: along, value: j });
      }
      // facing away: leave, cross over, come back in
      const a1 = gridOut(A(p) + dp * STUB, dp), a2 = gridOut(A(q) + dq * STUB, dq);
      // cross between the ends, or around them when they are level (else the crossing would fold back)
      const level = Math.abs(Cc(p) - Cc(q)) < 2 * STUB;
      const j = jogValue(jog, across, level ? gridOut(Math.max(Cc(p), Cc(q)) + 2 * STUB + lane, 1) : onGrid((Cc(p) + Cc(q)) / 2 + stagger));
      return result([p, make(a1, Cc(p)), make(a1, j), make(a2, j), make(a2, Cc(q)), q], { axis: across, value: j });
    }
    // same side: U around both ends
    const far = dp > 0 ? Math.max(A(p), A(q)) + STUB : Math.min(A(p), A(q)) - STUB;
    const j = jogValue(jog, along, gridOut(far + dp * lane, dp));
    return result([p, make(j, Cc(p)), make(j, Cc(q)), q], { axis: along, value: j });
  }

  // Perpendicular sides. Normalise to "p leaves horizontally" by swapping axes when it leaves vertically.
  const h = horizontal(sp);
  const A = (pt: Pt): number => (h ? pt.x : pt.y); // p's leaving axis
  const Cc = (pt: Pt): number => (h ? pt.y : pt.x);
  const make = (a: number, c: number): Pt => (h ? { x: a, y: c } : { x: c, y: a });
  const ahead = dp * (A(q) - A(p)) > EPS; // q lies ahead of p
  const onOutside = dq * (Cc(p) - Cc(q)) > EPS; // p lies outside q's side
  if (ahead && onOutside) return result([p, make(A(q), Cc(p)), q], undefined); // L
  // leave p, run across to just outside q's side, then enter q; the across-run is the movable segment
  const a1 = ahead ? (A(p) + A(q)) / 2 : gridOut(A(p) + dp * STUB, dp);
  const cOut = gridOut(Cc(q) + dq * STUB, dq);
  const acrossAxis: JogAxis = h ? "y" : "x";
  if (!ahead) {
    const j = jogValue(jog, acrossAxis, gridOut(cOut + dq * lane, dq));
    return result([p, make(a1, Cc(p)), make(a1, j), make(A(q), j), q], { axis: acrossAxis, value: j });
  }
  const alongAxis: JogAxis = h ? "x" : "y";
  const staggered = a1 + stagger;
  const between = (v: number): boolean => dp * (v - A(p)) > 1 && dp * (A(q) - v) > 1;
  const j = jogValue(jog, alongAxis, firstOk(between, onGrid(staggered), gridOut(staggered, 1), gridOut(staggered, -1), staggered, onGrid(a1), a1));
  return result([p, make(j, Cc(p)), make(j, cOut), make(A(q), cOut), q], { axis: alongAxis, value: j });
}

/** Which sides an automatic end should use, from the two boxes (source a, target b). */
export function autoSides(a: Box, b: Box): [Side, Side] {
  const gapRight = b.x - (a.x + a.w), gapLeft = a.x - (b.x + b.w);
  const gapBelow = b.y - (a.y + a.h), gapAbove = a.y - (b.y + b.h);
  const best = Math.max(gapRight, gapLeft, gapBelow, gapAbove);
  if (best <= 0) return ["right", "right"]; // overlapping or nested boxes: a U on the right
  if (best === gapRight) return ["right", "left"];
  if (best === gapLeft) return ["left", "right"];
  if (best === gapBelow) return ["bottom", "top"];
  return ["top", "bottom"];
}

/** Side facing from box `a` towards point `p` (for an automatic end whose other end is pinned). */
export function sideTowards(a: Box, p: Pt, horizontalPreferred: boolean): Side {
  const cx = a.x + a.w / 2, cy = a.y + a.h / 2;
  if (horizontalPreferred) return p.x >= cx ? "right" : "left";
  return p.y >= cy ? "bottom" : "top";
}

/** The side's length on a box (where an offset is measured along). */
export function sideLength(b: Box, s: Side): number {
  return horizontal(s) ? b.h : b.w;
}

/**
 * Where an S route's label hangs: the start of its first horizontal segment that is at least 40 long (else its
 * longest horizontal segment); routes without horizontal segments use the middle of their middle segment.
 * Stored label coordinates of S routes are relative to this point.
 */
export function labelAnchor(points: Pt[]): { anchor: Pt; horizontal: boolean; length: number } {
  const segs = points.slice(1).map((b, i) => ({ a: points[i]!, b }));
  const hs = segs.filter((s) => Math.abs(s.a.y - s.b.y) < 1e-9 && Math.abs(s.a.x - s.b.x) > 1e-9);
  const pick = hs.find((s) => Math.abs(s.b.x - s.a.x) >= 40) ?? hs.sort((u, v) => Math.abs(v.b.x - v.a.x) - Math.abs(u.b.x - u.a.x))[0];
  if (pick) return { anchor: { x: Math.min(pick.a.x, pick.b.x), y: pick.a.y }, horizontal: true, length: Math.abs(pick.b.x - pick.a.x) };
  const mid = segs[Math.floor((segs.length - 1) / 2)]!;
  return { anchor: { x: (mid.a.x + mid.b.x) / 2, y: (mid.a.y + mid.b.y) / 2 }, horizontal: false, length: 0 };
}

/** Default label of an S route, relative to its anchor (the renderer draws the first line 40 below `y`). */
export function defaultLabel(points: Pt[]): { x: number; y: number; w: number } {
  const { horizontal: h, length } = labelAnchor(points);
  return h ? { x: 8, y: -46, w: Math.max(120, Math.round(length - 16)) } : { x: 10, y: -36, w: 160 };
}

/**
 * How each point of a free route moves when its start moves by `ds` and its end by `de`: both ends by the same
 * amount translates the whole route; otherwise the bend points stay where the user put them (on the grid) and only
 * the first and last segments change.
 */
function followDeltas(n: number, ds: Pt, de: Pt): Pt[] {
  const together = Math.abs(ds.x - de.x) < 1e-6 && Math.abs(ds.y - de.y) < 1e-6;
  return Array.from({ length: n }, (_, i) => (i === 0 ? ds : i === n - 1 ? de : together ? ds : { x: 0, y: 0 }));
}

/** Free routes follow their ends (see followDeltas): the route's points after its ends moved by `ds` and `de`. */
export function followPolyline(points: Pt[], ds: Pt, de: Pt): Pt[] {
  const d = followDeltas(points.length, ds, de);
  return points.map((p, i) => ({ x: p.x + d[i]!.x, y: p.y + d[i]!.y }));
}

/**
 * How far a point next to a free route (its label) moves when the route follows its ends: on the segment nearest to
 * `pt`, the blend of how that segment's two points move (a label on a bend-to-bend segment stays; one on the last
 * segment moves with the end, more the closer it is to it).
 */
export function followOffset(points: Pt[], pt: Pt, ds: Pt, de: Pt): Pt {
  if (points.length < 2) return { x: ds.x, y: ds.y };
  const d = followDeltas(points.length, ds, de);
  let best = Infinity, out: Pt = { x: ds.x, y: ds.y };
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const len = Math.hypot(b.x - a.x, b.y - a.y);
    const t = len > 0 ? Math.min(Math.max(((pt.x - a.x) * (b.x - a.x) + (pt.y - a.y) * (b.y - a.y)) / (len * len), 0), 1) : 0;
    const dist = Math.hypot(pt.x - (a.x + t * (b.x - a.x)), pt.y - (a.y + t * (b.y - a.y)));
    if (dist < best) {
      best = dist;
      const da = d[i - 1]!, db = d[i]!;
      out = { x: (1 - t) * da.x + t * db.x, y: (1 - t) * da.y + t * db.y };
    }
  }
  return out;
}
