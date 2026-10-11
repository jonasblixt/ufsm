// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Icons drawn on the canvas: the kinds of lines in a state's action block and the chevrons of its hidden-items marker.
 *
 * The outlines are Tabler Icons (https://github.com/tabler/tabler-icons), MIT License,
 * Copyright (c) 2020-2026 Paweł Kuna: 24 × 24 units, stroked 2 units wide with round caps and joins.
 */
import type { ActionKind } from "@ufsm/core";

export type IconName = ActionKind | "chevron-down" | "chevron-right";

/** SVG path data per icon (Tabler: login, logout, hourglass, repeat, bolt, chevron-down, chevron-right). */
const PATHS: Record<IconName, string[]> = {
  entry: ["M15 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2", "M21 12h-13l3 -3", "M11 15l-3 -3"],
  exit: ["M14 8v-2a2 2 0 0 0 -2 -2h-7a2 2 0 0 0 -2 2v12a2 2 0 0 0 2 2h7a2 2 0 0 0 2 -2v-2", "M9 12h12l-3 -3", "M18 15l3 -3"],
  after: [
    "M6.5 7h11",
    "M6.5 17h11",
    "M6 20v-2a6 6 0 1 1 12 0v2a1 1 0 0 1 -1 1h-10a1 1 0 0 1 -1 -1",
    "M6 4v2a6 6 0 1 0 12 0v-2a1 1 0 0 0 -1 -1h-10a1 1 0 0 0 -1 1",
  ],
  every: ["M4 12v-3a3 3 0 0 1 3 -3h13m-3 -3l3 3l-3 3", "M20 12v3a3 3 0 0 1 -3 3h-13m3 3l-3 -3l3 -3"],
  internal: ["M13 3l0 7l6 0l-8 11l0 -7l-6 0l8 -11"],
  "chevron-down": ["M6 9l6 6l6 -6"],
  "chevron-right": ["M9 6l6 6l-6 6"],
};

const GRID = 24;
const cache = new Map<IconName, Path2D>();

function pathOf(name: IconName): Path2D {
  let p = cache.get(name);
  if (!p) {
    p = new Path2D();
    for (const d of PATHS[name]) p.addPath(new Path2D(d));
    cache.set(name, p);
  }
  return p;
}

/** Stroke an icon in a `size` × `size` square with its top-left corner at (x, y), in the current stroke color. */
export function drawIcon(ctx: CanvasRenderingContext2D, name: IconName, x: number, y: number, size: number): void {
  ctx.save();
  ctx.translate(x, y);
  ctx.scale(size / GRID, size / GRID);
  ctx.lineWidth = 2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  ctx.setLineDash([]);
  ctx.stroke(pathOf(name));
  ctx.restore();
}
