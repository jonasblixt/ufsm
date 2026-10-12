// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Queries over what a sheet shows, for the interaction code: what is drawn on a sheet, what is under a point, what a
 * rubber band picks, the bounds to fit. No DOM: label widths come from a measure the caller passes (render.ts has the
 * canvas's), so these run in node:test too.
 */
import type { DocIndex, Region, State, Transition, Vertex } from "@ufsm/core";
import {
  FRAME_CAPTION_H,
  actionBlock,
  annotationBox,
  annotationsOn,
  arrowPoints,
  edgeGeometry,
  estimateLabelWidth,
  isOffPage,
  regionBoxes,
  segmentDistance,
  stateLayout,
  transitionLabelBox,
  vertexBox,
  type Box,
  type MeasureText,
} from "@ufsm/core/diagram";

/** The canvas transform: screen = world * scale + (x, y). */
export interface View {
  scale: number;
  x: number;
  y: number;
}

export interface Bounds {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

/** Visit every vertex drawn on a sheet (off-page region contents are skipped), parents first. */
export function forEachVisible(index: DocIndex, sheet: Region, fn: (v: Vertex) => void): void {
  const visit = (r: Region): void => {
    for (const v of r.states) {
      fn(v);
      if (v.kind === "state") for (const child of v.regions ?? []) if (!isOffPage(index, child.id)) visit(child);
    }
  };
  visit(sheet);
}

/** Transitions whose source is drawn on the sheet. */
export function forEachVisibleTransition(index: DocIndex, sheet: Region, fn: (t: Transition) => void): void {
  forEachVisible(index, sheet, (v) => index.outgoing.get(v.id)?.forEach(fn));
}

export interface Hit {
  /** Innermost vertex under the point. */
  vertex?: Vertex;
  /** Region of that vertex under the point, if it is a state with regions. */
  region?: Region;
}

function inside(b: Box, x: number, y: number): boolean {
  return x >= b.x && x <= b.x + b.w && y >= b.y && y <= b.y + b.h;
}

/** The box a vertex is actually drawn in (fork/join bars are thinner than their nominal size). */
export function drawnBox(index: DocIndex, v: Vertex): Box {
  const b = vertexBox(index, v.id);
  if (v.kind === "fork" || v.kind === "join") {
    return stateLayout(index, v.id).orientation === "horizontal" ? { ...b, h: 10 } : { ...b, w: 10 };
  }
  return b;
}

function grow(b: Box, by: number): Box {
  return { x: b.x - by, y: b.y - by, w: b.w + 2 * by, h: b.h + 2 * by };
}

/**
 * What is under world point (x, y) on `sheet`. The last drawn vertex wins,
 * which is also the most deeply nested one. `slop` widens small targets.
 */
export function hitTest(index: DocIndex, sheet: Region, x: number, y: number, slop = 4): Hit {
  const hit: Hit = {};
  forEachVisible(index, sheet, (v) => {
    const b = drawnBox(index, v);
    if (inside(v.kind === "state" ? b : grow(b, slop), x, y)) hit.vertex = v;
  });
  const v = hit.vertex;
  if (v?.kind === "state") {
    const r = regionBoxes(index, v).find((rb) => inside(rb.box, x, y));
    if (r) hit.region = r.region;
  }
  return hit;
}

/**
 * How a selection rectangle picks elements, as in CAD tools:
 * `enclosed` (dragged to the right) takes what lies completely inside;
 * `touching` (dragged to the left) also takes what it crosses.
 */
export type BoxMode = "enclosed" | "touching";

function overlaps(a: Bounds, b: Box): boolean {
  return b.x <= a.x1 && b.x + b.w >= a.x0 && b.y <= a.y1 && b.y + b.h >= a.y0;
}

function contains(a: Bounds, b: Box): boolean {
  return b.x >= a.x0 && b.x + b.w <= a.x1 && b.y >= a.y0 && b.y + b.h <= a.y1;
}

function pointIn(a: Bounds, p: { x: number; y: number }): boolean {
  return p.x >= a.x0 && p.x <= a.x1 && p.y >= a.y0 && p.y <= a.y1;
}

/** Does segment p-q cross rectangle r? (Liang-Barsky clipping.) */
function segmentHits(r: Bounds, p: { x: number; y: number }, q: { x: number; y: number }): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [pk, qk] of [
    [-dx, p.x - r.x0],
    [dx, r.x1 - p.x],
    [-dy, p.y - r.y0],
    [dy, r.y1 - p.y],
  ] as const) {
    if (pk === 0) {
      if (qk < 0) return false;
    } else {
      const t = qk / pk;
      if (pk < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 > t1) return false;
    }
  }
  return true;
}

/**
 * Ids of the vertices and transitions on `sheet` picked by world rectangle
 * `r`, at every nesting level. A transition is enclosed when both its ends
 * are inside. In `touching` mode a state that contains the whole rectangle
 * is not picked (dragging inside a composite should not select it).
 */
export function boxSelect(index: DocIndex, sheet: Region, r: Bounds, mode: BoxMode): string[] {
  const ids: string[] = [];
  forEachVisible(index, sheet, (v) => {
    const b = drawnBox(index, v);
    const encloses = b.x <= r.x0 && b.y <= r.y0 && b.x + b.w >= r.x1 && b.y + b.h >= r.y1;
    if (contains(r, b) || (mode === "touching" && overlaps(r, b) && !encloses)) ids.push(v.id);
  });
  forEachVisibleTransition(index, sheet, (t) => {
    const pts = edgeGeometry(index, t.id)?.points;
    if (!pts || pts.length < 2) return;
    const picked =
      mode === "enclosed"
        ? pointIn(r, pts[0]!) && pointIn(r, pts[pts.length - 1]!)
        : pts.some((p, i) => i > 0 && segmentHits(r, pts[i - 1]!, p));
    if (picked) ids.push(t.id);
  });
  const on = annotationsOn(index, sheet);
  for (const id of [...on.frames, ...on.notes]) {
    const b = annotationBox(index, id);
    if (
      b &&
      (contains(r, b) ||
        (mode === "touching" &&
          overlaps(r, b) &&
          !(b.x <= r.x0 && b.y <= r.y0 && b.x + b.w >= r.x1 && b.y + b.h >= r.y1)))
    )
      ids.push(id);
  }
  for (const id of on.arrows) {
    const a = arrowPoints(index, id);
    if (!a) continue;
    if (mode === "enclosed" ? pointIn(r, a.from) && pointIn(r, a.to) : segmentHits(r, a.from, a.to)) ids.push(id);
  }
  return ids;
}

/**
 * What an arrow end at world point (x, y) on `sheet` attaches to: a note, a transition (its line or label), the
 * innermost vertex or a group frame (anywhere inside it) drawn over it, else nothing (a free end). `exclude` is never
 * picked.
 */
export function arrowTargetAt(
  index: DocIndex,
  sheet: Region,
  x: number,
  y: number,
  slop: number,
  measure: MeasureText = estimateLabelWidth,
  exclude?: string,
): string | undefined {
  const on = annotationsOn(index, sheet);
  for (const id of [...on.notes].reverse()) {
    const b = annotationBox(index, id);
    if (id !== exclude && b && inside(b, x, y)) return id;
  }
  const t = hitTransition(index, sheet, x, y, slop, measure);
  if (t) return t.id;
  const v = hitTest(index, sheet, x, y, slop).vertex;
  for (const id of [...on.frames].reverse()) {
    const b = annotationBox(index, id);
    if (id !== exclude && b && inside(grow(b, slop), x, y) && frameOver(index, id, v)) return id;
  }
  return v?.id;
}

/**
 * Is the frame `id` drawn over vertex `v`? A frame is drawn behind the vertices of its own region but over the states
 * that hold that region, so the state around a frame never hides it. Without `v` (nothing there) it is.
 */
function frameOver(index: DocIndex, id: string, v: Vertex | undefined): boolean {
  if (!v) return true;
  let r = index.regions.get(index.doc.diagram?.frames?.[id]?.region ?? "")?.region;
  while (r) {
    const owner = index.regions.get(r.id)?.owner;
    if (!owner) return false;
    if (owner.id === v.id) return true;
    r = index.vertices.get(owner.id)?.region;
  }
  return false;
}

/** Width of a frame's caption tab, for hit testing (the renderer draws it this wide). */
export const frameCaptionWidth = (caption: string, measure: MeasureText = estimateLabelWidth): number =>
  measure(caption) + 20;

/**
 * The note or arrow at world point (x, y) on `sheet` (`layer` "top": they are drawn over everything, the last drawn
 * wins), or the group frame whose outline or caption tab is there (`layer` "frames": a frame is drawn behind the
 * states of its region, and its inside belongs to what is in it). `under` is the vertex at the point (hitTest): only a
 * frame drawn over it counts, so a frame in a state's region wins over that state.
 */
export function hitAnnotation(
  index: DocIndex,
  sheet: Region,
  x: number,
  y: number,
  slop: number,
  layer: "top" | "frames",
  measure: MeasureText = estimateLabelWidth,
  under?: Vertex,
): string | undefined {
  const on = annotationsOn(index, sheet);
  if (layer === "top") {
    for (const id of [...on.arrows].reverse()) {
      const a = arrowPoints(index, id);
      if (a && segmentDistance({ x, y }, a.from, a.to) <= slop) return id;
    }
    for (const id of [...on.notes].reverse()) {
      const b = annotationBox(index, id);
      if (b && inside(b, x, y)) return id;
    }
    return undefined;
  }
  for (const id of [...on.frames].reverse()) {
    const b = annotationBox(index, id);
    if (!b || !frameOver(index, id, under)) continue;
    const caption = index.doc.diagram?.frames?.[id]?.caption;
    if (caption && inside({ x: b.x, y: b.y, w: frameCaptionWidth(caption, measure), h: FRAME_CAPTION_H }, x, y))
      return id;
    const near = inside(grow(b, slop), x, y) && !inside(grow(b, -slop), x, y);
    if (near) return id;
  }
  return undefined;
}

export function vertexBounds(index: DocIndex, id: string): Bounds {
  const b = vertexBox(index, id);
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

/** Content bounds of one sheet. */
export function sheetBounds(index: DocIndex, sheet: Region): Bounds | undefined {
  let b: Bounds | undefined;
  const add = (x: number, y: number, w: number, h: number): void => {
    if (!b) b = { x0: x, y0: y, x1: x + w, y1: y + h };
    else {
      b.x0 = Math.min(b.x0, x);
      b.y0 = Math.min(b.y0, y);
      b.x1 = Math.max(b.x1, x + w);
      b.y1 = Math.max(b.y1, y + h);
    }
  };
  forEachVisible(index, sheet, (v) => {
    const vb = vertexBox(index, v.id);
    add(vb.x, vb.y, vb.w, vb.h);
  });
  forEachVisibleTransition(index, sheet, (t) => {
    const g = edgeGeometry(index, t.id);
    if (!g) return;
    g.points.forEach((p) => add(p.x, p.y, 0, 0));
    if (g.label) add(g.label.x, g.label.y, g.label.w, 60);
  });
  const on = annotationsOn(index, sheet);
  for (const id of [...on.frames, ...on.notes]) {
    const ab = annotationBox(index, id);
    if (ab) add(ab.x, ab.y, ab.w, ab.h);
  }
  for (const id of on.arrows) {
    const a = arrowPoints(index, id);
    if (a) [a.from, a.to].forEach((p) => add(p.x, p.y, 0, 0));
  }
  return b;
}

/** The state whose hidden-lines marker is at world point (x, y) on `sheet` (a click on it shows every line again). */
export function hiddenMarkerAt(index: DocIndex, sheet: Region, x: number, y: number): State | undefined {
  let found: State | undefined;
  forEachVisible(index, sheet, (v) => {
    if (v.kind !== "state") return;
    const marker = actionBlock(index, v).hiddenMarker;
    if (!marker) return;
    const b = vertexBox(index, v.id);
    if (x >= b.x + marker.x && x <= b.x + marker.x + marker.w && y >= b.y + marker.y && y <= b.y + marker.y + marker.h)
      found = v;
  });
  return found;
}

/** Label boxes per measure and document version (an index is rebuilt after every edit), so hovering does not measure text. */
const labelBoxes = new WeakMap<MeasureText, WeakMap<DocIndex, Map<string, Box | undefined>>>();

/** Box of a transition's label text, for hit testing; undefined when it has no label. */
export function labelBox(index: DocIndex, t: Transition, measure: MeasureText = estimateLabelWidth): Box | undefined {
  let byIndex = labelBoxes.get(measure);
  if (!byIndex) labelBoxes.set(measure, (byIndex = new WeakMap()));
  let cache = byIndex.get(index);
  if (!cache) byIndex.set(index, (cache = new Map()));
  if (cache.has(t.id)) return cache.get(t.id);
  const box = transitionLabelBox(index, t, measure);
  cache.set(t.id, box);
  return box;
}

/**
 * The transition on `sheet` under world point (x, y): its label, or its line within `slop`. A label wins over a line,
 * and the nearest line over farther ones. `measure` gives label widths (the editor passes its canvas's).
 */
export function hitTransition(
  index: DocIndex,
  sheet: Region,
  x: number,
  y: number,
  slop = 4,
  measure: MeasureText = estimateLabelWidth,
): { id: string; label: boolean } | undefined {
  let best: { id: string; label: boolean; d: number } | undefined;
  forEachVisibleTransition(index, sheet, (t) => {
    const lb = labelBox(index, t, measure);
    if (lb && inside(lb, x, y)) {
      if (!best || !best.label) best = { id: t.id, label: true, d: 0 };
      return;
    }
    if (best?.label) return;
    const pts = edgeGeometry(index, t.id)?.points ?? [];
    for (let i = 1; i < pts.length; i++) {
      const d = segmentDistance({ x, y }, pts[i - 1]!, pts[i]!);
      if (d <= slop && (!best || d < best.d)) best = { id: t.id, label: false, d };
    }
  });
  return best && { id: best.id, label: best.label };
}
