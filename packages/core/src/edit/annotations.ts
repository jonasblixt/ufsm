// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Edits of notes, group frames and arrows (documentation only: they change nothing but the `diagram` section).
 * Positions given here are absolute sheet coordinates, snapped to the grid and stored relative to the element's
 * region (format-v1.md). Moving, resizing and deleting vertices keeps them in step elsewhere (layout.ts, create.ts).
 */
import { ancestors, commonRegionOf, indexV1, type DocIndex } from "../model/doc-index";
import { diagramOf, keepArrowEnds, snap, topLevelVertices, moveVertices, type EdgeTargets } from "./layout";
import { regionAt } from "./create";
import { edgeGeometry, regionOrigin, type Box, type Point } from "../diagram/geometry";
import {
  MIN_FRAME,
  MIN_NOTE_H,
  MIN_NOTE_W,
  annotationBox,
  annotationKind,
  annotationSheet,
  arrowLayout,
  arrowPoints,
  attachBox,
  fractionAlong,
  frameLayout,
  noteLayout,
} from "../diagram/annotations";
import { IdAllocator, ID_PREFIX } from "../format/ids";
import type { ArrowEnd, ArrowHead, ArrowLayout, Id, Region, UfsmDocument } from "../format/model";

const ZERO: Point = { x: 0, y: 0 };

/** A note with absolute box `box` (snapped, at least the minimum size) in a region. Returns its id. */
export function addNote(
  doc: UfsmDocument,
  regionId: Id,
  box: Box,
  text = "",
  opts: { ids?: IdAllocator; todo?: boolean } = {},
): Id {
  const index = indexV1(doc);
  const region = index.regions.get(regionId)?.region;
  if (!region) throw new Error(`unknown region ${regionId}`);
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.note);
  const o = regionOrigin(index, region);
  const dia = diagramOf(doc);
  (dia.notes ??= {})[id] = {
    region: regionId,
    x: snap(box.x) - o.x,
    y: snap(box.y) - o.y,
    w: Math.max(snap(box.w), MIN_NOTE_W),
    h: Math.max(snap(box.h), MIN_NOTE_H),
    text,
    ...(opts.todo ? { todo: true as const } : {}),
  };
  return id;
}

/** A group frame with absolute box `box` (snapped, at least the minimum size) in a region. Returns its id. */
export function addFrame(
  doc: UfsmDocument,
  regionId: Id,
  box: Box,
  caption = "",
  opts: { ids?: IdAllocator } = {},
): Id {
  const index = indexV1(doc);
  const region = index.regions.get(regionId)?.region;
  if (!region) throw new Error(`unknown region ${regionId}`);
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.frame);
  const o = regionOrigin(index, region);
  const dia = diagramOf(doc);
  (dia.frames ??= {})[id] = {
    region: regionId,
    x: snap(box.x) - o.x,
    y: snap(box.y) - o.y,
    w: Math.max(snap(box.w), MIN_FRAME),
    h: Math.max(snap(box.h), MIN_FRAME),
    ...(caption ? { caption } : {}),
  };
  return id;
}

/**
 * The end an arrow gets at absolute point `p` on `target`: on a vertex, note or frame the point relative to its
 * top-left (snapped, inside the box); on a transition the fraction of its route nearest to `p`; with no target (or
 * one that does not exist) a free point relative to the origin of `region`, snapped.
 */
export function arrowEndAt(index: DocIndex, region: Region, target: Id | undefined, p: Point): ArrowEnd {
  if (target !== undefined) {
    if (index.transitions.has(target)) {
      const pts = edgeGeometry(index, target)?.points;
      if (pts && pts.length >= 2) return { ref: target, at: Math.round(fractionAlong(pts, p) * 10000) / 10000 };
    }
    const b = attachBox(index, target);
    if (b) {
      const clamp = (v: number, hi: number): number => Math.min(Math.max(v, 0), hi);
      return { ref: target, x: clamp(snap(p.x) - b.x, b.w), y: clamp(snap(p.y) - b.y, b.h) };
    }
  }
  const o = regionOrigin(index, region);
  return { x: snap(p.x) - o.x, y: snap(p.y) - o.y };
}

/** The region an arrow between absolute points `a` and `b` on `sheet` belongs to: the innermost holding both. */
export function arrowRegionAt(index: DocIndex, sheet: Region, a: Point, b: Point): Region {
  return commonRegionOf(index, regionAt(index, sheet, a), regionAt(index, sheet, b));
}

/**
 * An arrow from absolute point `from` to `to` on `sheet`, each end attached to the element given (a vertex, note,
 * frame or transition) or free when it is undefined. Returns its id.
 */
export function addArrow(
  doc: UfsmDocument,
  sheetId: Id,
  from: { target: Id | undefined; p: Point },
  to: { target: Id | undefined; p: Point },
  opts: { ids?: IdAllocator; head?: ArrowHead; dashed?: boolean } = {},
): Id {
  const index = indexV1(doc);
  const sheet = index.regions.get(sheetId)?.region;
  if (!sheet) throw new Error(`unknown region ${sheetId}`);
  const region = arrowRegionAt(index, sheet, from.p, to.p);
  const id = (opts.ids ?? new IdAllocator(doc)).take(ID_PREFIX.arrow);
  const a: ArrowLayout = {
    region: region.id,
    from: arrowEndAt(index, region, from.target, from.p),
    to: arrowEndAt(index, region, to.target, to.p),
  };
  if (opts.head && opts.head !== "end") a.head = opts.head;
  if (opts.dashed) a.dashed = true;
  (diagramOf(doc).arrows ??= {})[id] = a;
  return id;
}

/** Attach one end of an arrow at absolute point `p` to `target` (or leave it free there). */
export function setArrowEnd(doc: UfsmDocument, id: Id, which: "from" | "to", target: Id | undefined, p: Point): void {
  const index = indexV1(doc);
  const a = doc.diagram?.arrows?.[id];
  const region = a && index.regions.get(a.region)?.region;
  if (!a || !region || target === id) return;
  const end = arrowEndAt(index, region, target, p);
  if (JSON.stringify(end) !== JSON.stringify(a[which])) a[which] = end;
}

/** Notes, frames and arrows among `ids`. */
export function annotationIds(index: DocIndex, ids: Iterable<Id>): Id[] {
  return [...ids].filter((id) => annotationKind(index, id) !== undefined);
}

/** True when region `r` lies inside one of the vertices in `vertices` (it moves with them). */
function insideMoved(index: DocIndex, r: Region | undefined, vertices: ReadonlySet<Id>): boolean {
  const owner = r && index.regions.get(r.id)?.owner;
  return !!owner && (vertices.has(owner.id) || ancestors(index, owner.id).some((a) => vertices.has(a.id)));
}

/**
 * Move notes and frames, and the free ends of arrows, by (dx, dy). Annotations inside a vertex in `movedVertices`
 * are left alone (they move with it); ends attached to an element follow it anyway.
 */
export function moveAnnotations(
  doc: UfsmDocument,
  ids: Iterable<Id>,
  dx: number,
  dy: number,
  movedVertices: ReadonlySet<Id> = new Set(),
): void {
  if (dx === 0 && dy === 0) return;
  const index = indexV1(doc);
  const dia = doc.diagram;
  if (!dia) return;
  for (const id of ids) {
    const box = dia.notes?.[id] ?? dia.frames?.[id];
    const arrow = dia.arrows?.[id];
    const l = box ?? arrow;
    if (!l || insideMoved(index, index.regions.get(l.region)?.region, movedVertices)) continue;
    if (box) {
      box.x += dx;
      box.y += dy;
    } else if (arrow) {
      for (const which of ["from", "to"] as const) {
        const e = arrow[which];
        if (!("ref" in e)) arrow[which] = { x: e.x + dx, y: e.y + dy };
      }
    }
  }
}

/**
 * Put a note or frame in the region under its top-left corner (the innermost one, as when it was placed), keeping its
 * place on the sheet: dropped into a state's region it moves with that state from then on, dragged out it no longer
 * does.
 */
function settleInRegion(doc: UfsmDocument, id: Id): void {
  const l = doc.diagram?.notes?.[id] ?? doc.diagram?.frames?.[id];
  const index = indexV1(doc);
  const b = annotationBox(index, id);
  const sheet = annotationSheet(index, id);
  if (!l || !b || !sheet) return;
  const r = regionAt(index, sheet, b);
  if (r.id === l.region) return;
  const o = regionOrigin(index, r);
  l.region = r.id;
  l.x = b.x - o.x;
  l.y = b.y - o.y;
}

/** The top-left of an annotation, for snapping a drag to the grid: a box's corner or an arrow's start. */
function annotationAnchor(index: DocIndex, id: Id): Point | undefined {
  const b = annotationBox(index, id);
  if (b) return b;
  return arrowPoints(index, id)?.from;
}

/**
 * Move a selection of vertices and annotations by (dx, dy), as one drag: the delta is first adjusted so `anchor`'s
 * top-left lands on the grid, vertices stay in their bands (moveVertices limits the delta), and the annotations take
 * the delta the vertices got; a moved note or frame then belongs to the region under its top-left corner. Returns the
 * delta applied.
 */
export function moveSelection(doc: UfsmDocument, ids: Iterable<Id>, dx: number, dy: number, anchor?: Id): Point {
  const index = indexV1(doc);
  const all = [...ids];
  const vertices = topLevelVertices(index, all);
  const notes = annotationIds(index, all);
  if (anchor !== undefined && !index.vertices.has(anchor)) {
    const a = annotationAnchor(index, anchor);
    if (a) {
      dx = snap(a.x + dx) - a.x;
      dy = snap(a.y + dy) - a.y;
    }
    anchor = undefined;
  }
  if (vertices.length === 0 && notes.length === 0) return ZERO;
  const d = vertices.length ? moveVertices(doc, vertices, dx, dy, anchor) : { x: Math.round(dx), y: Math.round(dy) };
  const moved = new Set(vertices);
  moveAnnotations(doc, notes, d.x, d.y, moved);
  for (const id of notes) {
    const l = doc.diagram?.notes?.[id] ?? doc.diagram?.frames?.[id];
    if (l && !insideMoved(index, index.regions.get(l.region)?.region, moved)) settleInRegion(doc, id);
  }
  return d;
}

/**
 * Drag some edges of a note or frame to new absolute positions (snapped); it keeps its minimum size. The other edges
 * stay.
 */
export function resizeAnnotation(doc: UfsmDocument, id: Id, targets: EdgeTargets): void {
  const index = indexV1(doc);
  const l = doc.diagram?.notes?.[id] ?? doc.diagram?.frames?.[id];
  const b = annotationBox(index, id);
  if (!l || !b) return;
  const minW = doc.diagram?.notes?.[id] ? MIN_NOTE_W : MIN_FRAME;
  const minH = doc.diagram?.notes?.[id] ? MIN_NOTE_H : MIN_FRAME;
  let x0 = b.x,
    y0 = b.y,
    x1 = b.x + b.w,
    y1 = b.y + b.h;
  if (targets.left !== undefined) x0 = Math.min(snap(targets.left), x1 - minW);
  if (targets.right !== undefined) x1 = Math.max(snap(targets.right), x0 + minW);
  if (targets.top !== undefined) y0 = Math.min(snap(targets.top), y1 - minH);
  if (targets.bottom !== undefined) y1 = Math.max(snap(targets.bottom), y0 + minH);
  if (x0 === b.x && y0 === b.y && x1 === b.x + b.w && y1 === b.y + b.h) return;
  l.x += x0 - b.x;
  l.y += y0 - b.y;
  l.w = x1 - x0;
  l.h = y1 - y0;
  // ends attached to the box keep their absolute place where it still reaches
  keepArrowEnds(doc, id, x0 - b.x, y0 - b.y, l.w, l.h);
}

/** A note's text; with `h`, also its height (the editor passes what the text needs at the note's width). */
export function setNoteText(doc: UfsmDocument, id: Id, text: string, h?: number): void {
  const n = doc.diagram?.notes?.[id];
  if (!n) return;
  if (n.text !== text) n.text = text;
  if (h !== undefined) {
    const want = Math.max(snap(Math.ceil(h / 10) * 10), MIN_NOTE_H);
    if (want !== n.h) n.h = want;
  }
}

export function setNoteTodo(doc: UfsmDocument, id: Id, todo: boolean): void {
  const n = doc.diagram?.notes?.[id];
  if (!n) return;
  if (todo) n.todo = true;
  else delete n.todo;
}

export function setFrameCaption(doc: UfsmDocument, id: Id, caption: string): void {
  const f = doc.diagram?.frames?.[id];
  if (!f) return;
  if (caption) f.caption = caption;
  else delete f.caption;
}

export function setArrowHead(doc: UfsmDocument, id: Id, head: ArrowHead): void {
  const a = doc.diagram?.arrows?.[id];
  if (!a) return;
  if (head === "end") delete a.head;
  else a.head = head;
}

export function setArrowDashed(doc: UfsmDocument, id: Id, dashed: boolean): void {
  const a = doc.diagram?.arrows?.[id];
  if (!a) return;
  if (dashed) a.dashed = true;
  else delete a.dashed;
}

/** Swap an arrow's ends (the head moves to the other end). */
export function reverseArrow(doc: UfsmDocument, id: Id): void {
  const a = doc.diagram?.arrows?.[id];
  if (!a) return;
  [a.from, a.to] = [a.to, a.from];
}

/** A note's, frame's or arrow's layout, for code that handles all three. */
export function annotationLayoutOf(index: DocIndex, id: Id): { region: Id } | undefined {
  return noteLayout(index, id) ?? frameLayout(index, id) ?? arrowLayout(index, id);
}

/** Absolute box around an annotation (an arrow's ends), for fitting and placing. */
export function annotationBounds(index: DocIndex, id: Id): Box | undefined {
  const b = annotationBox(index, id);
  if (b) return b;
  const a = arrowPoints(index, id);
  if (!a) return undefined;
  const x = Math.min(a.from.x, a.to.x),
    y = Math.min(a.from.y, a.to.y);
  return { x, y, w: Math.abs(a.from.x - a.to.x), h: Math.abs(a.from.y - a.to.y) };
}
