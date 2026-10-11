// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Canvas renderer for v1 documents. Drawing rules follow the old GTK editor
 * (old/compose/src/render.c) so existing diagrams look the same; geometry
 * comes from @ufsm/core (relative layout -> absolute sheet coordinates).
 */
import {
  ACTION_CHAR_W,
  ACTION_ICON,
  ACTION_ICON_GAP,
  ACTION_LINE_H,
  ACTION_MARGIN,
  ACTION_PAD,
  ACTION_PILL_ICON,
  HEADER_H,
  TITLE_CAPTION_SIZE,
  actionBlock,
  actionLabel,
  edgeGeometry,
  guardLabel,
  isOffPage,
  paperOf,
  regionBoxes,
  sheetFrame,
  sheetInfo,
  stateLayout,
  titleBlockCells,
  triggerLabel,
  vertexBox,
  zoneRowLabel,
  type ActionBlock,
  type ActionPill,
  type ActionSegment,
  type Box,
  type DocIndex,
  type Region,
  type State,
  type Transition,
  type Vertex,
} from "@ufsm/core";
import type { Handle } from "./handles";
import { drawIcon } from "./icons";
import { C, canvasAlpha } from "./theme";

/** Diagram colors come from the active theme (theme.ts); re-exported for the previews. */
export { C };

const FONT = "sans-serif";

/** Opacity of the active color over an innermost active state's fill (simulator). */
export const ACTIVE_FILL_ALPHA = 0.13;

/** screen = world * scale + (x, y) */
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

/** Visit every vertex drawn on a page (off-page region contents are skipped), parents first. */
export function forEachVisible(index: DocIndex, page: Region, fn: (v: Vertex) => void): void {
  const visit = (r: Region): void => {
    for (const v of r.states) {
      fn(v);
      if (v.kind === "state") for (const child of v.regions ?? []) if (!isOffPage(index, child.id)) visit(child);
    }
  };
  visit(page);
}

/** Transitions whose source is drawn on the page. */
export function forEachVisibleTransition(index: DocIndex, page: Region, fn: (t: Transition) => void): void {
  forEachVisible(index, page, (v) => index.outgoing.get(v.id)?.forEach(fn));
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
 * What is under world point (x, y) on `page`. The last drawn vertex wins,
 * which is also the most deeply nested one. `slop` widens small targets.
 */
export function hitTest(index: DocIndex, page: Region, x: number, y: number, slop = 4): Hit {
  const hit: Hit = {};
  forEachVisible(index, page, (v) => {
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
 * Ids of the vertices and transitions on `page` picked by world rectangle
 * `r`, at every nesting level. A transition is enclosed when both its ends
 * are inside. In `touching` mode a state that contains the whole rectangle
 * is not picked (dragging inside a composite should not select it).
 */
export function boxSelect(index: DocIndex, page: Region, r: Bounds, mode: BoxMode): string[] {
  const ids: string[] = [];
  forEachVisible(index, page, (v) => {
    const b = drawnBox(index, v);
    const encloses = b.x <= r.x0 && b.y <= r.y0 && b.x + b.w >= r.x1 && b.y + b.h >= r.y1;
    if (contains(r, b) || (mode === "touching" && overlaps(r, b) && !encloses)) ids.push(v.id);
  });
  forEachVisibleTransition(index, page, (t) => {
    const pts = edgeGeometry(index, t.id)?.points;
    if (!pts || pts.length < 2) return;
    const picked =
      mode === "enclosed"
        ? pointIn(r, pts[0]!) && pointIn(r, pts[pts.length - 1]!)
        : pts.some((p, i) => i > 0 && segmentHits(r, pts[i - 1]!, p));
    if (picked) ids.push(t.id);
  });
  return ids;
}

export function vertexBounds(index: DocIndex, id: string): Bounds {
  const b = vertexBox(index, id);
  return { x0: b.x, y0: b.y, x1: b.x + b.w, y1: b.y + b.h };
}

/** Content bounds of one page. */
export function pageBounds(index: DocIndex, page: Region): Bounds | undefined {
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
  forEachVisible(index, page, (v) => {
    const vb = vertexBox(index, v.id);
    add(vb.x, vb.y, vb.w, vb.h);
  });
  forEachVisibleTransition(index, page, (t) => {
    const g = edgeGeometry(index, t.id);
    if (!g) return;
    g.points.forEach((p) => add(p.x, p.y, 0, 0));
    if (g.label) add(g.label.x, g.label.y, g.label.w, 60);
  });
  return b;
}

/** Manual rounded rect: ctx.roundRect() needs Safari 16, macOS 12's WKWebView is Safari 15. */
function roundedRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

/** How the simulator shows a vertex: active, and innermost active (filled). */
type SimLook = "leaf" | "active" | undefined;

/** Outline color and width of a vertex: the selection color when selected (as the old editor did), else the simulator's. */
function outlineStyle(look: SimLook, selected: boolean): { color: string; width: number } {
  if (selected) return { color: C.selection, width: 3 };
  return look ? { color: C.active, width: 3 } : { color: C.ink, width: 2 };
}

/** Clip to the intersection of the current clip and a rectangle (callers save/restore around it). */
function clipRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.beginPath();
  ctx.rect(x, y, Math.max(w, 0), Math.max(h, 0));
  ctx.clip();
}

/** Fixed-width font of the action block. */
const MONO = 'ui-monospace, "Cascadia Mono", Consolas, Menlo, "DejaVu Sans Mono", monospace';
let blockFontCss: string | undefined;

/**
 * The action block's font at the size where one character is exactly ACTION_CHAR_W wide, so the text takes the room
 * core's layout gave it whatever monospace font the platform has (about 11.7 px for a 0.6 em font).
 */
function blockFont(ctx: CanvasRenderingContext2D): string {
  if (!blockFontCss) {
    ctx.font = `100px ${MONO}`;
    const advance = ctx.measureText("0").width / 100;
    const size = advance > 0.3 && advance < 1 ? ACTION_CHAR_W / advance : 11.7;
    blockFontCss = `${Math.round(size * 100) / 100}px ${MONO}`;
  }
  return blockFontCss;
}

/** Opacity of the icons and marks of the action block (the text is full ink). */
const BLOCK_ICON_ALPHA = 0.75;

/** Lines of a state's action block (or its one-line summary); (x, top) is the block's top-left corner. */
function drawActionBlock(ctx: CanvasRenderingContext2D, block: ActionBlock, x: number, top: number): void {
  if (block.height === 0) return;
  ctx.fillStyle = C.ink;
  ctx.strokeStyle = canvasAlpha("ink", BLOCK_ICON_ALPHA);
  ctx.font = blockFont(ctx);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  const segment = (g: ActionSegment, yc: number, tail = ""): void => {
    if (g.icon) drawIcon(ctx, g.icon, x + g.x, yc - ACTION_ICON / 2, ACTION_ICON);
    ctx.fillText(g.text + tail, x + g.x + (g.icon ? ACTION_ICON + ACTION_ICON_GAP : 0), yc + 1);
  };
  const centre = (i: number): number => top + ACTION_PAD / 2 + ACTION_LINE_H * (i + 0.5);
  if (block.summary) {
    drawIcon(ctx, "chevron-right", x + ACTION_MARGIN, centre(0) - ACTION_ICON / 2, ACTION_ICON);
    for (const g of block.summaryRow) segment(g, centre(0));
    return;
  }
  block.rows.slice(0, block.visible).forEach((row, i) => {
    const last = block.cut && i === block.visible - 1;
    row.segments.forEach((g, k) => segment(g, centre(i), last && k === row.segments.length - 1 ? " \u2026" : ""));
  });
}

/** The marker for hidden lines on the block's bottom line; (x, y) is the state's top-left corner. */
function drawPill(ctx: CanvasRenderingContext2D, pill: ActionPill, x: number, y: number): void {
  const px = x + pill.x, py = y + pill.y, yc = py + pill.h / 2;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.stateFill;
  roundedRect(ctx, px, py, pill.w, pill.h, pill.h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = canvasAlpha("ink", BLOCK_ICON_ALPHA);
  ctx.fillStyle = C.ink;
  ctx.font = blockFont(ctx);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  drawIcon(ctx, "chevron-down", px + 5, yc - ACTION_PILL_ICON / 2, ACTION_PILL_ICON);
  for (const p of pill.parts) {
    if (p.icon) drawIcon(ctx, p.icon, px + p.x, yc - ACTION_PILL_ICON / 2, ACTION_PILL_ICON);
    ctx.fillText(p.text, px + p.x + (p.icon ? ACTION_PILL_ICON + 1 : 0), yc + 1);
  }
  ctx.restore();
}

/** The state whose hidden-lines marker is at world point (x, y) on `page` (a click on it shows every line again). */
export function pillAt(index: DocIndex, page: Region, x: number, y: number): State | undefined {
  let found: State | undefined;
  forEachVisible(index, page, (v) => {
    if (v.kind !== "state") return;
    const pill = actionBlock(index, v).pill;
    if (!pill) return;
    const b = vertexBox(index, v.id);
    if (x >= b.x + pill.x && x <= b.x + pill.x + pill.w && y >= b.y + pill.y && y <= b.y + pill.y + pill.h) found = v;
  });
  return found;
}

function drawState(ctx: CanvasRenderingContext2D, index: DocIndex, s: State, look: SimLook, selected: boolean): void {
  const { x, y, w, h } = vertexBox(index, s.id);
  const outline = outlineStyle(look, selected);
  ctx.lineWidth = outline.width;
  ctx.strokeStyle = outline.color;
  ctx.fillStyle = C.stateFill;
  roundedRect(ctx, x, y, w, h, 10);
  ctx.fill();
  if (look === "leaf") {
    // Innermost active state: a faint wash of the active color over the fill.
    ctx.fillStyle = canvasAlpha("active", ACTIVE_FILL_ALPHA);
    ctx.fill();
  }
  ctx.stroke();

  // Every text stays inside the state (a state can be drawn smaller than its text): the name inside the header, the
  // action lines inside the action block, a region's name inside its band; all of them inside the outline.
  ctx.save();
  clipRect(ctx, x + 2, y + 2, w - 4, h - 4);

  // Name, centred in the header; left-aligned when too wide.
  ctx.save();
  clipRect(ctx, x + 2, y + 2, w - 4, HEADER_H - 2);
  ctx.fillStyle = C.ink;
  ctx.font = `18px ${FONT}`;
  ctx.textBaseline = "middle";
  const tw = ctx.measureText(s.name).width;
  if (tw < w - 4) {
    ctx.textAlign = "center";
    ctx.fillText(s.name, x + w / 2, y + 15);
  } else {
    ctx.textAlign = "left";
    ctx.fillText(s.name, x + 10, y + 15);
  }
  ctx.restore();

  const block = actionBlock(index, s);
  ctx.save();
  clipRect(ctx, x + 2, y + HEADER_H, w - 4, block.height);
  drawActionBlock(ctx, block, x, y + HEADER_H);
  ctx.restore();
  ctx.restore();

  ctx.lineWidth = 2;
  ctx.strokeStyle = C.ink;
  ctx.beginPath();
  if (block.height > 0 && HEADER_H < h) {
    ctx.moveTo(x, y + HEADER_H);
    ctx.lineTo(x + w, y + HEADER_H);
  }
  // The block's bottom line: above the regions, and under a block that hides lines (its marker sits on it).
  if ((s.regions?.length || block.limited) && HEADER_H + block.height < h) {
    ctx.moveTo(x, y + HEADER_H + block.height);
    ctx.lineTo(x + w, y + HEADER_H + block.height);
  }
  ctx.stroke();
  if (block.pill && HEADER_H + block.height < h) drawPill(ctx, block.pill, x, y);

  // Region bands: name, dashed separator between bands, off-page marker.
  const bands = regionBoxes(index, s);
  bands.forEach(({ region, box }, i) => {
    ctx.fillStyle = C.ink;
    ctx.font = `18px ${FONT}`;
    if (region.name) {
      ctx.save();
      clipRect(ctx, Math.max(box.x, x) + 2, Math.max(box.y, y), Math.min(box.x + box.w, x + w) - Math.max(box.x, x) - 4, Math.min(box.y + box.h, y + h - 2) - Math.max(box.y, y));
      ctx.fillText(region.name, box.x + 10, box.y + 25);
      ctx.restore();
    }
    if (i < bands.length - 1) {
      ctx.save();
      ctx.setLineDash([10, 10]);
      ctx.beginPath();
      ctx.moveTo(box.x, box.y + box.h);
      ctx.lineTo(box.x + box.w, box.y + box.h);
      ctx.stroke();
      ctx.restore();
    }
    if (isOffPage(index, region.id)) {
      const sx = box.x + box.w - 50;
      const sy = box.y + box.h - 20;
      ctx.beginPath();
      ctx.arc(sx, sy, 5, 0, 2 * Math.PI);
      ctx.arc(sx + 20, sy, 5, 0, 2 * Math.PI);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(sx, sy);
      ctx.lineTo(sx + 20, sy);
      ctx.stroke();
      // The sheet it continues on, as the title block numbers it.
      ctx.save();
      ctx.font = `14px ${FONT}`;
      ctx.textAlign = "right";
      ctx.textBaseline = "middle";
      ctx.fillText(`sheet ${sheetInfo(index, region).number}`, sx - 12, sy + 1);
      ctx.restore();
    }
  });
}

function drawPseudo(ctx: CanvasRenderingContext2D, index: DocIndex, v: Vertex, look: SimLook, selected: boolean): void {
  const { x, y, w, h } = vertexBox(index, v.id);
  const cx = x + w / 2;
  const cy = y + h / 2;
  const outline = outlineStyle(look, selected);
  ctx.lineWidth = outline.width;
  ctx.strokeStyle = outline.color;
  ctx.fillStyle = outline.color;

  switch (v.kind) {
    case "initial":
      ctx.beginPath();
      ctx.arc(cx, cy, w / 2, 0, 2 * Math.PI);
      ctx.fill();
      break;
    case "final":
      ctx.beginPath();
      ctx.arc(cx, cy, w / 2, 0, 2 * Math.PI);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(cx, cy, w / 2 - 4, 0, 2 * Math.PI);
      ctx.fill();
      break;
    case "shallow-history":
    case "deep-history":
      ctx.fillStyle = C.stateFill;
      ctx.beginPath();
      ctx.arc(cx, cy, w / 2, 0, 2 * Math.PI);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = selected ? C.selection : C.ink;
      ctx.font = `bold ${Math.round(w * 0.5)}px ${FONT}`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(v.kind === "deep-history" ? "H*" : "H", cx, cy + 1);
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      break;
    case "terminate":
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + w, y + h);
      ctx.moveTo(x + w, y);
      ctx.lineTo(x, y + h);
      ctx.stroke();
      break;
    case "fork":
    case "join": {
      const b = drawnBox(index, v);
      ctx.beginPath();
      ctx.rect(b.x, b.y, b.w, b.h);
      ctx.fill();
      break;
    }
    case "state":
      break;
  }
}

/** Label pieces with the old editor's bracket and comma rules. */
function labelItems(index: DocIndex, t: Transition): string[] {
  const items = [triggerLabel(index, t)];
  const g = (t.guard ?? []).map((x) => guardLabel(index, x));
  g.forEach((txt, i) => items.push(`${i === 0 ? "[" : ""}${txt}${i === g.length - 1 ? "]" : ", "}`));
  const a = (t.do ?? []).map((x) => actionLabel(index, x));
  a.forEach((txt, i) => items.push(`${i === 0 ? " / " : ""}${txt}${i === a.length - 1 ? "" : ", "}`));
  return items;
}

interface LabelLayout {
  items: { text: string; x: number; y: number }[];
  /** Where the text is drawn (from the top of the first line to the bottom of the last). */
  box: Box;
}

/** Lay out a transition's label in the old editor's way: items wrap at the label width, 20 units per line. */
function layoutLabel(ctx: CanvasRenderingContext2D, index: DocIndex, t: Transition, tb: { x: number; y: number; w: number }): LabelLayout {
  ctx.font = `14px ${FONT}`;
  let x = tb.x;
  let line = 0;
  let space = tb.w;
  let right = tb.x;
  const items = labelItems(index, t).map((text, i) => {
    const w = ctx.measureText(text).width;
    if (i > 0) {
      space -= w + 10;
      if (space < 10) {
        line++;
        space = tb.w;
        x = tb.x;
      }
    } else {
      space -= w;
    }
    const item = { text, x, y: tb.y + 40 + 20 * line };
    right = Math.max(right, x + w);
    x += w + 10;
    return item;
  });
  return { items, box: { x: tb.x, y: tb.y + 26, w: Math.max(right - tb.x, 10), h: 20 * line + 20 } };
}

let measureCtx: CanvasRenderingContext2D | undefined;
/** Label boxes per document version (an index is rebuilt after every edit), so hovering does not measure text. */
const labelBoxes = new WeakMap<DocIndex, Map<string, Box | undefined>>();

/** Box of a transition's label text, for hit testing; undefined when it has no label. */
export function labelBox(index: DocIndex, t: Transition): Box | undefined {
  let cache = labelBoxes.get(index);
  if (!cache) labelBoxes.set(index, (cache = new Map()));
  if (cache.has(t.id)) return cache.get(t.id);
  const label = edgeGeometry(index, t.id)?.label;
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  const box = label && layoutLabel(measureCtx, index, t, label).box;
  cache.set(t.id, box);
  return box;
}

function segmentDistance(p: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }): number {
  const dx = b.x - a.x, dy = b.y - a.y;
  const len2 = dx * dx + dy * dy;
  const u = len2 > 0 ? Math.min(Math.max(((p.x - a.x) * dx + (p.y - a.y) * dy) / len2, 0), 1) : 0;
  return Math.hypot(p.x - a.x - u * dx, p.y - a.y - u * dy);
}

/**
 * The transition on `page` under world point (x, y): its label, or its line within `slop`. A label wins over a line,
 * and the nearest line over farther ones.
 */
export function hitTransition(index: DocIndex, page: Region, x: number, y: number, slop = 4): { id: string; label: boolean } | undefined {
  let best: { id: string; label: boolean; d: number } | undefined;
  forEachVisibleTransition(index, page, (t) => {
    const lb = labelBox(index, t);
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

function drawTransition(ctx: CanvasRenderingContext2D, index: DocIndex, t: Transition, fired = false): void {
  const g = edgeGeometry(index, t.id);
  if (!g || g.points.length < 2) return;
  const pts = g.points;

  ctx.strokeStyle = fired ? C.active : C.ink;
  ctx.fillStyle = fired ? C.active : C.ink;
  ctx.lineWidth = fired ? 3 : 2;
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();

  const end = pts[pts.length - 1]!;
  const prev = pts[pts.length - 2]!;
  const angle = Math.atan2(end.y - prev.y, end.x - prev.x) + Math.PI;
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x + 15 * Math.cos(angle - 0.4), end.y + 15 * Math.sin(angle - 0.4));
  ctx.lineTo(end.x + 15 * Math.cos(angle + 0.4), end.y + 15 * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();

  if (!g.label) return;
  for (const item of layoutLabel(ctx, index, t, g.label).items) ctx.fillText(item.text, item.x, item.y);
  ctx.fillStyle = C.ink;
}

/** The transitions the hovered event would take: a dashed aqua line over the route, a constant width on screen. */
function drawWould(ctx: CanvasRenderingContext2D, index: DocIndex, t: Transition, scale: number): void {
  const pts = edgeGeometry(index, t.id)?.points;
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = C.would;
  ctx.lineWidth = Math.max(3, 4 / scale);
  ctx.lineJoin = "round";
  ctx.setLineDash([8 / scale, 6 / scale]);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

/**
 * The sheet of paper with its drawing frame (sheet.ts): outer border, the drawing area's edge, zone ticks and references
 * in the band between, the grid inside the drawing area only, and the title block in its bottom-right corner.
 */
function drawSheet(ctx: CanvasRenderingContext2D, index: DocIndex, page: Region, fileName: string | undefined): void {
  const { sheet, border, area, xs, ys } = sheetFrame(paperOf(index));
  ctx.fillStyle = C.paper;
  ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
  ctx.fillStyle = C.grid;
  for (let gx = 0; gx <= area.w; gx += 20) {
    for (let gy = 0; gy <= area.h; gy += 20) ctx.fillRect(gx - 1, gy - 1, 2, 2);
  }
  ctx.save();
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(border.x, border.y, border.w, border.h);
  ctx.lineWidth = 2;
  ctx.strokeRect(area.x, area.y, area.w, area.h);
  ctx.lineWidth = 1;
  ctx.beginPath();
  for (const x of xs.slice(1, -1)) {
    ctx.moveTo(x, border.y);
    ctx.lineTo(x, area.y);
    ctx.moveTo(x, area.y + area.h);
    ctx.lineTo(x, border.y + border.h);
  }
  for (const y of ys.slice(1, -1)) {
    ctx.moveTo(border.x, y);
    ctx.lineTo(area.x, y);
    ctx.moveTo(area.x + area.w, y);
    ctx.lineTo(border.x + border.w, y);
  }
  ctx.stroke();
  ctx.fillStyle = C.ink;
  ctx.font = `12px ${FONT}`;
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const top = (border.y + area.y) / 2;
  const bottom = (area.y + area.h + border.y + border.h) / 2;
  const left = (border.x + area.x) / 2;
  const right = (area.x + area.w + border.x + border.w) / 2;
  for (let i = 0; i + 1 < xs.length; i++) {
    const x = (xs[i]! + xs[i + 1]!) / 2;
    ctx.fillText(String(i + 1), x, top);
    ctx.fillText(String(i + 1), x, bottom);
  }
  for (let i = 0; i + 1 < ys.length; i++) {
    const y = (ys[i]! + ys[i + 1]!) / 2;
    ctx.fillText(zoneRowLabel(i), left, y);
    ctx.fillText(zoneRowLabel(i), right, y);
  }
  ctx.restore();
  drawTitleBlock(ctx, index, page, fileName);
}

/** Title block: a caption in the top-left of every cell, the value along its bottom (clipped to the cell). */
function drawTitleBlock(ctx: CanvasRenderingContext2D, index: DocIndex, page: Region, fileName: string | undefined): void {
  const tb = sheetFrame(paperOf(index)).titleBlock;
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1;
  const cells = titleBlockCells(index, page, fileName === undefined ? {} : { fileName });
  for (const c of cells) ctx.strokeRect(c.box.x, c.box.y, c.box.w, c.box.h);
  ctx.lineWidth = 2;
  ctx.strokeRect(tb.x, tb.y, tb.w, tb.h);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  for (const c of cells) {
    const { x, y, w, h } = c.box;
    ctx.save();
    clipRect(ctx, x + 1, y + 1, w - 2, h - 2);
    ctx.fillStyle = canvasAlpha("ink", 0.7);
    ctx.font = `${TITLE_CAPTION_SIZE}px ${FONT}`;
    ctx.fillText(c.caption, x + 5, y + 2 + TITLE_CAPTION_SIZE);
    if (c.value) {
      ctx.fillStyle = C.ink;
      ctx.font = `${c.bold ? "bold " : ""}${c.size}px ${FONT}`;
      ctx.fillText(c.value, x + 8, y + h - 8);
    }
    ctx.restore();
  }
  ctx.restore();
}

export interface RenderOptions {
  /** Ids of selected vertices and transitions; drawn in the selection color when they are on this page. */
  selection?: ReadonlySet<string>;
  /** Drag handles of the selection (handles.ts), drawn at a constant screen size on top. */
  handles?: readonly Handle[];
  /** Elements with design rule findings: a badge at a state's top-right corner or a transition's middle. */
  marks?: ReadonlyMap<string, "error" | "warning">;
  /** Drawn last, in world coordinates (tool previews). */
  overlay?: (ctx: CanvasRenderingContext2D, scale: number) => void;
  /** Simulator highlight. */
  sim?: SimHighlight;
  /** The file's name for the title block (none before the first save). */
  fileName?: string;
}

export interface SimHighlight {
  /** Active states (and final states). */
  active: ReadonlySet<string>;
  /** The innermost active ones, drawn filled. */
  leaves: ReadonlySet<string>;
  /** Transitions the last step took. */
  fired: ReadonlySet<string>;
  /** Transitions the event under the pointer would take. */
  would: ReadonlySet<string>;
}

/** Handle size in screen pixels. */
const HANDLE_PX = 8;

function drawHandles(ctx: CanvasRenderingContext2D, handles: readonly Handle[], scale: number): void {
  const r = HANDLE_PX / 2 / scale;
  ctx.save();
  ctx.lineWidth = 1.5 / scale;
  ctx.strokeStyle = C.selection;
  for (const h of handles) {
    if (h.hidden) continue;
    ctx.fillStyle = h.shape === "ring" ? C.paper : C.selection;
    ctx.beginPath();
    if (h.shape === "dot" || h.shape === "ring") ctx.arc(h.x, h.y, r, 0, 2 * Math.PI);
    else if (h.shape === "bar") ctx.rect(h.x - 3 * r, h.y - r / 2, 6 * r, r);
    else ctx.rect(h.x - r, h.y - r, 2 * r, 2 * r);
    ctx.fill();
    ctx.stroke();
  }
  ctx.restore();
}

/** Dashed outline around a selected transition's label: it can be dragged. */
function drawLabelOutline(ctx: CanvasRenderingContext2D, index: DocIndex, t: Transition, scale: number): void {
  const g = edgeGeometry(index, t.id);
  if (!g?.label) return;
  const b = layoutLabel(ctx, index, t, g.label).box;
  const pad = 3 / scale;
  ctx.save();
  ctx.strokeStyle = C.selection;
  ctx.lineWidth = 1 / scale;
  ctx.setLineDash([4 / scale, 3 / scale]);
  ctx.strokeRect(b.x - pad, b.y - pad, b.w + 2 * pad, b.h + 2 * pad);
  ctx.restore();
}

function drawTransitionSelection(ctx: CanvasRenderingContext2D, index: DocIndex, t: Transition, scale: number): void {
  const pts = edgeGeometry(index, t.id)?.points;
  if (!pts || pts.length < 2) return;
  ctx.save();
  ctx.strokeStyle = C.selection;
  ctx.lineWidth = Math.max(3, 4 / scale);
  ctx.lineJoin = "round";
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.restore();
}

/** Problem badges, a constant size on screen: red for errors, yellow for warnings. */
function drawMarks(ctx: CanvasRenderingContext2D, index: DocIndex, page: Region, marks: ReadonlyMap<string, "error" | "warning">, scale: number): void {
  const r = 6 / scale;
  const badge = (x: number, y: number, sev: "error" | "warning"): void => {
    ctx.fillStyle = sev === "error" ? C.refuse : C.warning;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, 2 * Math.PI);
    ctx.fill();
    ctx.fillStyle = C.badgeMark;
    ctx.fillRect(x - r / 6, y - r * 0.6, r / 3, r * 0.75);
    ctx.fillRect(x - r / 6, y + r * 0.3, r / 3, r / 3);
  };
  ctx.save();
  forEachVisible(index, page, (v) => {
    const sev = marks.get(v.id);
    if (!sev) return;
    const b = drawnBox(index, v);
    badge(b.x + b.w, b.y, sev);
  });
  forEachVisibleTransition(index, page, (t) => {
    const sev = marks.get(t.id);
    const pts = sev && edgeGeometry(index, t.id)?.points;
    if (!sev || !pts || pts.length < 2) return;
    const k = Math.floor((pts.length - 2) / 2);
    badge((pts[k]!.x + pts[k + 1]!.x) / 2, (pts[k]!.y + pts[k + 1]!.y) / 2, sev);
  });
  ctx.restore();
}

/** Draw one page (the root region or an off-page region). `width`/`height` are CSS pixels. */
export function renderPage(
  ctx: CanvasRenderingContext2D,
  index: DocIndex,
  page: Region,
  view: View,
  width: number,
  height: number,
  opts: RenderOptions = {},
): void {
  ctx.save();
  ctx.fillStyle = C.background;
  ctx.fillRect(0, 0, width, height);
  ctx.translate(view.x, view.y);
  ctx.scale(view.scale, view.scale);

  drawSheet(ctx, index, page, opts.fileName);

  const sel = opts.selection;
  const selectedT: Transition[] = [];
  const sim = opts.sim;
  forEachVisible(index, page, (v) => {
    const look: SimLook = sim?.leaves.has(v.id) ? "leaf" : sim?.active.has(v.id) ? "active" : undefined;
    // A selected vertex is drawn in the selection color (no extra box around it).
    const picked = sel?.has(v.id) === true;
    if (v.kind === "state") drawState(ctx, index, v, look, picked);
    else drawPseudo(ctx, index, v, look, picked);
  });
  forEachVisibleTransition(index, page, (t) => {
    if (sel?.has(t.id)) selectedT.push(t);
    drawTransition(ctx, index, t, sim?.fired.has(t.id));
  });
  if (sim?.would.size) forEachVisibleTransition(index, page, (t) => void (sim.would.has(t.id) && drawWould(ctx, index, t, view.scale)));
  for (const t of selectedT) {
    drawTransitionSelection(ctx, index, t, view.scale);
    drawLabelOutline(ctx, index, t, view.scale);
  }
  if (opts.marks?.size) drawMarks(ctx, index, page, opts.marks, view.scale);
  if (opts.handles) drawHandles(ctx, opts.handles, view.scale);
  opts.overlay?.(ctx, view.scale);

  ctx.restore();
}
