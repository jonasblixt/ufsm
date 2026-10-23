// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * File › Export SVG: one sheet as an SVG drawing, drawn by render.ts on the SVG context (svg.ts). With the drawing
 * frame the SVG is the whole sheet of paper (frame, zones, title block) at its paper size; without it, the diagram's
 * bounds plus a margin, at the same scale (2 units per pt, so it prints 1:1). Always in the light appearance of the
 * active theme, on paper (no grid, selection, handles, problem badges or simulator highlight). No DOM: the caller
 * passes the text measure (the editor's canvas; tests use the estimate).
 */
import type { DocIndex, Region } from "@ufsm/core";
import { LABEL_FONT_SIZE, paperOf, sheetFrame, sheetInfo, type Box } from "@ufsm/core/diagram";
import { sheetBounds } from "./hit";
import { renderSheet } from "./render";
import type { ThemeSetting } from "./settings";
import { estimatedMeasure, SvgContext, type SvgMeasure } from "./svg";
import { C, resolveTheme, withCanvasTheme, type ResolvedTheme } from "./theme";

/** Space around the diagram when the frame is left out (sheet units). */
export const EXPORT_MARGIN = 20;

export interface SvgExportOptions {
  /** Include the sheet of paper with its drawing frame and title block. */
  frame: boolean;
  /** The file's name for the title block. */
  fileName?: string;
  /** Diagram colors (`exportTheme`). */
  theme: ResolvedTheme;
  measure?: SvgMeasure;
}

/** The colors of an export: the theme in settings, in its light appearance. */
export function exportTheme(setting: ThemeSetting): ResolvedTheme {
  return resolveTheme({ ...setting, appearance: "light" }, false).theme;
}

/** What an export of `sheet` covers, in sheet coordinates. */
export function exportBox(index: DocIndex, sheet: Region, frame: boolean, measure: SvgMeasure = estimatedMeasure): Box {
  const paper = sheetFrame(paperOf(index));
  if (frame) return paper.sheet;
  const labelFont = `${LABEL_FONT_SIZE}px sans-serif`;
  const b = sheetBounds(index, sheet, (text) => measure.width(labelFont, text));
  // an empty sheet: its drawing area
  if (!b) return paper.area;
  const m = EXPORT_MARGIN;
  return { x: b.x0 - m, y: b.y0 - m, w: b.x1 - b.x0 + 2 * m, h: b.y1 - b.y0 + 2 * m };
}

/** One sheet as an SVG document. */
export function sheetSvg(index: DocIndex, sheet: Region, opts: SvgExportOptions): string {
  const measure = opts.measure ?? estimatedMeasure;
  const box = exportBox(index, sheet, opts.frame, measure);
  const svg = new SvgContext(measure);
  withCanvasTheme(opts.theme, () => {
    // the background is the paper, also around a diagram exported without its frame
    C.background = C.paper;
    renderSheet(svg.asCanvas(), index, sheet, { x: -box.x, y: -box.y, scale: 1 }, box.w, box.h, {
      frame: opts.frame,
      grid: false,
      ...(opts.fileName === undefined ? {} : { fileName: opts.fileName }),
    });
  });
  // renderSheet drew in viewport coordinates (the box's corner at 0, 0)
  const info = sheetInfo(index, sheet);
  return svg.svg(
    { x: 0, y: 0, w: box.w, h: box.h },
    {
      width: `${box.w / 2}pt`,
      height: `${box.h / 2}pt`,
      title: info.number === 1 ? info.name : `${index.doc.name}, sheet ${info.number}: ${info.name}`,
    },
  );
}

/** The suggested file name: the model's, with `-sheet<n>` for a sheet other than the first. */
export function svgFileName(fileName: string, sheetNumber: number): string {
  const base = fileName.replace(/\.ufsm$/i, "");
  return `${base}${sheetNumber > 1 ? `-sheet${sheetNumber}` : ""}.svg`;
}
