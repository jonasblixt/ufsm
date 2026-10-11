// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * What the canvas draws on top of the sheet while a tool is armed: a ghost of the vertex a click would place, and the
 * transition being drawn (source, bend points, a line to the pointer, the target under it; over a valid target the
 * route the click would give it, S or straight). World coordinates;
 * line widths and dashes are scaled so they look the same at every zoom.
 */
import type { Box, Point } from "@ufsm/core";
import { C } from "./render";

function outline(ctx: CanvasRenderingContext2D, b: Box, round: boolean, scale: number, color: string, dashed: boolean): void {
  ctx.save();
  ctx.strokeStyle = color;
  ctx.lineWidth = 2 / scale;
  if (dashed) ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.beginPath();
  if (round) ctx.arc(b.x + b.w / 2, b.y + b.h / 2, b.w / 2, 0, 2 * Math.PI);
  else ctx.rect(b.x, b.y, b.w, b.h);
  ctx.stroke();
  ctx.restore();
}

/** A dashed ghost of the box a click would place (round for round pseudo states). */
export function drawGhost(ctx: CanvasRenderingContext2D, b: Box, round: boolean, scale: number): void {
  outline(ctx, b, round, scale, C.selection, true);
}

/**
 * The transition being drawn: source outlined, dashed line from `start` (on the source's outline) through the bend
 * points to the pointer, target outlined.
 */
export function drawLink(
  ctx: CanvasRenderingContext2D,
  source: Box,
  start: Point,
  bends: readonly Point[],
  to: Point,
  target: { box: Box; ok: boolean } | undefined,
  scale: number,
): void {
  outline(ctx, source, false, scale, C.selection, false);
  if (target) outline(ctx, target.box, false, scale, target.ok ? C.ok : C.refuse, false);
  const pts = [start, ...bends, to];
  ctx.save();
  ctx.strokeStyle = C.selection;
  ctx.fillStyle = C.selection;
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.beginPath();
  ctx.moveTo(pts[0]!.x, pts[0]!.y);
  for (const p of pts.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  for (const p of bends) ctx.fillRect(p.x - 3 / scale, p.y - 3 / scale, 6 / scale, 6 / scale);
  ctx.restore();
}

/** A route the transition being drawn would take (or an S towards the pointer): dashed, with an arrowhead. */
export function drawLinkRoute(
  ctx: CanvasRenderingContext2D,
  source: Box,
  points: readonly Point[],
  target: { box: Box; ok: boolean } | undefined,
  scale: number,
): void {
  outline(ctx, source, false, scale, C.selection, false);
  if (target) outline(ctx, target.box, false, scale, target.ok ? C.ok : C.refuse, false);
  if (points.length < 2) return;
  ctx.save();
  ctx.strokeStyle = C.selection;
  ctx.fillStyle = C.selection;
  ctx.lineWidth = 2 / scale;
  ctx.setLineDash([6 / scale, 4 / scale]);
  ctx.beginPath();
  ctx.moveTo(points[0]!.x, points[0]!.y);
  for (const p of points.slice(1)) ctx.lineTo(p.x, p.y);
  ctx.stroke();
  ctx.setLineDash([]);
  const end = points[points.length - 1]!, prev = points[points.length - 2]!;
  const a = Math.atan2(end.y - prev.y, end.x - prev.x) + Math.PI;
  const len = 12 / Math.max(scale, 0.5);
  ctx.beginPath();
  ctx.moveTo(end.x, end.y);
  ctx.lineTo(end.x + len * Math.cos(a - 0.4), end.y + len * Math.sin(a - 0.4));
  ctx.lineTo(end.x + len * Math.cos(a + 0.4), end.y + len * Math.sin(a + 0.4));
  ctx.closePath();
  ctx.fill();
  ctx.restore();
}
