// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Canvas renderer for v1 documents. Drawing rules follow the old GTK editor
 * (old/compose/src/render.c) so existing diagrams look the same; geometry
 * comes from @ufsm/core (relative layout -> absolute sheet coordinates).
 */
import { type DocIndex, type Region, type State, type Transition, type Vertex } from "@ufsm/core";
import {
  ACTION_CHAR_W,
  ACTION_ICON,
  ACTION_ICON_GAP,
  ACTION_LINE_H,
  ACTION_MARGIN,
  ACTION_PAD,
  HIDDEN_MARKER_ICON,
  HEADER_H,
  TITLE_CAPTION_SIZE,
  actionBlock,
  edgeGeometry,
  isOffPage,
  paperOf,
  regionBoxes,
  sheetFrame,
  sheetInfo,
  titleBlockCells,
  vertexBox,
  zoneRowLabel,
  type ActionBlock,
  type HiddenMarker,
  type ActionSegment,
  LABEL_FONT_SIZE,
  layoutTransitionLabel,
  type MeasureText,
} from "@ufsm/core/diagram";
import type { Handle } from "./handles";
import { drawnBox, forEachVisible, forEachVisibleTransition, type View } from "./hit";

export type { View } from "./hit";
import { drawIcon } from "./icons";
import { C, canvasAlpha } from "./theme";

/** Diagram colors come from the active theme (theme.ts); re-exported for the previews. */
export { C };

const FONT = "sans-serif";

/** Opacity of the active color over an innermost active state's fill (simulator). */
export const ACTIVE_FILL_ALPHA = 0.13;

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
function drawHiddenMarker(ctx: CanvasRenderingContext2D, marker: HiddenMarker, x: number, y: number): void {
  const px = x + marker.x,
    py = y + marker.y,
    yc = py + marker.h / 2;
  ctx.save();
  ctx.lineWidth = 1;
  ctx.strokeStyle = C.ink;
  ctx.fillStyle = C.stateFill;
  roundedRect(ctx, px, py, marker.w, marker.h, marker.h / 2);
  ctx.fill();
  ctx.stroke();
  ctx.strokeStyle = canvasAlpha("ink", BLOCK_ICON_ALPHA);
  ctx.fillStyle = C.ink;
  ctx.font = blockFont(ctx);
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  drawIcon(ctx, "chevron-down", px + 5, yc - HIDDEN_MARKER_ICON / 2, HIDDEN_MARKER_ICON);
  for (const p of marker.parts) {
    if (p.icon) drawIcon(ctx, p.icon, px + p.x, yc - HIDDEN_MARKER_ICON / 2, HIDDEN_MARKER_ICON);
    ctx.fillText(p.text, px + p.x + (p.icon ? HIDDEN_MARKER_ICON + 1 : 0), yc + 1);
  }
  ctx.restore();
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
  if (block.hiddenMarker && HEADER_H + block.height < h) drawHiddenMarker(ctx, block.hiddenMarker, x, y);

  // Region bands: name, dashed separator between bands, off-page marker.
  const bands = regionBoxes(index, s);
  bands.forEach(({ region, box }, i) => {
    ctx.fillStyle = C.ink;
    ctx.font = `18px ${FONT}`;
    if (region.name) {
      ctx.save();
      clipRect(
        ctx,
        Math.max(box.x, x) + 2,
        Math.max(box.y, y),
        Math.min(box.x + box.w, x + w) - Math.max(box.x, x) - 4,
        Math.min(box.y + box.h, y + h - 2) - Math.max(box.y, y),
      );
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

/** Label text at LABEL_FONT_SIZE, measured as it is drawn. */
function labelFont(ctx: CanvasRenderingContext2D): MeasureText {
  ctx.font = `${LABEL_FONT_SIZE}px ${FONT}`;
  return (text) => ctx.measureText(text).width;
}

let measureCtx: CanvasRenderingContext2D | undefined;
/** Label widths as the canvas draws them (hit testing passes this to hit.ts). */
export function canvasLabelMeasure(): MeasureText {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  return labelFont(measureCtx);
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
  for (const item of layoutTransitionLabel(index, t, g.label, labelFont(ctx)).items)
    ctx.fillText(item.text, item.x, item.y);
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
function drawSheet(ctx: CanvasRenderingContext2D, index: DocIndex, region: Region, fileName: string | undefined): void {
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
  drawTitleBlock(ctx, index, region, fileName);
}

/** Title block: a caption in the top-left of every cell, the value along its bottom (clipped to the cell). */
function drawTitleBlock(
  ctx: CanvasRenderingContext2D,
  index: DocIndex,
  sheet: Region,
  fileName: string | undefined,
): void {
  const tb = sheetFrame(paperOf(index)).titleBlock;
  ctx.save();
  ctx.fillStyle = C.paper;
  ctx.fillRect(tb.x, tb.y, tb.w, tb.h);
  ctx.strokeStyle = C.ink;
  ctx.lineWidth = 1;
  const cells = titleBlockCells(index, sheet, fileName === undefined ? {} : { fileName });
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
  /** Ids of selected vertices and transitions; drawn in the selection color when they are on this sheet. */
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
  const b = layoutTransitionLabel(index, t, g.label, labelFont(ctx)).box;
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
function drawMarks(
  ctx: CanvasRenderingContext2D,
  index: DocIndex,
  sheet: Region,
  marks: ReadonlyMap<string, "error" | "warning">,
  scale: number,
): void {
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
  forEachVisible(index, sheet, (v) => {
    const sev = marks.get(v.id);
    if (!sev) return;
    const b = drawnBox(index, v);
    badge(b.x + b.w, b.y, sev);
  });
  forEachVisibleTransition(index, sheet, (t) => {
    const sev = marks.get(t.id);
    const pts = sev && edgeGeometry(index, t.id)?.points;
    if (!sev || !pts || pts.length < 2) return;
    const k = Math.floor((pts.length - 2) / 2);
    badge((pts[k]!.x + pts[k + 1]!.x) / 2, (pts[k]!.y + pts[k + 1]!.y) / 2, sev);
  });
  ctx.restore();
}

/** Draw one sheet (the root region or an off-page region). `width`/`height` are CSS pixels. */
export function renderSheet(
  ctx: CanvasRenderingContext2D,
  index: DocIndex,
  sheet: Region,
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

  drawSheet(ctx, index, sheet, opts.fileName);

  const sel = opts.selection;
  const selectedT: Transition[] = [];
  const sim = opts.sim;
  forEachVisible(index, sheet, (v) => {
    const look: SimLook = sim?.leaves.has(v.id) ? "leaf" : sim?.active.has(v.id) ? "active" : undefined;
    // A selected vertex is drawn in the selection color (no extra box around it).
    const picked = sel?.has(v.id) === true;
    if (v.kind === "state") drawState(ctx, index, v, look, picked);
    else drawPseudo(ctx, index, v, look, picked);
  });
  forEachVisibleTransition(index, sheet, (t) => {
    if (sel?.has(t.id)) selectedT.push(t);
    drawTransition(ctx, index, t, sim?.fired.has(t.id));
  });
  if (sim?.would.size)
    forEachVisibleTransition(index, sheet, (t) => void (sim.would.has(t.id) && drawWould(ctx, index, t, view.scale)));
  for (const t of selectedT) {
    drawTransitionSelection(ctx, index, t, view.scale);
    drawLabelOutline(ctx, index, t, view.scale);
  }
  if (opts.marks?.size) drawMarks(ctx, index, sheet, opts.marks, view.scale);
  if (opts.handles) drawHandles(ctx, opts.handles, view.scale);
  opts.overlay?.(ctx, view.scale);

  ctx.restore();
}
