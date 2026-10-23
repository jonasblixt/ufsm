// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * A Canvas 2D context that writes SVG: the part of CanvasRenderingContext2D render.ts and icons.ts use (paths,
 * rectangles, arcs, text, clipping, save/restore, translate/scale, dashes), recorded as SVG elements in sheet
 * coordinates. The SVG export runs the canvas renderer on it, so the export is drawn by the same code as the screen.
 * Text is measured by a `SvgMeasure` (the browser's canvas in the editor, an estimate in tests). No DOM.
 */

/** Text metrics for the SVG context: widths as `measureText` gives them, and where a baseline lies. */
export interface SvgMeasure {
  /** Width of `text` in CSS font `font`. */
  width(font: string, text: string): number;
  /** How far the alphabetic baseline lies below the `middle` baseline in `font` (SVG text sits on the alphabetic). */
  middleToAlphabetic(font: string): number;
}

/** Widths and baselines without a canvas: ~0.55 em per character, the middle baseline 0.35 em above the alphabetic. */
export const estimatedMeasure: SvgMeasure = {
  width: (font, text) => parseFont(font).size * 0.55 * text.length,
  middleToAlphabetic: (font) => parseFont(font).size * 0.35,
};

/** The parts of a CSS font shorthand the renderer writes (`[italic] [bold] <n>px <family>`). */
interface Font {
  style: string | undefined;
  weight: string | undefined;
  size: number;
  family: string;
}

function parseFont(font: string): Font {
  const m = /^\s*((?:(?:italic|oblique|normal|bold|bolder|lighter|\d{3})\s+)*)([\d.]+)px\s+(.+)$/.exec(font);
  if (!m) return { style: undefined, weight: undefined, size: 10, family: "sans-serif" };
  const words = m[1]!.trim().split(/\s+/);
  return {
    style: words.find((w) => w === "italic" || w === "oblique"),
    weight: words.find((w) => /^(bold|bolder|lighter|\d{3})$/.test(w)),
    size: Number(m[2]),
    family: m[3]!.trim(),
  };
}

/** Numbers as SVG text: at most three decimals, no trailing zeros. */
const num = (v: number): string => String(Math.round(v * 1000) / 1000).replace(/^-0$/, "0");

const escapeText = (s: string): string => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const escapeAttr = (s: string): string => escapeText(s).replace(/"/g, "&quot;");

/** ` name="value"` for every attribute that has a value. */
function attrs(a: Record<string, string | number | undefined>): string {
  let out = "";
  for (const [k, v] of Object.entries(a)) {
    if (v === undefined) continue;
    out += ` ${k}="${typeof v === "number" ? num(v) : escapeAttr(v)}"`;
  }
  return out;
}

/**
 * A CSS color as an SVG paint and its opacity: SVG 1.1 viewers do not all read `rgb(r g b / a)` or 8-digit hex. Reads
 * what the themes produce (tokens.ts `cssColor`: `#rrggbb`, `rgb(r g b / a)`) and the comma forms; anything else is
 * passed through.
 */
function paint(css: string): { color: string; opacity: number | undefined } {
  const hex = (v: number): string =>
    Math.round(Math.min(Math.max(v, 0), 255))
      .toString(16)
      .padStart(2, "0");
  const h = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i.exec(css.trim());
  if (h) {
    const a = h[2] === undefined ? 1 : parseInt(h[2], 16) / 255;
    return { color: `#${h[1]!.toLowerCase()}`, opacity: a >= 1 ? undefined : Math.round(a * 1000) / 1000 };
  }
  const f = /^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+%?))?\s*\)$/i.exec(css.trim());
  if (!f) return { color: css, opacity: undefined };
  const alpha = f[4] === undefined ? 1 : f[4].endsWith("%") ? parseFloat(f[4]) / 100 : parseFloat(f[4]);
  return {
    color: `#${hex(Number(f[1]))}${hex(Number(f[2]))}${hex(Number(f[3]))}`,
    opacity: alpha >= 1 ? undefined : alpha,
  };
}

/** 2D affine matrix [a b c d e f], as in canvas. */
type Matrix = [number, number, number, number, number, number];

interface Drawing {
  fillStyle: string;
  strokeStyle: string;
  lineWidth: number;
  lineCap: CanvasLineCap;
  lineJoin: CanvasLineJoin;
  dash: number[];
  font: string;
  textAlign: CanvasTextAlign;
  textBaseline: CanvasTextBaseline;
  matrix: Matrix;
  /** The id of the clip path in effect. */
  clip: string | undefined;
}

const ANCHOR: Partial<Record<CanvasTextAlign, string>> = { center: "middle", right: "end", end: "end" };

/** The recording context. Hand it to render.ts as a CanvasRenderingContext2D (`asCanvas`), then call `svg()`. */
export class SvgContext {
  private state: Drawing = {
    fillStyle: "#000000",
    strokeStyle: "#000000",
    lineWidth: 1,
    lineCap: "butt",
    lineJoin: "miter",
    dash: [],
    font: "10px sans-serif",
    textAlign: "start",
    textBaseline: "alphabetic",
    matrix: [1, 0, 0, 1, 0, 0],
    clip: undefined,
  };
  private stack: Drawing[] = [];
  /** The current path in sheet coordinates. */
  private path = "";
  /** The current point (sheet coordinates) and the start of the subpath, for arcTo and closePath. */
  private cur: { x: number; y: number } | undefined;
  private start: { x: number; y: number } | undefined;
  private body: string[] = [];
  private defs: string[] = [];
  private clips = 0;

  constructor(private readonly measure: SvgMeasure = estimatedMeasure) {}

  /** This context typed as the canvas's (it implements what the renderer calls). */
  asCanvas(): CanvasRenderingContext2D {
    return this as unknown as CanvasRenderingContext2D;
  }

  // ------------------------------------------------------------ state

  get fillStyle(): string {
    return this.state.fillStyle;
  }
  set fillStyle(v: string) {
    this.state.fillStyle = v;
  }
  get strokeStyle(): string {
    return this.state.strokeStyle;
  }
  set strokeStyle(v: string) {
    this.state.strokeStyle = v;
  }
  get lineWidth(): number {
    return this.state.lineWidth;
  }
  set lineWidth(v: number) {
    this.state.lineWidth = v;
  }
  get lineCap(): CanvasLineCap {
    return this.state.lineCap;
  }
  set lineCap(v: CanvasLineCap) {
    this.state.lineCap = v;
  }
  get lineJoin(): CanvasLineJoin {
    return this.state.lineJoin;
  }
  set lineJoin(v: CanvasLineJoin) {
    this.state.lineJoin = v;
  }
  get font(): string {
    return this.state.font;
  }
  set font(v: string) {
    this.state.font = v;
  }
  get textAlign(): CanvasTextAlign {
    return this.state.textAlign;
  }
  set textAlign(v: CanvasTextAlign) {
    this.state.textAlign = v;
  }
  get textBaseline(): CanvasTextBaseline {
    return this.state.textBaseline;
  }
  set textBaseline(v: CanvasTextBaseline) {
    this.state.textBaseline = v;
  }
  setLineDash(segments: number[]): void {
    this.state.dash = [...segments];
  }
  getLineDash(): number[] {
    return [...this.state.dash];
  }

  save(): void {
    this.stack.push({ ...this.state, dash: [...this.state.dash], matrix: [...this.state.matrix] });
  }
  restore(): void {
    const s = this.stack.pop();
    if (s) this.state = s;
  }
  translate(x: number, y: number): void {
    const [a, b, c, d, e, f] = this.state.matrix;
    this.state.matrix = [a, b, c, d, e + a * x + c * y, f + b * x + d * y];
  }
  scale(sx: number, sy: number): void {
    const [a, b, c, d, e, f] = this.state.matrix;
    this.state.matrix = [a * sx, b * sx, c * sy, d * sy, e, f];
  }

  // ------------------------------------------------------------ paths

  private pt(x: number, y: number): { x: number; y: number } {
    const [a, b, c, d, e, f] = this.state.matrix;
    return { x: a * x + c * y + e, y: b * x + d * y + f };
  }
  /** How much the transform scales lengths (the renderer only scales uniformly). */
  private get k(): number {
    const [a, b, c, d] = this.state.matrix;
    return Math.sqrt(Math.abs(a * d - b * c));
  }
  private to(cmd: "M" | "L", p: { x: number; y: number }): void {
    this.path += `${cmd}${num(p.x)} ${num(p.y)}`;
    this.cur = p;
    if (cmd === "M") this.start = p;
  }

  beginPath(): void {
    this.path = "";
    this.cur = this.start = undefined;
  }
  moveTo(x: number, y: number): void {
    this.to("M", this.pt(x, y));
  }
  lineTo(x: number, y: number): void {
    this.to(this.cur ? "L" : "M", this.pt(x, y));
  }
  closePath(): void {
    if (!this.cur) return;
    this.path += "Z";
    this.cur = this.start;
  }
  rect(x: number, y: number, w: number, h: number): void {
    this.moveTo(x, y);
    this.lineTo(x + w, y);
    this.lineTo(x + w, y + h);
    this.lineTo(x, y + h);
    this.closePath();
  }
  arc(x: number, y: number, r: number, a0: number, a1: number, ccw = false): void {
    const at = (a: number) => this.pt(x + r * Math.cos(a), y + r * Math.sin(a));
    const rr = num(r * this.k);
    let sweep = ccw ? a0 - a1 : a1 - a0;
    const full = sweep >= 2 * Math.PI;
    if (!full) sweep = ((sweep % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
    this.to(this.cur ? "L" : "M", at(a0));
    const flag = ccw ? 0 : 1;
    const arcTo = (a: number, large: boolean): void => {
      const p = at(a);
      this.path += `A${rr} ${rr} 0 ${large ? 1 : 0} ${flag}${num(p.x)} ${num(p.y)}`;
      this.cur = p;
    };
    const dir = ccw ? -1 : 1;
    if (full) {
      // A full circle is two half arcs (one SVG arc cannot end where it starts).
      arcTo(a0 + dir * Math.PI, false);
      arcTo(a0, false);
    } else if (sweep > 0) arcTo(a0 + dir * sweep, sweep > Math.PI);
  }
  arcTo(x1: number, y1: number, x2: number, y2: number, r: number): void {
    if (!this.cur) {
      this.moveTo(x1, y1);
      return;
    }
    // Work in sheet coordinates: the tangent points on p0->p1 and p1->p2 at `r` (scaled) from the corner.
    const p0 = this.cur,
      p1 = this.pt(x1, y1),
      p2 = this.pt(x2, y2),
      rad = r * this.k;
    const v1x = p0.x - p1.x,
      v1y = p0.y - p1.y,
      v2x = p2.x - p1.x,
      v2y = p2.y - p1.y;
    const l1 = Math.hypot(v1x, v1y),
      l2 = Math.hypot(v2x, v2y);
    const cross = v1x * v2y - v1y * v2x;
    if (rad === 0 || l1 === 0 || l2 === 0 || Math.abs(cross) < 1e-9) {
      this.to("L", p1);
      return;
    }
    const cos = (v1x * v2x + v1y * v2y) / (l1 * l2);
    const half = Math.acos(Math.max(-1, Math.min(1, cos))) / 2;
    const t = rad / Math.tan(half);
    const t1 = { x: p1.x + (v1x / l1) * t, y: p1.y + (v1y / l1) * t };
    const t2 = { x: p1.x + (v2x / l2) * t, y: p1.y + (v2y / l2) * t };
    this.to("L", t1);
    // Turning clockwise on screen (y down) is SVG's positive sweep.
    this.path += `A${num(rad)} ${num(rad)} 0 0 ${cross < 0 ? 1 : 0}${num(t2.x)} ${num(t2.y)}`;
    this.cur = t2;
  }

  // ------------------------------------------------------------ painting

  private clipAttr(): string | undefined {
    return this.state.clip && `url(#${this.state.clip})`;
  }
  private fillAttrs(): Record<string, string | number | undefined> {
    const p = paint(this.state.fillStyle);
    return { fill: p.color, "fill-opacity": p.opacity, "clip-path": this.clipAttr() };
  }
  private strokeAttrs(): Record<string, string | number | undefined> {
    const p = paint(this.state.strokeStyle);
    const k = this.k;
    const s = this.state;
    return {
      fill: "none",
      stroke: p.color,
      "stroke-opacity": p.opacity,
      "stroke-width": s.lineWidth * k,
      "stroke-dasharray": s.dash.length ? s.dash.map((v) => num(v * k)).join(" ") : undefined,
      "stroke-linecap": s.lineCap === "butt" ? undefined : s.lineCap,
      "stroke-linejoin": s.lineJoin === "miter" ? undefined : s.lineJoin,
      "clip-path": this.clipAttr(),
    };
  }

  fill(): void {
    if (this.path) this.body.push(`<path${attrs({ d: this.path, ...this.fillAttrs() })}/>`);
  }
  /** Stroke the current path, or SVG path data `d` in the current transform (icons.ts passes its outlines so). */
  stroke(d?: unknown): void {
    if (typeof d === "string") {
      const [a, b, c, dd, e, f] = this.state.matrix;
      const a2 = this.strokeAttrs();
      a2["stroke-width"] = this.state.lineWidth;
      a2["stroke-dasharray"] = undefined;
      // A clip is in sheet coordinates: put it on a group around the transformed outline.
      const clip = a2["clip-path"];
      a2["clip-path"] = undefined;
      const el = `<path${attrs({ d, transform: `matrix(${[a, b, c, dd, e, f].map(num).join(" ")})`, ...a2 })}/>`;
      this.body.push(clip ? `<g clip-path="${clip}">${el}</g>` : el);
      return;
    }
    if (this.path) this.body.push(`<path${attrs({ d: this.path, ...this.strokeAttrs() })}/>`);
  }
  fillRect(x: number, y: number, w: number, h: number): void {
    const p = this.pt(x, y),
      k = this.k;
    this.body.push(`<rect${attrs({ x: p.x, y: p.y, width: w * k, height: h * k, ...this.fillAttrs() })}/>`);
  }
  strokeRect(x: number, y: number, w: number, h: number): void {
    const p = this.pt(x, y),
      k = this.k;
    this.body.push(`<rect${attrs({ x: p.x, y: p.y, width: w * k, height: h * k, ...this.strokeAttrs() })}/>`);
  }
  clip(): void {
    const id = `c${++this.clips}`;
    // Clipping twice intersects: the new clip path is itself clipped by the one in effect.
    const parent = this.clipAttr();
    this.defs.push(
      `<clipPath${attrs({ id, "clip-path": parent })}><path${attrs({ d: this.path || "M0 0" })}/></clipPath>`,
    );
    this.state.clip = id;
  }

  measureText(text: string): TextMetrics {
    return { width: this.measure.width(this.state.font, text) } as TextMetrics;
  }
  fillText(text: string, x: number, y: number): void {
    if (text === "") return;
    const s = this.state;
    const f = parseFont(s.font);
    const k = this.k;
    // SVG text sits on the alphabetic baseline; the renderer uses middle and alphabetic only.
    const shift =
      s.textBaseline === "middle"
        ? this.measure.middleToAlphabetic(s.font)
        : s.textBaseline === "top" || s.textBaseline === "hanging"
          ? f.size * 0.8
          : s.textBaseline === "bottom" || s.textBaseline === "ideographic"
            ? -f.size * 0.2
            : 0;
    const p = this.pt(x, y + shift);
    const el = attrs({
      x: p.x,
      y: p.y,
      "font-family": f.family,
      "font-size": f.size * k,
      "font-weight": f.weight,
      "font-style": f.style,
      "text-anchor": ANCHOR[s.textAlign],
      ...this.fillAttrs(),
    });
    this.body.push(`<text${el}>${escapeText(text)}</text>`);
  }

  // ------------------------------------------------------------ output

  /**
   * The SVG document: `viewBox` in sheet units, shown `width` × `height` (CSS lengths; default the viewBox's size in
   * px), with a `<title>` when given and every element drawn so far.
   */
  svg(
    viewBox: { x: number; y: number; w: number; h: number },
    opts: { width?: string; height?: string; title?: string } = {},
  ): string {
    const head = attrs({
      xmlns: "http://www.w3.org/2000/svg",
      width: opts.width ?? viewBox.w,
      height: opts.height ?? viewBox.h,
      viewBox: [viewBox.x, viewBox.y, viewBox.w, viewBox.h].map(num).join(" "),
      // canvas's miter limit (SVG's default is 4)
      "stroke-miterlimit": 10,
    });
    const title = opts.title ? `<title>${escapeText(opts.title)}</title>\n` : "";
    const defs = this.defs.length ? `<defs>\n${this.defs.join("\n")}\n</defs>\n` : "";
    return `<?xml version="1.0" encoding="UTF-8"?>\n<svg${head}>\n${title}${defs}${this.body.join("\n")}\n</svg>\n`;
  }
}

/** Text metrics from a browser canvas (the same fonts the editor draws with). */
export function canvasMeasure(ctx: CanvasRenderingContext2D): SvgMeasure {
  const shifts = new Map<string, number>();
  return {
    width: (font, text) => {
      ctx.font = font;
      return ctx.measureText(text).width;
    },
    middleToAlphabetic: (font) => {
      let s = shifts.get(font);
      if (s === undefined) {
        ctx.save();
        ctx.font = font;
        ctx.textBaseline = "alphabetic";
        const above = ctx.measureText("H").actualBoundingBoxAscent;
        ctx.textBaseline = "middle";
        const aboveMiddle = ctx.measureText("H").actualBoundingBoxAscent;
        ctx.restore();
        s = Number.isFinite(above - aboveMiddle) ? above - aboveMiddle : parseFont(font).size * 0.35;
        shifts.set(font, s);
      }
      return s;
    },
  };
}
