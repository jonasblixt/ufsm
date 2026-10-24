// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadModel, indexV1, type DocIndex } from "@ufsm/core";
import { PAPER_SIZES } from "@ufsm/core";
import { isOffPage, sheets, sheetFrame, paperOf } from "@ufsm/core/diagram";
import { EXPORT_MARGIN, exportBox, exportTheme, sheetSvg, svgFileName } from "../src/export-svg";
import { sheetBounds } from "../src/hit";
import { DEFAULT_THEME, defaultSettings, parseSettings, serializeSettings } from "../src/settings";
import { SvgContext } from "../src/svg";
import { C } from "../src/theme";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const indexOf = (rel: string): DocIndex => indexV1(loadModel(readFileSync(join(repoRoot, rel), "utf8")).doc);

/** Every element opened is closed, in order (a well-formedness check without an XML parser). */
function assertBalanced(svg: string): void {
  const stack: string[] = [];
  for (const m of svg.replace(/<\?xml[^>]*\?>/, "").matchAll(/<(\/?)([a-zA-Z]+)[^>]*?(\/?)>/g)) {
    const [, close, name, self] = m;
    if (self) continue;
    if (close) assert.equal(stack.pop(), name, `</${name}> closes what was opened`);
    else stack.push(name!);
  }
  assert.deepEqual(stack, [], "every element is closed");
}

const texts = (svg: string): string[] => [...svg.matchAll(/<text[^>]*>([^<]*)<\/text>/g)].map((m) => m[1]!);
const viewBox = (svg: string): number[] => /viewBox="([^"]+)"/.exec(svg)![1]!.split(" ").map(Number);

describe("SVG context", () => {
  it("records fills, strokes, dashes and text in sheet coordinates", () => {
    const g = new SvgContext();
    const ctx = g.asCanvas();
    ctx.translate(10, 20);
    ctx.fillStyle = "#ff0000";
    ctx.fillRect(1, 2, 3, 4);
    ctx.scale(2, 2);
    ctx.strokeStyle = "rgb(0 0 255 / 0.5)";
    ctx.lineWidth = 1.5;
    ctx.setLineDash([4, 2]);
    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(5, 0);
    ctx.stroke();
    ctx.fillStyle = "#000000";
    ctx.font = "bold 9px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText('a < b & "c"', 0, 0);
    const svg = g.svg({ x: 0, y: 0, w: 100, h: 50 }, { title: "T & U" });
    assertBalanced(svg);
    assert.match(svg, /<rect x="11" y="22" width="3" height="4" fill="#ff0000"\/>/);
    // the scale doubles coordinates, widths and dashes; the alpha becomes an opacity (SVG 1.1 viewers)
    assert.match(
      svg,
      /<path d="M10 20L20 20" fill="none" stroke="#0000ff" stroke-opacity="0.5" stroke-width="3" stroke-dasharray="8 4"\/>/,
    );
    assert.match(svg, /font-size="18" font-weight="bold" text-anchor="middle"/);
    assert.deepEqual(texts(svg), ['a &lt; b &amp; "c"']);
    assert.match(svg, /<title>T &amp; U<\/title>/);
    assert.doesNotMatch(svg, /rgb\(/);
  });

  it("draws rounded corners and circles as arcs", () => {
    const g = new SvgContext();
    const ctx = g.asCanvas();
    ctx.beginPath();
    ctx.moveTo(10, 0);
    ctx.arcTo(100, 0, 100, 50, 10);
    ctx.arcTo(100, 50, 0, 50, 10);
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(50, 50, 5, 0, 2 * Math.PI);
    ctx.fill();
    const svg = g.svg({ x: 0, y: 0, w: 100, h: 100 });
    // right then down turns clockwise on screen: SVG's sweep flag 1, the arc ending 10 below the corner
    assert.match(svg, /M10 0L90 0A10 10 0 0 1100 10L100 40A10 10 0 0 190 50/);
    assert.match(svg, /M55 50A5 5 0 0 145 50A5 5 0 0 155 50/);
  });

  it("intersects nested clips and restores them", () => {
    const g = new SvgContext();
    const ctx = g.asCanvas();
    ctx.save();
    ctx.beginPath();
    ctx.rect(0, 0, 10, 10);
    ctx.clip();
    ctx.save();
    ctx.beginPath();
    ctx.rect(5, 5, 10, 10);
    ctx.clip();
    ctx.fillRect(0, 0, 1, 1);
    ctx.restore();
    ctx.fillRect(0, 0, 2, 2);
    ctx.restore();
    ctx.fillRect(0, 0, 3, 3);
    const svg = g.svg({ x: 0, y: 0, w: 10, h: 10 });
    assert.match(svg, /<clipPath id="c2" clip-path="url\(#c1\)">/);
    const rects = [...svg.matchAll(/<rect[^>]*>/g)].map((m) => /clip-path="url\(#(c\d)\)"/.exec(m[0])?.[1]);
    assert.deepEqual(rects, ["c2", "c1", undefined]);
  });
});

describe("SVG export", () => {
  const theme = exportTheme(DEFAULT_THEME);

  it("exports the whole sheet of paper with the frame, at its paper size in pt", () => {
    const index = indexOf("examples/dimmer.ufsm");
    const svg = sheetSvg(index, index.doc.machine.root, { frame: true, theme, fileName: "dimmer.ufsm" });
    assertBalanced(svg);
    const { w, h } = PAPER_SIZES[paperOf(index)];
    assert.deepEqual(viewBox(svg), [0, 0, w, h]);
    assert.match(svg, new RegExp(`width="${w / 2}pt" height="${h / 2}pt"`));
    const t = texts(svg);
    for (const name of ["Off", "On", "dimmer.ufsm", "1", "A"]) assert.ok(t.includes(name), `draws "${name}"`);
    // paper, not the editor's dark background; no grid dots
    assert.match(svg, new RegExp(`<rect x="0" y="0" width="${w}" height="${h}" fill="${theme.canvas.paper}"/>`));
    assert.doesNotMatch(svg, /width="2" height="2"/);
  });

  it("leaves the frame out on request: the diagram's bounds plus a margin", () => {
    const index = indexOf("examples/dimmer.ufsm");
    const root = index.doc.machine.root;
    const svg = sheetSvg(index, root, { frame: false, theme, fileName: "dimmer.ufsm" });
    assertBalanced(svg);
    const box = exportBox(index, root, false);
    const [, , w, h] = viewBox(svg);
    assert.deepEqual([w, h], [box.w, box.h]);
    const frame = sheetFrame(paperOf(index));
    assert.ok(box.w < frame.sheet.w && box.h < frame.sheet.h);
    const b = sheetBounds(index, root)!;
    assert.equal(box.x, b.x0 - EXPORT_MARGIN);
    const t = texts(svg);
    assert.ok(t.includes("Off") && t.includes("On"));
    assert.ok(!t.includes("dimmer.ufsm"), "no title block");
  });

  it("exports an off-page sheet with its own number and contents", () => {
    const index = indexOf("tests/models/canvas.ufsm");
    const all = sheets(index);
    const second = all.find((s) => s.number === 2);
    assert.ok(second && isOffPage(index, second.region.id), "canvas.ufsm has off-page sheets");
    const svg = sheetSvg(index, second.region, { frame: true, theme });
    assertBalanced(svg);
    assert.match(svg, new RegExp(`<title>${index.doc.name}, sheet 2: `));
  });

  it("draws in the export colors and puts the editor's back", () => {
    const before = { ...C };
    const index = indexOf("examples/dimmer.ufsm");
    const svg = sheetSvg(index, index.doc.machine.root, { frame: true, theme });
    assert.deepEqual(C, before);
    assert.equal(theme.appearance, "light");
    assert.ok(svg.includes(`fill="${theme.canvas.ink}"`) || svg.includes(`stroke="${theme.canvas.ink}"`));
    // translucent colors (the title block's captions, washes) as a color and an opacity
    assert.doesNotMatch(svg, /rgba?\(/);
    assert.match(svg, /fill-opacity="0\.\d+"/);
  });

  it("names the file after the model and the sheet", () => {
    assert.equal(svgFileName("dimmer.ufsm", 1), "dimmer.svg");
    assert.equal(svgFileName("canvas.ufsm", 3), "canvas-sheet3.svg");
    assert.equal(svgFileName("untitled", 1), "untitled.svg");
  });
});

describe("settings.json exportFrame", () => {
  it("defaults to the frame, writes only false, reports other values", () => {
    assert.equal(defaultSettings().exportFrame, true);
    const off = parseSettings('{"theme": {"name": "gruvbox", "appearance": "dark"}, "exportFrame": false}');
    assert.deepEqual(off.problems, []);
    assert.equal(off.settings.exportFrame, false);
    assert.deepEqual(off.settings.other, {});
    assert.match(serializeSettings(off.settings), /"exportFrame": false/);
    assert.doesNotMatch(serializeSettings(defaultSettings()), /exportFrame/);
    const bad = parseSettings('{"exportFrame": "no"}');
    assert.equal(bad.settings.exportFrame, true);
    assert.equal(bad.problems.length, 1);
  });
});
