// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Grips: what a left-button drag would do at a point. The selection shows handles (region separators, transition
 * ends, S jogs, free bend points, the bottom line of a state's action block); a single selected vertex can also be resized by any of its sides (the whole side
 * grabs, with no handle drawn) and by its corners (both ways at once). Besides those, a transition label can be
 * dragged, and a vertex moves the selection (a composite state only by its header and action block unless it is
 * selected, so a rubber band can still start inside it). The edits themselves are in @ufsm/core (v1/edit.ts).
 */
import {
  HEADER_H,
  actionBlock,
  edgeGeometry,
  regionBoxes,
  resizableEdges,
  routeInfo,
  type DocIndex,
  type Edge,
  type EdgeEndName,
  type Id,
  type Point,
  type Region,
} from "@ufsm/core";
import { drawnBox, forEachVisible, hitTest, hitTransition } from "./render";

export type Grip =
  | { kind: "move"; id: Id }
  | { kind: "resize"; id: Id; edges: Edge[] }
  | { kind: "split"; id: Id; k: number }
  | { kind: "actions"; id: Id }
  | { kind: "end"; id: Id; end: EdgeEndName; pinned: boolean }
  | { kind: "jog"; id: Id }
  | { kind: "bend"; id: Id; i: number }
  | { kind: "label"; id: Id };

export interface Handle {
  grip: Grip;
  /** World position of the handle's centre. */
  x: number;
  y: number;
  /** dot: a stored end; ring: an automatic S end (dragging pins it); square: jogs, bend points. */
  shape: "square" | "dot" | "ring" | "bar";
  /**
   * A line that can be grabbed anywhere along it (a region separator, a side of the selected vertex): its extent, along
   * x for a horizontal line at `y` (`axis` "x", the default) or along y for a vertical line at `x` (`axis` "y").
   */
  span?: [number, number];
  axis?: "x" | "y";
  /** Grabs but is not drawn: the sides and corners of the selected vertex (its outline shows the selection). */
  hidden?: true;
  cursor: string;
}

const RESIZE: { edges: Edge[]; fx: number; fy: number; cursor: string }[] = [
  { edges: ["left", "top"], fx: 0, fy: 0, cursor: "nwse-resize" },
  { edges: ["top"], fx: 0.5, fy: 0, cursor: "ns-resize" },
  { edges: ["right", "top"], fx: 1, fy: 0, cursor: "nesw-resize" },
  { edges: ["right"], fx: 1, fy: 0.5, cursor: "ew-resize" },
  { edges: ["right", "bottom"], fx: 1, fy: 1, cursor: "nwse-resize" },
  { edges: ["bottom"], fx: 0.5, fy: 1, cursor: "ns-resize" },
  { edges: ["left", "bottom"], fx: 0, fy: 1, cursor: "nesw-resize" },
  { edges: ["left"], fx: 0, fy: 0.5, cursor: "ew-resize" },
];

/** Handles of the selected elements drawn on `page`. Resize and separator handles only for a single selected vertex. */
export function handlesFor(index: DocIndex, page: Region, selection: ReadonlySet<Id>): Handle[] {
  const visible = new Set<Id>();
  forEachVisible(index, page, (v) => visible.add(v.id));
  const out: Handle[] = [];
  const vertices = [...selection].filter((id) => visible.has(id));
  if (vertices.length === 1) {
    const id = vertices[0]!;
    const v = index.vertices.get(id)!.vertex;
    const b = drawnBox(index, v);
    const allowed = new Set(resizableEdges(index, id));
    for (const r of RESIZE) {
      if (!r.edges.every((e) => allowed.has(e))) continue;
      const h: Handle = { grip: { kind: "resize", id, edges: r.edges }, x: b.x + r.fx * b.w, y: b.y + r.fy * b.h, shape: "square", hidden: true, cursor: r.cursor };
      // a side grabs along its whole length; a corner is a point (it beats the sides near it)
      if (r.edges.length === 1) Object.assign(h, r.fx === 0.5 ? { span: [b.x, b.x + b.w], axis: "x" } : { span: [b.y, b.y + b.h], axis: "y" });
      out.push(h);
    }
    if (v.kind === "state") {
      // the bottom line of the action block: drag it to hide lines, or to show them again
      const block = actionBlock(index, v);
      if (block.auto > 0 && HEADER_H + block.height < b.h) {
        out.push({ grip: { kind: "actions", id }, x: b.x + b.w / 2, y: b.y + HEADER_H + block.height, shape: "bar", span: [b.x, b.x + b.w], cursor: "ns-resize" });
      }
      const bands = regionBoxes(index, v);
      bands.slice(0, -1).forEach(({ box }, k) => {
        out.push({ grip: { kind: "split", id, k }, x: box.x + box.w / 2, y: box.y + box.h, shape: "bar", span: [box.x, box.x + box.w], cursor: "ns-resize" });
      });
    }
  }
  for (const id of selection) {
    const t = index.transitions.get(id);
    if (!t || !visible.has(t.from)) continue;
    const g = edgeGeometry(index, id);
    if (!g || g.points.length < 2) continue;
    const first = g.points[0]!, last = g.points[g.points.length - 1]!;
    const info = routeInfo(index, id);
    if (info) {
      out.push({ grip: { kind: "end", id, end: "from", pinned: info.fromPinned }, ...first, shape: info.fromPinned ? "dot" : "ring", cursor: "crosshair" });
      out.push({ grip: { kind: "end", id, end: "to", pinned: info.toPinned }, ...last, shape: info.toPinned ? "dot" : "ring", cursor: "crosshair" });
      const mid = info.jog && jogMidpoint(g.points, info.jog.axis, info.jog.value);
      if (mid) out.push({ grip: { kind: "jog", id }, ...mid, shape: "square", cursor: info.jog!.axis === "x" ? "ew-resize" : "ns-resize" });
    } else {
      out.push({ grip: { kind: "end", id, end: "from", pinned: true }, ...first, shape: "dot", cursor: "crosshair" });
      out.push({ grip: { kind: "end", id, end: "to", pinned: true }, ...last, shape: "dot", cursor: "crosshair" });
      g.points.slice(1, -1).forEach((p, i) => out.push({ grip: { kind: "bend", id, i }, x: p.x, y: p.y, shape: "square", cursor: "move" }));
    }
  }
  return out;
}

/** Middle of the route segment that is the movable one: vertical at x = value (axis x) or horizontal at y = value. */
function jogMidpoint(points: Point[], axis: "x" | "y", value: number): Point | undefined {
  for (let i = 1; i < points.length; i++) {
    const a = points[i - 1]!, b = points[i]!;
    const on = axis === "x" ? Math.abs(a.x - value) < 1e-6 && Math.abs(b.x - value) < 1e-6 : Math.abs(a.y - value) < 1e-6 && Math.abs(b.y - value) < 1e-6;
    if (on) return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }
  return undefined;
}

/** Grab radius of a handle, screen pixels. */
const GRAB_PX = 7;

/**
 * What a drag starting at world point (x, y) would grab, with the cursor that shows it. With Shift only handles
 * grab (Shift-click and Shift-drag on items toggle and add to the selection).
 */
export function gripAt(
  index: DocIndex,
  page: Region,
  selection: ReadonlySet<Id>,
  handles: readonly Handle[],
  x: number,
  y: number,
  scale: number,
  shift: boolean,
): { grip: Grip; cursor: string } | undefined {
  const r = GRAB_PX / scale;
  let best: Handle | undefined;
  let bestD = Infinity;
  for (const h of handles) {
    const [along, across] = h.axis === "y" ? [y, x - h.x] : [x, y - h.y];
    const d = h.span ? (along >= h.span[0] - r && along <= h.span[1] + r ? Math.abs(across) : Infinity) : Math.hypot(x - h.x, y - h.y);
    // point handles beat a line they sit on; a hidden corner grabs a little further out, so it is easy to hit
    const corner = h.hidden && !h.span;
    const reach = corner ? 1.5 * r : r;
    const rank = h.span ? d + r / 2 : corner ? d / 2 : d;
    if (d <= reach && rank < bestD) {
      best = h;
      bestD = rank;
    }
  }
  if (best) return { grip: best.grip, cursor: best.cursor };
  if (shift) return undefined;
  const t = hitTransition(index, page, x, y, 6 / scale);
  if (t) return t.label ? { grip: { kind: "label", id: t.id }, cursor: "move" } : undefined;
  const hit = hitTest(index, page, x, y, 6 / scale);
  if (hit.vertex && (selection.has(hit.vertex.id) || !hit.region)) return { grip: { kind: "move", id: hit.vertex.id }, cursor: "move" };
  return undefined;
}
