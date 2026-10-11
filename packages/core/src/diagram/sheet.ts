// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Sheets as drawings: the frame, its zone references and the title block.
 *
 * Every sheet (the root region and each off-page region) is a sheet of paper of the diagram's size (`PAPER_SIZES`, 2
 * units per pt, so it prints 1:1). The paper carries a drawing frame in the manner of ISO 5457: an outer border line
 * FRAME_BORDER from the paper edge and the edge of the drawing area FRAME_MARGIN from it, with zone references in the
 * band between (numbers along the long edges, letters along the short ones; zones of about 50 mm). The title block sits
 * in the bottom-right corner of the drawing area.
 *
 * The sheet origin, which every top-level x/y on a sheet is relative to, is the top-left corner of the drawing area,
 * so the paper itself starts at (-FRAME_MARGIN, -FRAME_MARGIN). The edit rule that keeps vertices on a sheet at
 * non-negative coordinates therefore keeps them inside the frame's left and top edges; the right and bottom edges and
 * the title block are checked by `sheetFit` (design rule warnings).
 *
 * Platform neutral: the editor draws from these boxes, and so will SVG/PDF export.
 */
import { commonRegion, vertexName, type DocIndex } from "../model/doc-index";
import { edgeGeometry, isSheet, sheetOfRegion, sheetOfVertex, vertexBox, type Box, type Point } from "./geometry";
import { LABEL_FIRST_LINE, LABEL_GAP, LABEL_LINE_H, transitionLabelBox } from "./label-layout";
import { PAPER_SIZES, type Id, type Paper, type Region, type State, type TitleBlock } from "../format/model";

/** Paper edge to the edge of the drawing area (8.8 mm). */
export const FRAME_MARGIN = 50;
/** Paper edge to the outer border line (5.3 mm, inside what printers can print). */
export const FRAME_BORDER = 30;
/** Title block size in the bottom-right corner of the drawing area (106 × 34 mm). */
export const TITLE_BLOCK_W = 600;
export const TITLE_BLOCK_H = 190;

/** Zones per sheet (columns along the long edge × rows), ISO 5457's counts for landscape sheets. */
export const ZONES: Readonly<Record<Paper, { cols: number; rows: number }>> = {
  A4: { cols: 6, rows: 4 },
  A3: { cols: 8, rows: 6 },
  A2: { cols: 12, rows: 8 },
  A1: { cols: 16, rows: 12 },
};

/** Row letters: ISO 5457 leaves out I and O (they read as 1 and 0). */
const ROW_LETTERS = "ABCDEFGHJKLMNPQRSTUVWXYZ";

export interface SheetFrame {
  paper: Paper;
  /** The whole sheet of paper, in sheet coordinates (it starts at -FRAME_MARGIN). */
  sheet: Box;
  /** The outer border line. */
  border: Box;
  /** The drawing area: inside the inner frame line, from (0, 0). */
  area: Box;
  /** Zone boundaries along x (cols + 1 values, from 0 to area.w) and along y (rows + 1 values). */
  xs: number[];
  ys: number[];
  titleBlock: Box;
}

/** Frame geometry of a sheet of `paper`, in sheet coordinates. */
export function sheetFrame(paper: Paper): SheetFrame {
  const { w, h } = PAPER_SIZES[paper];
  const m = FRAME_MARGIN;
  const b = FRAME_BORDER;
  const area = { x: 0, y: 0, w: w - 2 * m, h: h - 2 * m };
  const { cols, rows } = ZONES[paper];
  return {
    paper,
    sheet: { x: -m, y: -m, w, h },
    border: { x: b - m, y: b - m, w: w - 2 * b, h: h - 2 * b },
    area,
    xs: Array.from({ length: cols + 1 }, (_, i) => (area.w * i) / cols),
    ys: Array.from({ length: rows + 1 }, (_, i) => (area.h * i) / rows),
    titleBlock: { x: area.w - TITLE_BLOCK_W, y: area.h - TITLE_BLOCK_H, w: TITLE_BLOCK_W, h: TITLE_BLOCK_H },
  };
}

/** The diagram's paper (A4 when there is no diagram section). */
export function paperOf(index: DocIndex): Paper {
  return index.doc.diagram?.paper ?? "A4";
}

/** Label of zone row `i` (0-based): A, B, ... skipping I and O. */
export function zoneRowLabel(i: number): string {
  return ROW_LETTERS[i] ?? `R${i + 1}`;
}

/** Zone reference of a point, letter then number ("B4"); undefined outside the drawing area. */
export function zoneOf(frame: SheetFrame, p: Point): string | undefined {
  const { area, xs, ys } = frame;
  if (p.x < area.x || p.y < area.y || p.x > area.x + area.w || p.y > area.y + area.h) return undefined;
  const col = Math.min(Math.floor((p.x / area.w) * (xs.length - 1)), xs.length - 2);
  const row = Math.min(Math.floor((p.y / area.h) * (ys.length - 1)), ys.length - 2);
  return `${zoneRowLabel(row)}${col + 1}`;
}

// ---------------------------------------------------------------- sheets of a document

export interface SheetInfo {
  region: Region;
  /** 1 for the root sheet, then off-page regions in document order. */
  number: number;
  /** Sheet name: the machine's for the root, else the owner state's (with the region's name when it has several). */
  name: string;
  /** KiCad-style path: "/" for the root, "/Owner/Inner" below it. */
  path: string;
}

const sheetCache = new WeakMap<DocIndex, SheetInfo[]>();

/** Name of a sheet as the breadcrumbs show it. */
export function sheetName(index: DocIndex, region: Region): string {
  const owner = index.regions.get(region.id)?.owner;
  if (!owner) return index.doc.name;
  return (owner.regions?.length ?? 0) > 1 ? `${owner.name} · ${region.name ?? region.id}` : owner.name;
}

/** Every sheet of the document, numbered in document order (root first, a sheet before the sheets below it). */
export function sheets(index: DocIndex): SheetInfo[] {
  const cached = sheetCache.get(index);
  if (cached) return cached;
  const out: SheetInfo[] = [];
  const visit = (r: Region, path: string): void => {
    let here = path;
    if (isSheet(index, r)) {
      const root = out.length === 0;
      const name = sheetName(index, r);
      here = root ? "/" : `${path}${name}/`;
      out.push({ region: r, number: out.length + 1, name, path: root ? "/" : here.slice(0, -1) });
    }
    for (const v of r.states) if (v.kind === "state") for (const c of v.regions ?? []) visit(c, here);
  };
  visit(index.doc.machine.root, "");
  sheetCache.set(index, out);
  return out;
}

/** The sheet drawing a region (its own when it is a sheet). */
export function sheetInfo(index: DocIndex, region: Region): SheetInfo {
  const s = sheetOfRegion(index, region);
  return sheets(index).find((x) => x.region === s) ?? { region: s, number: 1, name: sheetName(index, s), path: "/" };
}

/** Where an element is drawn: its sheet and zone (a vertex's centre; a transition's label, else the middle of its route). */
export function locate(index: DocIndex, id: Id): { sheet: SheetInfo; zone: string | undefined } | undefined {
  const frame = sheetFrame(paperOf(index));
  const info = index.vertices.get(id);
  if (info) {
    const b = vertexBox(index, id);
    return { sheet: sheetInfo(index, info.region), zone: zoneOf(frame, { x: b.x + b.w / 2, y: b.y + b.h / 2 }) };
  }
  const t = index.transitions.get(id);
  const g = t && edgeGeometry(index, id);
  if (!t || !g) return undefined;
  const k = Math.floor((g.points.length - 1) / 2);
  const a = g.points[k]!;
  const b = g.points[Math.min(k + 1, g.points.length - 1)]!;
  const p = g.label
    ? { x: g.label.x + LABEL_GAP, y: g.label.y + LABEL_FIRST_LINE - LABEL_LINE_H / 2 }
    : { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  return { sheet: sheetInfo(index, commonRegion(index, t.from, t.to)), zone: zoneOf(frame, p) };
}

/** "sheet 2, C4" (or "sheet 2" outside the drawing area). */
export function locationText(loc: { sheet: SheetInfo; zone: string | undefined }): string {
  return loc.zone ? `sheet ${loc.sheet.number}, ${loc.zone}` : `sheet ${loc.sheet.number}`;
}

// ---------------------------------------------------------------- title block

export type TitleBlockKey =
  | "title"
  | "revision"
  | "description"
  | "path"
  | "sheet"
  | "file"
  | "date"
  | "size"
  | "author"
  | "company"
  | "document";

export interface TitleBlockCell {
  key: TitleBlockKey;
  caption: string;
  value: string;
  /** Cell box in sheet coordinates. */
  box: Box;
  /** Font size of the value (canvas units). */
  size: number;
  bold?: true;
  /** A free field stored in `diagram.titleBlock` (edited in the Project tab). */
  free?: keyof TitleBlock;
}

/** Caption font size (canvas units, 5 pt). */
export const TITLE_CAPTION_SIZE = 10;

/** Rows of the title block: height, then cells (key, caption, width). */
const TB_ROWS: [number, [TitleBlockKey, string, number][]][] = [
  [
    50,
    [
      ["title", "Title", 480],
      ["revision", "Rev", 120],
    ],
  ],
  [35, [["description", "Description", 600]]],
  [
    35,
    [
      ["path", "Sheet path", 480],
      ["sheet", "Sheet", 120],
    ],
  ],
  [
    35,
    [
      ["file", "File", 300],
      ["date", "Date", 180],
      ["size", "Size", 120],
    ],
  ],
  [
    35,
    [
      ["author", "Author", 200],
      ["company", "Company", 200],
      ["document", "Document no.", 200],
    ],
  ],
];

const FREE: Partial<Record<TitleBlockKey, keyof TitleBlock>> = {
  revision: "revision",
  date: "date",
  author: "author",
  company: "company",
  document: "document",
};

/**
 * The title block of a sheet: every cell with its caption, value and box. `fileName` comes from the editor or the CLI
 * (the file does not know its own name).
 */
export function titleBlockCells(index: DocIndex, sheet: Region, opts: { fileName?: string } = {}): TitleBlockCell[] {
  const paper = paperOf(index);
  const tb = sheetFrame(paper).titleBlock;
  const all = sheets(index);
  const me = sheetInfo(index, sheet);
  const free = index.doc.diagram?.titleBlock ?? {};
  const values: Record<TitleBlockKey, string> = {
    title: index.doc.name,
    revision: free.revision ?? "",
    description: (index.doc.doc ?? "").split("\n")[0]!.trim(),
    path: me.path,
    sheet: `${me.number} / ${all.length}`,
    file: opts.fileName ?? "",
    date: free.date ?? "",
    size: paper,
    author: free.author ?? "",
    company: free.company ?? "",
    document: free.document ?? "",
  };
  const out: TitleBlockCell[] = [];
  let y = tb.y;
  for (const [h, cells] of TB_ROWS) {
    let x = tb.x;
    for (const [key, caption, w] of cells) {
      const cell: TitleBlockCell = {
        key,
        caption,
        value: values[key],
        box: { x, y, w, h },
        size: key === "title" ? 24 : key === "revision" ? 18 : 14,
      };
      if (key === "title") cell.bold = true;
      const f = FREE[key];
      if (f) cell.free = f;
      out.push(cell);
      x += w;
    }
    y += h;
  }
  return out;
}

// ---------------------------------------------------------------- fit

export interface SheetFitProblem {
  id: Id;
  sheet: SheetInfo;
  /** `outside`: not inside the drawing area; `title-block`: overlaps the title block. */
  problem: "outside" | "title-block";
}

function within(a: Box, b: Box): boolean {
  return b.x >= a.x && b.y >= a.y && b.x + b.w <= a.x + a.w && b.y + b.h <= a.y + a.h;
}

function overlaps(a: Box, b: Box): boolean {
  return b.x < a.x + a.w && b.x + b.w > a.x && b.y < a.y + a.h && b.y + b.h > a.y;
}

/** Does segment p-q pass through the inside of box r? */
function segmentCrosses(r: Box, p: Point, q: Point): boolean {
  let t0 = 0;
  let t1 = 1;
  const dx = q.x - p.x;
  const dy = q.y - p.y;
  for (const [pk, qk] of [
    [-dx, p.x - r.x],
    [dx, r.x + r.w - p.x],
    [-dy, p.y - r.y],
    [dy, r.y + r.h - p.y],
  ] as const) {
    if (pk === 0) {
      if (qk <= 0) return false;
    } else {
      const t = qk / pk;
      if (pk < 0) t0 = Math.max(t0, t);
      else t1 = Math.min(t1, t);
      if (t0 >= t1) return false;
    }
  }
  return true;
}

/**
 * What does not fit on its sheet: vertices and transition routes outside the drawing area or over the title block, in
 * document order. Only the outermost element is listed: the contents of a listed state, and transitions to or from
 * listed vertices, are not. A transition's label counts as part of it, at the width estimateLabelWidth gives (the
 * editor's font may draw it a little wider or narrower).
 */
export function sheetFit(index: DocIndex): SheetFitProblem[] {
  const frame = sheetFrame(paperOf(index));
  const out: SheetFitProblem[] = [];
  const covered = new Set<Id>();
  for (const [id, info] of index.vertices) {
    const owner: State | undefined = isSheet(index, info.region) ? undefined : index.regions.get(info.region.id)?.owner;
    if (owner && covered.has(owner.id)) {
      covered.add(id);
      continue;
    }
    const b = vertexBox(index, id);
    const problem = !within(frame.area, b) ? "outside" : overlaps(frame.titleBlock, b) ? "title-block" : undefined;
    if (!problem) continue;
    covered.add(id);
    out.push({ id, sheet: sheetInfo(index, sheetOfVertex(index, id)), problem });
  }
  for (const [id, t] of index.transitions) {
    if (covered.has(t.from) || covered.has(t.to)) continue;
    const pts = edgeGeometry(index, id)?.points;
    if (!pts || pts.length < 2) continue;
    const label = transitionLabelBox(index, t);
    const outside =
      pts.some((p) => !within(frame.area, { x: p.x, y: p.y, w: 0, h: 0 })) ||
      (label !== undefined && !within(frame.area, label));
    const over =
      !outside &&
      (pts.some((p, i) => i > 0 && segmentCrosses(frame.titleBlock, pts[i - 1]!, p)) ||
        (label !== undefined && overlaps(frame.titleBlock, label)));
    if (outside || over)
      out.push({
        id,
        sheet: sheetInfo(index, commonRegion(index, t.from, t.to)),
        problem: outside ? "outside" : "title-block",
      });
  }
  return out;
}

/** Design rule message for a fit problem (the editor and the CLI add where: `locate`). */
export function sheetFitMessage(index: DocIndex, p: SheetFitProblem): string {
  const t = index.transitions.get(p.id);
  const what = t
    ? `transition ${vertexName(index, t.from)} -> ${vertexName(index, t.to)}`
    : `state '${vertexName(index, p.id)}'`;
  return p.problem === "outside" ? `${what} lies outside the frame` : `${what} overlaps the title block`;
}
