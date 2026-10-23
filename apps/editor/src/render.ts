// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Canvas renderer for v1 documents. Drawing rules follow the old GTK editor
 * (v0.5.3: compose/src/render.c) so existing diagrams look the same; geometry
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
  FRAME_CAPTION_H,
  NOTE_FOLD,
  NOTE_FONT_SIZE,
  NOTE_LINE_H,
  NOTE_PAD,
  annotationBox,
  annotationsOn,
  arrowPoints,
  noteDisplayText,
  wrapNoteText,
  type Point,
} from "@ufsm/core/diagram";
import type { Handle } from "./handles";
import { drawnBox, forEachVisible, forEachVisibleTransition, frameCaptionWidth, type View } from "./hit";

export type { View } from "./hit";
import { drawIcon } from "./icons";
import { canvasMeasure, type SvgMeasure } from "./svg";
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

/** Text metrics for the SVG export, from the canvas fonts the editor draws with. */
export function canvasSvgMeasure(): SvgMeasure {
  measureCtx ??= document.createElement("canvas").getContext("2d")!;
  return canvasMeasure(measureCtx);
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

// ---------------------------------------------------------------- notes, frames and arrows (documentation only)

/** Opacity of the note color washed over a note's and a frame caption's background. */
const NOTE_WASH = 0.1;

/** A group frame: a dashed outline in the note color, its caption in a tab at the top-left. */
function drawFrame(ctx: CanvasRenderingContext2D, index: DocIndex, id: string, selected: boolean): void {
  const b = annotationBox(index, id);
  if (!b) return;
  const caption = index.doc.diagram?.frames?.[id]?.caption;
  ctx.save();
  ctx.strokeStyle = selected ? C.selection : C.note;
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.setLineDash([8, 6]);
  ctx.strokeRect(b.x, b.y, b.w, b.h);
  ctx.setLineDash([]);
  if (caption) {
    ctx.font = `italic ${NOTE_FONT_SIZE}px ${FONT}`;
    const w = Math.min(frameCaptionWidth(caption, labelFont(ctx)), b.w);
    ctx.fillStyle = canvasAlpha("note", NOTE_WASH * 1.5);
    ctx.fillRect(b.x, b.y, w, FRAME_CAPTION_H);
    clipRect(ctx, b.x, b.y, w, FRAME_CAPTION_H);
    ctx.font = `italic ${NOTE_FONT_SIZE}px ${FONT}`;
    ctx.fillStyle = C.note;
    ctx.textBaseline = "middle";
    ctx.textAlign = "left";
    ctx.fillText(caption, b.x + 10, b.y + FRAME_CAPTION_H / 2 + 1);
  }
  ctx.restore();
}

/** Outline of a note: a box with its top-right corner folded. */
function notePath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  const f = Math.min(NOTE_FOLD, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x, y);
  ctx.lineTo(x + w - f, y);
  ctx.lineTo(x + w, y + f);
  ctx.lineTo(x + w, y + h);
  ctx.lineTo(x, y + h);
  ctx.closePath();
}

/**
 * A note: the folded box washed with the note color (the TODO color for a TODO note, with a tag on its top edge), its
 * text wrapped at the box's width, `{id}` references shown as names, clipped to the box.
 */
function drawNote(ctx: CanvasRenderingContext2D, index: DocIndex, id: string, selected: boolean): void {
  const n = index.doc.diagram?.notes?.[id];
  const b = annotationBox(index, id);
  if (!n || !b) return;
  const color = n.todo ? "todo" : "note";
  const { x, y, w, h } = b;
  const f = Math.min(NOTE_FOLD, w / 2, h / 2);
  ctx.save();
  notePath(ctx, x, y, w, h);
  ctx.fillStyle = C.paper;
  ctx.fill();
  ctx.fillStyle = canvasAlpha(color, NOTE_WASH);
  ctx.fill();
  ctx.strokeStyle = selected ? C.selection : C[color];
  ctx.lineWidth = selected ? 3 : 1.5;
  ctx.lineJoin = "round";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(x + w - f, y);
  ctx.lineTo(x + w - f, y + f);
  ctx.lineTo(x + w, y + f);
  ctx.lineWidth = 1.5;
  ctx.stroke();
  if (n.todo) {
    ctx.font = `bold 11px ${FONT}`;
    const tw = ctx.measureText("TODO").width + 10;
    ctx.fillStyle = C.todo;
    ctx.fillRect(x + 8, y - 8, tw, 16);
    ctx.fillStyle = C.paper;
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("TODO", x + 13, y + 1);
  }
  clipRect(ctx, x + 2, y + 2, w - 4, h - 4);
  ctx.fillStyle = C[color];
  const measure = labelFont(ctx);
  ctx.textAlign = "left";
  ctx.textBaseline = "alphabetic";
  wrapNoteText(noteDisplayText(index, n.text), w, measure).forEach((line, i) =>
    ctx.fillText(line, x + NOTE_PAD, y + NOTE_PAD + (i + 1) * NOTE_LINE_H - 5),
  );
  ctx.restore();
}

/** A filled arrowhead at `tip`, pointing away from `from`. */
function arrowHead(ctx: CanvasRenderingContext2D, from: Point, tip: Point, size: number): void {
  const angle = Math.atan2(tip.y - from.y, tip.x - from.x) + Math.PI;
  ctx.beginPath();
  ctx.moveTo(tip.x, tip.y);
  ctx.lineTo(tip.x + size * Math.cos(angle - 0.4), tip.y + size * Math.sin(angle - 0.4));
  ctx.lineTo(tip.x + size * Math.cos(angle + 0.4), tip.y + size * Math.sin(angle + 0.4));
  ctx.closePath();
  ctx.fill();
}

/** An arrow: a straight line in the note color (dashed when asked), with heads as asked; a dot on an attached end. */
function drawArrow(ctx: CanvasRenderingContext2D, index: DocIndex, id: string, selected: boolean): void {
  const a = index.doc.diagram?.arrows?.[id];
  const pts = arrowPoints(index, id);
  if (!a || !pts) return;
  const { from, to } = pts;
  const color = selected ? C.selection : C.note;
  const head = a.head ?? "end";
  ctx.save();
  ctx.strokeStyle = color;
  ctx.fillStyle = color;
  ctx.lineWidth = selected ? 3 : 1.5;
  if (a.dashed) ctx.setLineDash([6, 5]);
  ctx.beginPath();
  ctx.moveTo(from.x, from.y);
  ctx.lineTo(to.x, to.y);
  ctx.stroke();
  ctx.setLineDash([]);
  if (head !== "none") arrowHead(ctx, from, to, 12);
  if (head === "both") arrowHead(ctx, to, from, 12);
  // where a headless end touches an element, a small dot shows it is attached (UML's comment anchor)
  for (const [end, p, hasHead] of [
    [a.from, from, head === "both"],
    [a.to, to, head !== "none"],
  ] as const) {
    if (!hasHead && "ref" in end) {
      ctx.beginPath();
      ctx.arc(p.x, p.y, 3, 0, 2 * Math.PI);
      ctx.fill();
    }
  }
  ctx.restore();
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
function drawSheet(
  ctx: CanvasRenderingContext2D,
  index: DocIndex,
  region: Region,
  fileName: string | undefined,
  grid: boolean,
): void {
  const { sheet, border, area, xs, ys } = sheetFrame(paperOf(index));
  ctx.fillStyle = C.paper;
  ctx.fillRect(sheet.x, sheet.y, sheet.w, sheet.h);
  ctx.fillStyle = C.grid;
  for (let gx = 0; grid && gx <= area.w; gx += 20) {
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
  /** Draw the sheet of paper with its drawing frame and title block (default true; the SVG export can leave it out). */
  frame?: boolean;
  /** Draw the grid dots on the drawing area (default true; not exported). */
  grid?: boolean;
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
  const on = annotationsOn(index, sheet);
  for (const id of [...on.frames, ...on.notes, ...on.arrows]) {
    const sev = marks.get(id);
    if (!sev) continue;
    const b = annotationBox(index, id);
    const a = b ? undefined : arrowPoints(index, id);
    if (b) badge(b.x + b.w, b.y, sev);
    else if (a) badge((a.from.x + a.to.x) / 2, (a.from.y + a.to.y) / 2, sev);
  }
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

  if (opts.frame !== false) drawSheet(ctx, index, sheet, opts.fileName, opts.grid !== false);

  const sel = opts.selection;
  const notes = annotationsOn(index, sheet);
  // a frame lies behind what its region holds: the sheet's own first, a state's right after the state is drawn
  const framesIn = new Map<string, string[]>();
  for (const id of notes.frames) {
    const r = index.doc.diagram!.frames![id]!.region;
    framesIn.set(r, [...(framesIn.get(r) ?? []), id]);
  }
  const drawFrames = (region: string): void =>
    framesIn.get(region)?.forEach((id) => drawFrame(ctx, index, id, sel?.has(id) === true));
  drawFrames(sheet.id);
  const selectedT: Transition[] = [];
  const sim = opts.sim;
  forEachVisible(index, sheet, (v) => {
    const look: SimLook = sim?.leaves.has(v.id) ? "leaf" : sim?.active.has(v.id) ? "active" : undefined;
    // A selected vertex is drawn in the selection color (no extra box around it).
    const picked = sel?.has(v.id) === true;
    if (v.kind === "state") {
      drawState(ctx, index, v, look, picked);
      for (const r of v.regions ?? []) if (!isOffPage(index, r.id)) drawFrames(r.id);
    } else drawPseudo(ctx, index, v, look, picked);
  });
  forEachVisibleTransition(index, sheet, (t) => {
    if (sel?.has(t.id)) selectedT.push(t);
    drawTransition(ctx, index, t, sim?.fired.has(t.id));
  });
  for (const id of notes.notes) drawNote(ctx, index, id, sel?.has(id) === true);
  for (const id of notes.arrows) drawArrow(ctx, index, id, sel?.has(id) === true);
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
