// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * The canvas: drawing the active machine's sheet (one frame at a time), pan and zoom, and the mapping between client
 * and world coordinates. The view itself (pan/zoom) belongs to the session, so every machine keeps its own.
 */
import type { Diagnostic } from "@ufsm/core";
import { paperOf, sheetFrame, type Point } from "@ufsm/core/diagram";
import { el, type App } from "../app";
import { handlesFor, type Handle } from "../handles";
import { sheetBounds, type Bounds, type View } from "../hit";
import { canvasLabelMeasure, renderSheet } from "../render";
import { C, canvasAlpha } from "../theme";
import type { DocSession } from "../session";
import { drawOverlay } from "./tools";
import { lassoMode, type Lasso } from "./state";
import type { MeasureText } from "@ufsm/core/diagram";

export interface CanvasView {
  readonly canvas: HTMLCanvasElement;
  /** The active machine's view, or a placeholder while nothing is open. */
  readonly view: View;
  /** Label widths as drawn, for hit testing. */
  readonly measure: MeasureText;
  requestDraw(): void;
  /** Size of the canvas in CSS pixels. */
  cssSize(): { w: number; h: number };
  fitBounds(b: Bounds, maxScale?: number): void;
  /** The drawing, or the whole sheet when it is empty. */
  fit(): void;
  /** Zoom to `scale` keeping the canvas point (mx, my) in place. */
  zoomAround(mx: number, my: number, scale: number): void;
  /** 100%. */
  zoomNormal(): void;
  screenToWorld(clientX: number, clientY: number): [number, number];
  worldAt(clientX: number, clientY: number): Point;
  worldToScreen(x: number, y: number): [number, number];
  /** Is a world point on the title block (double-click there opens its fields)? */
  onTitleBlock(x: number, y: number): boolean;
  /** Handles of the current selection (drawn and grabbed). */
  handles(): Handle[];
}

export function createCanvasView(app: App): CanvasView {
  const canvas = el<HTMLCanvasElement>("canvas");
  const ctx = canvas.getContext("2d")!;
  const zoomEl = el<HTMLSpanElement>("zoom");
  const placeholder: View = { scale: 0.5, x: 0, y: 0 };
  const measure = canvasLabelMeasure();
  let frame = 0;

  const view = (): View => app.ws.active?.view ?? placeholder;
  const cssSize = (): { w: number; h: number } => {
    const r = canvas.getBoundingClientRect();
    return { w: r.width, h: r.height };
  };
  const handles = (): Handle[] => {
    const d = app.ws.active;
    return d ? handlesFor(d.index, d.sheet, d.selection) : [];
  };

  const marksCache = new WeakMap<readonly Diagnostic[], Map<string, "error" | "warning">>();
  /** Canvas badges for the design rule findings: on the element, or on the state owning a region or internal transition. */
  const problemMarks = (d: DocSession): Map<string, "error" | "warning"> => {
    const cached = marksCache.get(d.diagnostics);
    if (cached) return cached;
    const marks = new Map<string, "error" | "warning">();
    for (const x of d.diagnostics) {
      if (!x.id) continue;
      const ix = d.index;
      const id =
        ix.vertices.has(x.id) || ix.transitions.has(x.id)
          ? x.id
          : (ix.internals.get(x.id)?.state.id ?? ix.timers.get(x.id)?.state.id ?? ix.regions.get(x.id)?.owner?.id);
      if (id && marks.get(id) !== "error") marks.set(id, x.severity === "error" ? "error" : "warning");
    }
    marksCache.set(d.diagnostics, marks);
    return marks;
  };

  const drawLasso = (l: Lasso): void => {
    const r = canvas.getBoundingClientRect();
    const x = Math.min(l.x0, l.x1) - r.left;
    const y = Math.min(l.y0, l.y1) - r.top;
    const w = Math.abs(l.x1 - l.x0);
    const h = Math.abs(l.y1 - l.y0);
    // As in the old editor: the selection color (orange) encloses, blue selects what it touches.
    const color = lassoMode(l) === "enclosed" ? "selection" : "touching";
    ctx.save();
    ctx.fillStyle = canvasAlpha(color, 0.08);
    ctx.fillRect(x, y, w, h);
    ctx.strokeStyle = C[color];
    ctx.lineWidth = 1;
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(x + 0.5, y + 0.5, w, h);
    ctx.restore();
  };

  const draw = (): void => {
    frame = 0;
    const { w, h } = cssSize();
    const dpr = window.devicePixelRatio || 1;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const d = app.ws.active;
    if (d) {
      const sim = d.simHighlight();
      renderSheet(ctx, d.index, d.sheet, d.view, w, h, {
        selection: d.selection,
        handles: handles(),
        overlay: (c, scale) => drawOverlay(app, c, scale),
        marks: problemMarks(d),
        ...(sim ? { sim } : {}),
        // No file name in the title block before File › New's first save.
        ...(d.untitled ? {} : { fileName: d.fileName }),
      });
      if (app.tools.lasso) drawLasso(app.tools.lasso);
      zoomEl.textContent = `${Math.round(d.view.scale * 100)}%`;
    } else {
      ctx.fillStyle = C.background;
      ctx.fillRect(0, 0, w, h);
    }
  };

  const requestDraw = (): void => {
    if (!frame) frame = requestAnimationFrame(draw);
  };

  const fitBounds = (b: Bounds, maxScale = 2): void => {
    const { w, h } = cssSize();
    const pad = 40;
    const v = view();
    const scale = Math.min(
      (w - 2 * pad) / Math.max(b.x1 - b.x0, 1),
      (h - 2 * pad) / Math.max(b.y1 - b.y0, 1),
      maxScale,
    );
    v.scale = scale;
    v.x = (w - (b.x1 - b.x0) * scale) / 2 - b.x0 * scale;
    v.y = (h - (b.y1 - b.y0) * scale) / 2 - b.y0 * scale;
    requestDraw();
  };

  const zoomAround = (mx: number, my: number, scale: number): void => {
    const v = view();
    v.x = mx - ((mx - v.x) * scale) / v.scale;
    v.y = my - ((my - v.y) * scale) / v.scale;
    v.scale = scale;
    requestDraw();
  };

  const screenToWorld = (clientX: number, clientY: number): [number, number] => {
    const r = canvas.getBoundingClientRect();
    const v = view();
    return [(clientX - r.left - v.x) / v.scale, (clientY - r.top - v.y) / v.scale];
  };

  new ResizeObserver(requestDraw).observe(canvas);

  return {
    canvas,
    get view() {
      return view();
    },
    measure,
    requestDraw,
    cssSize,
    fitBounds,
    fit: () => {
      const d = app.ws.active;
      if (!d) return;
      const s = sheetFrame(paperOf(d.index)).sheet;
      fitBounds(sheetBounds(d.index, d.sheet) ?? { x0: s.x, y0: s.y, x1: s.x + s.w, y1: s.y + s.h });
    },
    zoomAround,
    zoomNormal: () => {
      const { w, h } = cssSize();
      zoomAround(w / 2, h / 2, 1);
    },
    screenToWorld,
    worldAt: (clientX, clientY) => {
      const [x, y] = screenToWorld(clientX, clientY);
      return { x, y };
    },
    worldToScreen: (x, y) => {
      const r = canvas.getBoundingClientRect();
      const v = view();
      return [r.left + v.x + x * v.scale, r.top + v.y + y * v.scale];
    },
    onTitleBlock: (x, y) => {
      const d = app.ws.active;
      if (!d) return false;
      const tb = sheetFrame(paperOf(d.index)).titleBlock;
      return x >= tb.x && x <= tb.x + tb.w && y >= tb.y && y <= tb.y + tb.h;
    },
    handles,
  };
}
