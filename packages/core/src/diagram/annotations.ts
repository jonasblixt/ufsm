// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Notes, group frames and arrows: documentation drawn on a sheet that the machine never sees (format-v1.md,
 * "Notes, frames and arrows"). Their absolute geometry, the sheet they are drawn on, the text of a note with its
 * `{id}` references resolved, and the note's text wrapped at its width.
 *
 * A note or frame is a box relative to the origin of its region, like a vertex in that region. An arrow end is a free
 * point (relative to the arrow's region origin), a point on a vertex, note or frame (relative to the element's
 * top-left corner, kept inside its box), or a point along a transition's route (a fraction of its length).
 */
import { declName, vertexName, type DocIndex } from "../model/doc-index";
import { transitionLabel } from "../model/labels";
import type { ArrowEnd, ArrowLayout, FrameLayout, Id, NoteLayout, Region } from "../format/model";
import { edgeGeometry, regionOrigin, sheetOfRegion, vertexBox, type Box, type Point } from "./geometry";
import { LABEL_FONT_SIZE, estimateLabelWidth, type MeasureText } from "./label-layout";

/** Note text: font size (as transition labels, so the same measure serves both), line pitch, padding. */
export const NOTE_FONT_SIZE = LABEL_FONT_SIZE;
export const NOTE_LINE_H = 20;
export const NOTE_PAD = 10;
/** Size of a note's folded corner. */
export const NOTE_FOLD = 14;
/** Smallest note and frame. */
export const MIN_NOTE_W = 60;
export const MIN_NOTE_H = 40;
export const MIN_FRAME = 40;
/** Height of a frame's caption tab. */
export const FRAME_CAPTION_H = 24;
/** Size of a note placed with a click, and of a frame. */
export const NEW_NOTE_W = 200;
export const NEW_NOTE_H = 60;
export const NEW_FRAME_W = 300;
export const NEW_FRAME_H = 200;

export type AnnotationKind = "note" | "frame" | "arrow";

export function annotationKind(index: DocIndex, id: Id): AnnotationKind | undefined {
  const d = index.doc.diagram;
  if (d?.notes?.[id]) return "note";
  if (d?.frames?.[id]) return "frame";
  if (d?.arrows?.[id]) return "arrow";
  return undefined;
}

export const isAnnotation = (index: DocIndex, id: Id): boolean => annotationKind(index, id) !== undefined;

export function noteLayout(index: DocIndex, id: Id): NoteLayout | undefined {
  return index.doc.diagram?.notes?.[id];
}

export function frameLayout(index: DocIndex, id: Id): FrameLayout | undefined {
  return index.doc.diagram?.frames?.[id];
}

export function arrowLayout(index: DocIndex, id: Id): ArrowLayout | undefined {
  return index.doc.diagram?.arrows?.[id];
}

/** The region an annotation belongs to, when it exists. */
export function annotationRegion(index: DocIndex, id: Id): Region | undefined {
  const d = index.doc.diagram;
  const r = d?.notes?.[id]?.region ?? d?.frames?.[id]?.region ?? d?.arrows?.[id]?.region;
  return r === undefined ? undefined : index.regions.get(r)?.region;
}

/** The sheet an annotation is drawn on; undefined when its region does not exist. */
export function annotationSheet(index: DocIndex, id: Id): Region | undefined {
  const r = annotationRegion(index, id);
  return r && sheetOfRegion(index, r);
}

/** Absolute box of a note or frame; undefined for anything else, or when its region does not exist. */
export function annotationBox(index: DocIndex, id: Id): Box | undefined {
  const l = noteLayout(index, id) ?? frameLayout(index, id);
  const r = l && index.regions.get(l.region)?.region;
  if (!l || !r) return undefined;
  const o = regionOrigin(index, r);
  return { x: o.x + l.x, y: o.y + l.y, w: l.w, h: l.h };
}

/** Ids of the notes, frames and arrows drawn on `sheet`, each kind in document order (natural id order). */
export function annotationsOn(index: DocIndex, sheet: Region): { frames: Id[]; notes: Id[]; arrows: Id[] } {
  const on = (m: Record<Id, { region: Id }> | undefined): Id[] =>
    Object.entries(m ?? {})
      .filter(([, l]) => {
        const r = index.regions.get(l.region)?.region;
        return r !== undefined && sheetOfRegion(index, r) === sheet;
      })
      .map(([id]) => id);
  const d = index.doc.diagram;
  return { frames: on(d?.frames), notes: on(d?.notes), arrows: on(d?.arrows) };
}

// ---------------------------------------------------------------- arrows

/** Box an arrow end may attach to: a vertex, note or frame. */
export function attachBox(index: DocIndex, id: Id): Box | undefined {
  if (index.vertices.has(id)) return vertexBox(index, id);
  return annotationBox(index, id);
}

/** The sheet an element is drawn on (vertex, transition by its source, note, frame or arrow). */
export function elementSheet(index: DocIndex, id: Id): Region | undefined {
  const v = index.vertices.get(id);
  if (v) return sheetOfRegion(index, v.region);
  const t = index.transitions.get(id);
  if (t) {
    const s = index.vertices.get(t.from);
    return s && sheetOfRegion(index, s.region);
  }
  return annotationSheet(index, id);
}

/** Length of a polyline. */
function polylineLength(points: readonly Point[]): number {
  let len = 0;
  for (let i = 1; i < points.length; i++)
    len += Math.hypot(points[i]!.x - points[i - 1]!.x, points[i]!.y - points[i - 1]!.y);
  return len;
}

/** The point at fraction `at` (0..1) of a polyline's length. */
export function pointAlong(points: readonly Point[], at: number): Point {
  if (points.length === 0) return { x: 0, y: 0 };
  let left = Math.min(Math.max(at, 0), 1) * polylineLength(points);
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const seg = Math.hypot(b.x - a.x, b.y - a.y);
    if (left <= seg && seg > 0) return { x: a.x + ((b.x - a.x) * left) / seg, y: a.y + ((b.y - a.y) * left) / seg };
    left -= seg;
  }
  return { ...points[points.length - 1]! };
}

/** The fraction (0..1) of a polyline's length at its point nearest to `p`. */
export function fractionAlong(points: readonly Point[], p: Point): number {
  const total = polylineLength(points);
  if (total === 0) return 0;
  let best = Infinity,
    at = 0,
    walked = 0;
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!,
      b = points[i]!;
    const dx = b.x - a.x,
      dy = b.y - a.y;
    const len2 = dx * dx + dy * dy;
    const t = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1) : 0;
    const d = Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
    const seg = Math.sqrt(len2);
    if (d < best) {
      best = d;
      at = (walked + t * seg) / total;
    }
    walked += seg;
  }
  return at;
}

/** Absolute position of an arrow end; undefined when it refers to an element that does not exist (or has no route). */
export function arrowEndPoint(index: DocIndex, arrow: ArrowLayout, end: ArrowEnd): Point | undefined {
  if ("at" in end) {
    const pts = index.transitions.has(end.ref) ? edgeGeometry(index, end.ref)?.points : undefined;
    return pts && pts.length >= 2 ? pointAlong(pts, end.at) : undefined;
  }
  if ("ref" in end) {
    const b = attachBox(index, end.ref);
    if (!b) return undefined;
    return { x: b.x + Math.min(Math.max(end.x, 0), b.w), y: b.y + Math.min(Math.max(end.y, 0), b.h) };
  }
  const r = index.regions.get(arrow.region)?.region;
  if (!r) return undefined;
  const o = regionOrigin(index, r);
  return { x: o.x + end.x, y: o.y + end.y };
}

/** Absolute ends of an arrow; undefined when one cannot be placed. */
export function arrowPoints(index: DocIndex, id: Id): { from: Point; to: Point } | undefined {
  const a = arrowLayout(index, id);
  if (!a || !index.regions.has(a.region)) return undefined;
  const from = arrowEndPoint(index, a, a.from),
    to = arrowEndPoint(index, a, a.to);
  return from && to ? { from, to } : undefined;
}

/** The element an arrow end is attached to, or undefined for a free end. */
export const arrowEndRef = (end: ArrowEnd): Id | undefined => ("ref" in end ? end.ref : undefined);

// ---------------------------------------------------------------- note text

/** `{id}` references in a note's text: where each one is and the id it names. */
export function noteRefs(text: string): { id: Id; start: number; end: number }[] {
  const out: { id: Id; start: number; end: number }[] = [];
  for (const m of text.matchAll(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g))
    out.push({ id: m[1]!, start: m.index, end: m.index + m[0].length });
  return out;
}

/**
 * What a reference to `id` shows: a vertex's or region's name, a declaration's or timer's name, a transition's label,
 * a frame's caption; undefined when no element has the id.
 */
export function referenceName(index: DocIndex, id: Id): string | undefined {
  if (index.vertices.has(id)) return vertexName(index, id);
  if (index.decls.has(id)) return declName(index, id);
  const r = index.regions.get(id);
  if (r) return r.region.name ?? id;
  const t = index.transitions.get(id);
  if (t) return transitionLabel(index, t);
  const tm = index.timers.get(id);
  if (tm) return tm.timer.name;
  const f = frameLayout(index, id);
  if (f) return f.caption ?? id;
  return undefined;
}

/** A note's text as drawn: every `{id}` of an existing element replaced by its name, others left as written. */
export function noteDisplayText(index: DocIndex, text: string): string {
  return text.replace(/\{([A-Za-z_][A-Za-z0-9_.-]*)\}/g, (all, id: string) => referenceName(index, id) ?? all);
}

/**
 * Lines of a note's text wrapped at width `w` (inside the padding): at spaces where possible, inside a word that is
 * longer than a line. Explicit line breaks are kept.
 */
export function wrapNoteText(text: string, w: number, measure: MeasureText = estimateLabelWidth): string[] {
  const room = Math.max(w - 2 * NOTE_PAD - NOTE_FOLD / 2, 10);
  const lines: string[] = [];
  for (const para of text.split("\n")) {
    const words = para.split(" ");
    let line = "";
    for (const word of words) {
      const next = line ? `${line} ${word}` : word;
      if (measure(next) <= room || !line) {
        line = next;
      } else {
        lines.push(line);
        line = word;
      }
      // a word longer than a line breaks where it must
      while (measure(line) > room && line.length > 1) {
        let k = line.length - 1;
        while (k > 1 && measure(line.slice(0, k)) > room) k--;
        lines.push(line.slice(0, k));
        line = line.slice(k);
      }
    }
    lines.push(line);
  }
  return lines;
}

/** Height a note needs to show every line of `text` at width `w`. */
export function noteHeightFor(text: string, w: number, measure: MeasureText = estimateLabelWidth): number {
  return Math.max(MIN_NOTE_H, 2 * NOTE_PAD + wrapNoteText(text, w, measure).length * NOTE_LINE_H);
}
