// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

/**
 * Browser check of the editor (optional; not part of `npm test`): bundles apps/editor/src/main.ts with esbuild
 * (@tauri-apps/* stubbed), serves it, and drives it with Playwright through `window.ufsm`: selection, drag, resize,
 * region separators, transition handles, labels, undo/redo, pan/zoom; then the window layout (menus, search field,
 * Properties/Project panel, panel keys, sash), several machines in tabs, File › New, and adding and deleting (tools, transitions,
 * regions, bend points, Delete, copy/cut/paste), and properties: names, actions, triggers, guards, internal transitions,
 * regions, declarations, code generator options (incl. debugInfo and trace) and the Problems tab; then the simulator (F5, events, guards, the
 * canvas highlight, the log, saved traces, going out of date, a model with errors), the code preview and the Settings tab
 * (color themes: all gruvbox variants, Everforest, Solarized and Catppuccin dark and light, Catppuccin's flavor, following
 * the OS, kept across a reload; UI zoom: keys, View menu, the tab's buttons, limits, the sash, kept across a reload, the
 * canvas never zoomed), the search field, and the sheet frame and title block (frame lines, zones, the off-page marker's
 * sheet number, the free fields from the Project tab, a double-click and the search, fit findings with sheet and zone).
 *
 *   node apps/editor/test/browser/check.mjs [model.ufsm] [screenshot-dir]
 *
 * Needs `esbuild` and `playwright` (with a Chromium) resolvable from the repository, or from the directory in
 * UFSM_NODE_TOOLS (a node_modules parent). The default model is edit.ufsm next to this file; the checks expect it.
 */
import { createRequire } from "node:module";
import { createServer } from "node:http";
import { mkdtempSync, readFileSync, writeFileSync, copyFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, extname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const repo = join(here, "..", "..", "..", "..");
const req = createRequire(join(process.env.UFSM_NODE_TOOLS ?? repo, "noop.js"));
const { build } = req("esbuild");
const { chromium } = req("playwright");
const modelPath = process.argv[2] ?? join(here, "edit.ufsm");
const shots = process.argv[3];

// ---------------------------------------------------------------- bundle
const web = mkdtempSync(join(tmpdir(), "ufsm-editor-"));
const stub = {
  name: "stub-tauri",
  setup(b) {
    b.onResolve({ filter: /^@tauri-apps\// }, (a) => ({ path: a.path, namespace: "stub" }));
    b.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
      contents:
        "export const invoke = async () => { throw new Error('no tauri'); }; export const open = async () => null; export const save = async () => null; export const ask = async () => false; export const readTextFile = async () => { throw new Error('no tauri'); }; export const writeTextFile = readTextFile; export const getCurrentWindow = () => ({ setTitle: async () => {} }); export default {};",
      loader: "js",
    }));
  },
};
// @ufsm/core and its subpath entries, as packages/core/package.json maps them to source files
const coreExports = JSON.parse(readFileSync(join(repo, "packages/core/package.json"), "utf8")).exports;
const core = {
  name: "ufsm-core",
  setup(b) {
    b.onResolve({ filter: /^@ufsm\/core(\/.*)?$/ }, (a) => ({
      path: join(repo, "packages/core", coreExports[`.${a.path.slice("@ufsm/core".length)}`]),
    }));
  },
};
await build({
  entryPoints: [join(repo, "apps/editor/src/main.ts")],
  bundle: true,
  format: "esm",
  outfile: join(web, "main.js"),
  plugins: [stub, core],
  nodePaths: [join(repo, "node_modules")],
  logLevel: "warning",
});
writeFileSync(
  join(web, "index.html"),
  readFileSync(join(repo, "apps/editor/index.html"), "utf8")
    .replace("/src/main.ts", "/main.js")
    .replace("/src/style.css", "/style.css"),
);
copyFileSync(join(repo, "apps/editor/src/style.css"), join(web, "style.css"));

// ---------------------------------------------------------------- serve and check
const server = createServer((q, r) => {
  const f = join(web, q.url === "/" ? "index.html" : q.url.split("?")[0]);
  try {
    const b = readFileSync(f);
    r.writeHead(200, {
      "content-type":
        { ".js": "text/javascript", ".css": "text/css", ".html": "text/html" }[extname(f)] ??
        "application/octet-stream",
    });
    r.end(b);
  } catch {
    r.writeHead(404);
    r.end();
  }
}).listen(0);
const url = `http://127.0.0.1:${server.address().port}/`;
const browser = await chromium.launch();
// The theme follows the OS by default; the pixel checks below expect gruvbox dark.
const page = await browser.newPage({ viewport: { width: 1400, height: 900 }, colorScheme: "dark" });
const errors = [];
page.on("pageerror", (e) => errors.push(String(e)));
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(url);
const text = readFileSync(modelPath, "utf8");
await page.evaluate(([t]) => window.ufsm.load(t, "edit.ufsm"), [text]);
await page.waitForTimeout(300);
let pass = 0,
  fail = 0;
const check = (name, ok, info = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${ok ? "" : "  " + info}`);
};
const U = (fn, ...a) => page.evaluate(([f, a]) => window.ufsm[f](...a), [fn, a]);
const w2s = (x, y) => U("worldToScreen", x, y);
const scale = async () => {
  const [a] = await w2s(0, 0),
    [b] = await w2s(100, 0);
  return (b - a) / 100;
};
const box = (id) => U("box", id);
const center = async (id, dy = 0) => {
  const b = await box(id);
  return w2s(b.x + b.w / 2, b.y + b.h / 2 + dy);
};
async function drag(from, to, opts = {}) {
  await page.mouse.move(from[0], from[1]);
  await page.mouse.down();
  const steps = 6;
  for (let i = 1; i <= steps; i++)
    await page.mouse.move(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps);
  if (opts.esc) {
    await page.keyboard.press("Escape");
    await page.mouse.up();
    return;
  }
  await page.mouse.up();
}
const sel = () => U("selectedIds");
const handles = () => U("handles");
const k = await scale();
/** The canvas pixel at a client point, as [r, g, b]. */
const pixel = (x, y) =>
  page.evaluate(
    async ([x, y]) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r))); // the canvas redraws on the next frame
      const c = document.getElementById("canvas"),
        r = c.getBoundingClientRect(),
        d = window.devicePixelRatio || 1;
      return [
        ...c.getContext("2d").getImageData(Math.round((x - r.left) * d), Math.round((y - r.top) * d), 1, 1).data,
      ].slice(0, 3);
    },
    [x, y],
  );
const cursor = () => page.evaluate(() => document.getElementById("canvas").style.cursor);
// gruvbox dark medium: the selection color (orange), the sheet (bg0)
const ORANGE = "254,128,25",
  SHEET = "40,40,40";

// 1. click selects a state; it shows 8 resize handles
let [x, y] = await center("s3");
await page.mouse.click(x, y);
check("click selects A", JSON.stringify(await sel()) === '["s3"]', JSON.stringify(await sel()));
check("a selected state has 8 resize handles", (await handles()).filter((h) => h.kind === "resize").length === 8);
{
  const sb = await box("s3");
  const [ex, ey] = await w2s(sb.x, sb.y + sb.h / 2),
    [cx1, cy1] = await w2s(sb.x + sb.w, sb.y + sb.h);
  const onEdge = await pixel(ex, ey);
  const outside = await pixel(ex - 6, ey);
  const corner = await pixel(cx1 + 4, cy1 + 4);
  check(
    "the selected state is drawn in the selection color, with no box or handle squares around it",
    onEdge.join() === ORANGE && outside.join() === SHEET && corner.join() === SHEET,
    JSON.stringify([onEdge, outside, corner]),
  );
}

// 2. drag A: snapped to the grid, inside its band; one undo step
const a0 = await box("s3");
await drag([x, y], [x + 37 * k, y + 23 * k]);
const a1 = await box("s3");
check("drag moves A, snapped to the grid", a1.x === 160 && a1.y === 170, JSON.stringify(a1));
check("the document is dirty and can undo", (await U("isDirty")) && (await U("canUndo")));
await page.keyboard.press("Control+z");
check("Ctrl+Z undoes the move", JSON.stringify(await box("s3")) === JSON.stringify(a0) && !(await U("isDirty")));
await page.keyboard.press("Control+r");
check("Ctrl+R redoes it", JSON.stringify(await box("s3")) === JSON.stringify(a1));
await page.keyboard.press("Control+z");

// 3. A cannot leave its region band
[x, y] = await center("s3");
await drag([x, y], [x, y + 400 * k]);
let b = await box("s3");
check("A stops at the bottom of its band (y 130..260)", b.y + b.h === 260, JSON.stringify(b));
await page.keyboard.press("Control+z");

// 4. Esc cancels a drag and keeps the selection
const before = await U("serialize");
[x, y] = await center("s3");
await drag([x, y], [x + 50 * k, y], { esc: true });
check("Esc cancels the drag", (await U("serialize")) === before);
check("...and keeps the selection", JSON.stringify(await sel()) === '["s3"]', JSON.stringify(await sel()));

// 5. resize with the bottom-right handle
let h = (await handles()).find((h) => h.kind === "resize" && h.edges.join() === "right,bottom");
await drag(h.screen, [h.screen[0] + 42 * k, h.screen[1] + 18 * k]);
b = await box("s3");
check("bottom-right handle resizes A to 140 x 80", b.w === 140 && b.h === 80, JSON.stringify(b));
await page.keyboard.press("Control+z");

// 5b. no handle boxes: a side resizes wherever it is grabbed, a corner both ways
{
  const sb = await box("s3");
  const [qx, qy] = await w2s(sb.x + sb.w, sb.y + sb.h * 0.2);
  await page.mouse.move(qx + 3, qy);
  check(
    "over the right side (away from its middle) the cursor shows a horizontal resize",
    (await cursor()) === "ew-resize",
    await cursor(),
  );
  await drag([qx + 3, qy], [qx + 3 + 31 * k, qy + 17 * k]);
  b = await box("s3");
  check(
    "dragging the right side anywhere along it changes the width only",
    b.w === sb.w + 30 && b.h === sb.h && b.x === sb.x && b.y === sb.y,
    JSON.stringify(b),
  );
  await page.keyboard.press("Control+z");
  const [tx, ty] = await w2s(sb.x + sb.w * 0.8, sb.y);
  await page.mouse.move(tx, ty - 3);
  check("over the top side: a vertical resize cursor", (await cursor()) === "ns-resize", await cursor());
  await drag([tx, ty - 3], [tx, ty - 3 - 20 * k]);
  b = await box("s3");
  check(
    "dragging the top side moves the top edge only",
    b.y === sb.y - 20 && b.h === sb.h + 20 && b.w === sb.w,
    JSON.stringify(b),
  );
  await page.keyboard.press("Control+z");
  const [cx0, cy0] = await w2s(sb.x, sb.y);
  await page.mouse.move(cx0 - 5, cy0 + 4);
  check("near the top-left corner: a diagonal resize cursor", (await cursor()) === "nwse-resize", await cursor());
  await drag([cx0 - 5, cy0 + 4], [cx0 - 5 - 20 * k, cy0 + 4 - 10 * k]);
  b = await box("s3");
  check(
    "dragging a corner resizes in x and y",
    b.x === sb.x - 20 && b.y === sb.y - 10 && b.w === sb.w + 20 && b.h === sb.h + 10,
    JSON.stringify(b),
  );
  await page.keyboard.press("Control+z");
  const [mx, my] = await w2s(sb.x + sb.w / 2, sb.y + sb.h / 2);
  await page.mouse.move(mx, my);
  check("inside the state the cursor still moves it", (await cursor()) === "move", await cursor());
}

// 6. pressing an unselected state drags it (and selects it)
[x, y] = await center("s5");
await drag([x, y], [x + 30 * k, y + 30 * k]);
check(
  "dragging C selects and moves it",
  JSON.stringify(await sel()) === '["s5"]' && (await box("s5")).x === 730,
  JSON.stringify(await box("s5")),
);
await page.keyboard.press("Control+z");

// 7. inside a composite's empty band a drag draws a rubber band; its header moves it
const p0 = await box("s2");
let [px, py] = await w2s(p0.x + 390, p0.y + 290); // empty corner of band r2
await drag([px, py], [px - 30 * k, py - 30 * k]);
check("drag in P's empty band does not move P", JSON.stringify(await box("s2")) === JSON.stringify(p0));
[px, py] = await w2s(p0.x + 200, p0.y + 15);
await drag([px, py], [px + 20 * k, py + 10 * k]);
const p1 = await box("s2"),
  a2 = await box("s3");
check(
  "dragging P's header moves P and its contents",
  p1.x === p0.x + 20 && p1.y === p0.y + 10 && a2.x === a0.x + 20 && a2.y === a0.y + 10,
  JSON.stringify([p1, a2]),
);
await page.keyboard.press("Control+z");

// 8. region separator
await page.mouse.click(...(await w2s(p0.x + 200, p0.y + 15)));
h = (await handles()).find((h) => h.kind === "split");
check("selected P has a separator handle", !!h);
await drag([h.screen[0] - 100 * k, h.screen[1]], [h.screen[0] - 100 * k, h.screen[1] + 22 * k]); // grabbed anywhere along the line
check(
  "dragging the separator sets r1's height to 150",
  /"r1": \{ "h": 150 \}/.test(await U("serialize")),
  (await U("serialize")).match(/"regions": \{[^}]*\}[^}]*\}/)?.[0],
);
await page.keyboard.press("Control+z");

// 9. transitions: click a line selects it; S end handles pin and unpin
let r = await U("route", "t3");
let mid = [(r.points[0].x + r.points[1].x) / 2, (r.points[0].y + r.points[1].y) / 2];
await page.mouse.click(...(await w2s(...mid)));
check("click on a transition line selects it", JSON.stringify(await sel()) === '["t3"]', JSON.stringify(await sel()));
let ends = (await handles()).filter((h) => h.kind === "end");
check("an automatic S route shows two unpinned end handles", ends.length === 2 && ends.every((e) => !e.pinned));
const c = await box("s5");
h = ends.find((e) => e.end === "to");
await drag(h.screen, await w2s(c.x + 60, c.y - 3));
check(
  "dragging the end pins it on C's top",
  /"t3": \{ "route": "s", "to": \{ "side": "top", "offset": 60 \} \}/.test(await U("serialize")),
  (await U("serialize")).match(/"t3": .*/)?.[0],
);
h = (await handles()).find((e) => e.kind === "end" && e.end === "to");
check("the pinned end shows as pinned", h.pinned === true);
await page.mouse.dblclick(...h.screen);
check(
  "double-click unpins it",
  /"t3": \{ "route": "s" \}/.test(await U("serialize")),
  (await U("serialize")).match(/"t3": .*/)?.[0],
);
check("...as an undo step", await U("canUndo"));

// 10. S jog
r = await U("route", "t4");
const seg = r.points.findIndex((p, i) => i > 0 && p.x === 600 && r.points[i - 1].x === 600);
await page.mouse.click(...(await w2s(600, (r.points[seg].y + r.points[seg - 1].y) / 2)));
h = (await handles()).find((e) => e.kind === "jog");
check("selected t4 has a jog handle", !!h && JSON.stringify(await sel()) === '["t4"]', JSON.stringify(await sel()));
await drag(h.screen, [h.screen[0] + 33 * k, h.screen[1] + 50 * k]);
check(
  "dragging the jog moves it along its axis only (x 630)",
  /"t4": \{ "route": "s", "jog": \{ "x": 630 \} \}/.test(await U("serialize")),
  (await U("serialize")).match(/"t4": .*/)?.[0],
);
h = (await handles()).find((e) => e.kind === "jog");
await page.mouse.dblclick(...h.screen);
check(
  "double-click on the jog resets it",
  /"t4": \{ "route": "s" \}/.test(await U("serialize")),
  (await U("serialize")).match(/"t4": .*/)?.[0],
);

// 11. labels drag directly (selecting the transition)
r = await U("route", "t5");
await drag(await w2s(r.label.x + 10, r.label.y + 36), await w2s(r.label.x + 31, r.label.y + 58));
check(
  "dragging t5's label selects it and moves the label",
  JSON.stringify(await sel()) === '["t5"]' &&
    JSON.stringify((await U("route", "t5")).label) === JSON.stringify({ x: 540, y: 120, w: 150 }),
  JSON.stringify((await U("route", "t5")).label),
);
{
  // moving the target of a free route: its bend points stay (on the grid), only the last segment changes
  const via = async () => JSON.stringify(JSON.parse(await U("serialize")).diagram.transitions.t5.via);
  const before = await via(),
    c0 = await box("s5"),
    from = await center("s5", 20);
  await drag(from, [from[0] + 33 * k, from[1] + 47 * k]);
  const after = await via(),
    c1 = await box("s5"),
    pts = (await U("route", "t5")).points;
  check(
    "moving the target of a free route keeps its bend points; the last segment follows",
    c1.x !== c0.x && c1.y !== c0.y && after === before && pts.every((p) => p.x % 10 === 0 && p.y % 10 === 0),
    JSON.stringify([c0, c1, before, after, pts]),
  );
  await page.keyboard.press("Control+z");
}

// 12. free bend points
r = await U("route", "t2");
await page.mouse.click(...(await w2s((r.points[0].x + r.points[1].x) / 2, (r.points[0].y + r.points[1].y) / 2)));
h = (await handles()).find((e) => e.kind === "bend");
check(
  "a free route shows its bend point",
  !!h && JSON.stringify(await sel()) === '["t2"]',
  JSON.stringify(await sel()),
);
await drag(h.screen, [h.screen[0] + 12 * k, h.screen[1] + 9 * k]);
check(
  "dragging the bend point moves it, snapped",
  JSON.stringify((await U("route", "t2")).points[1]) === JSON.stringify({ x: 180, y: 330 }),
  JSON.stringify((await U("route", "t2")).points),
);
check(
  "a click on a handle keeps the selection",
  await (async () => {
    const hh = (await handles()).find((e) => e.kind === "bend");
    await page.mouse.click(...hh.screen);
    return JSON.stringify(await sel()) === '["t2"]';
  })(),
);

// 13. multi-selection moves together; transitions follow
await U("select", ["s3", "s5"]);
const c0 = await box("s5");
[x, y] = await center("s3");
await drag([x, y], [x, y + 20 * k]);
check(
  "a multi-selection moves together",
  (await box("s5")).y === c0.y + 20 && (await box("s3")).y === a0.y + 20,
  JSON.stringify([await box("s3"), await box("s5")]),
);

// 14. hover cursor
await page.mouse.click(...(await center("s5")));
h = (await handles()).find((e) => e.kind === "resize" && e.edges.join() === "left,top");
await page.mouse.move(...h.screen);
check(
  "hovering a corner handle shows a resize cursor",
  (await page.evaluate(() => document.getElementById("canvas").style.cursor)) === "nwse-resize",
);

// 15. everything undoes back to the file
for (let i = 0; i < 30; i++) await page.keyboard.press("Control+z");
check("undoing everything gives the file back, not dirty", (await U("serialize")) === text && !(await U("isDirty")));
await page.keyboard.press("Control+r");
check("redo still works after undoing everything", (await U("serialize")) !== text);
for (let i = 0; i < 30; i++) await page.keyboard.press("Control+r");
check("redo all", !(await U("canRedo")));

// 16. the rubber band and plain clicks still work
await page.mouse.click(...(await w2s(650, 450)));
check("click on empty canvas clears the selection", (await sel()).length === 0, JSON.stringify(await sel()));
const [lx, ly] = await w2s(20, 20),
  [rx, ry] = await w2s(900, 600);
await drag([lx, ly], [rx, ry]);
check("rubber band from outside selects everything", (await sel()).length === 12, JSON.stringify(await sel()));

// 17. E1 behaviour around the new grips
const doc17 = await U("serialize");
let [ax, ay] = await center("s3");
const v0 = await w2s(0, 0);
await page.mouse.move(ax, ay);
await page.mouse.down({ button: "right" });
for (let i = 1; i <= 5; i++) await page.mouse.move(ax + i * 10, ay + i * 5);
await page.mouse.up({ button: "right" });
const v1 = await w2s(0, 0);
check(
  "right-drag on a state pans and does not move it",
  Math.round(v1[0] - v0[0]) === 50 && Math.round(v1[1] - v0[1]) === 25 && (await U("serialize")) === doc17,
  JSON.stringify([v0, v1]),
);
const k0 = await scale();
await page.mouse.move(ax, ay);
await page.mouse.wheel(0, -200);
await page.waitForTimeout(50);
check("wheel zooms", (await scale()) > k0);
// the wheel also zooms while panning (right button held), before and after the pointer has moved
{
  const doc = await U("serialize");
  [ax, ay] = await center("s3");
  const kA = await scale();
  await page.mouse.move(ax, ay);
  await page.mouse.down({ button: "right" });
  await page.mouse.wheel(0, -200);
  await page.waitForTimeout(50);
  const kB = await scale();
  for (let i = 1; i <= 3; i++) await page.mouse.move(ax + i * 10, ay);
  await page.mouse.wheel(0, 300);
  await page.waitForTimeout(50);
  const kC = await scale();
  const o1 = await w2s(0, 0);
  await page.mouse.move(ax + 30 + 40, ay + 20);
  const o2 = await w2s(0, 0);
  await page.mouse.up({ button: "right" });
  check(
    "the wheel zooms with the right button held (before and while panning)",
    kB > kA && kC < kB,
    JSON.stringify([kA, kB, kC]),
  );
  check(
    "...and panning goes on from the zoomed view; nothing is edited",
    Math.abs(o2[0] - o1[0] - 40) <= 1 && Math.abs(o2[1] - o1[1] - 20) <= 1 && (await U("serialize")) === doc,
    JSON.stringify([o1, o2]),
  );
}
[ax, ay] = await center("s3");
await page.mouse.dblclick(ax, ay);
check(
  "double-click on a state selects it and zooms in",
  JSON.stringify(await sel()) === '["s3"]' && (await U("serialize")) === doc17,
);
await page.keyboard.press("Escape");
check("Esc clears the selection", (await sel()).length === 0);
await page.mouse.click(...(await center("s3")));
await page.keyboard.down("Shift");
await page.mouse.click(...(await center("s6")));
await page.keyboard.up("Shift");
check(
  "Shift-click adds to the selection (and does not drag)",
  (await sel()).sort().join() === "s3,s6" && (await U("serialize")) === doc17,
  JSON.stringify(await sel()),
);

if (shots) {
  await page.mouse.click(...(await center("s2", -140)));
  await page.screenshot({ path: `${shots}/edit-selected.png` });
}
// 13. window layout (VS Code style): title bar menus and search, explorer, tabs, Properties/Project panel
const $text = (sel) => page.evaluate((s) => document.querySelector(s)?.textContent ?? null, sel);
const $count = (sel) => page.evaluate((s) => document.querySelectorAll(s).length, sel);
const $visible = (sel) =>
  page.evaluate((s) => {
    const e = document.querySelector(s);
    return !!e && e.getBoundingClientRect().width > 0;
  }, sel);
const canvasW = () => page.evaluate(() => document.getElementById("canvas").getBoundingClientRect().width);
const menuLabels = await page.evaluate(() => [...document.querySelectorAll(".menu-label")].map((b) => b.textContent));
check(
  "title bar has the menus File Edit Add View Go Run Help",
  menuLabels.join() === "File,Edit,Add,View,Go,Run,Help",
  menuLabels.join(),
);
check(
  "search field names the active machine",
  (await page.getAttribute("#search", "placeholder")) === "Search edit.ufsm",
);
await U("select", ["s3"]);
check(
  "Properties shows the selected state",
  (await $text(".pheader .name")) === "A" && (await $text(".pheader .kind")) === "State",
);
await U("select", ["t2"]);
check(
  "Properties shows the selected transition",
  (await $text(".pheader .kind")) === "Transition" && (await $text(".pheader .name")) === "A → B",
  await $text(".pheader .name"),
);
await page.click(".pbody .link"); // From: A
check("a link in Properties selects that state", JSON.stringify(await sel()) === '["s3"]', JSON.stringify(await sel()));
await page.click("#search");
await page.keyboard.type("np");
check("typing in the search field triggers no shortcuts", (await $visible("#sidebar")) && (await $visible("#panel")));
await page.keyboard.press("Escape");
check(
  "Esc in the search field leaves the selection",
  JSON.stringify(await sel()) === '["s3"]' && (await page.evaluate(() => document.activeElement?.id)) !== "search",
);
let w0 = await canvasW();
await page.keyboard.press("p");
check("p hides the right panel and the canvas grows", !(await $visible("#panel")) && (await canvasW()) > w0 + 200);
await page.keyboard.press("p");
check("p shows it again", (await $visible("#panel")) && Math.abs((await canvasW()) - w0) < 1);
await page.keyboard.press("n");
check("n hides the explorer", !(await $visible("#sidebar")) && (await canvasW()) > w0 + 150);
await page.keyboard.press("n");
await page.click(".menu-label >> text=View");
check("clicking View opens its menu", (await $count(".menu-dropdown")) === 1);
if (shots) await page.screenshot({ path: `${shots}/menu-view.png` });
await page.keyboard.press("Escape");
check(
  "Esc closes the menu and keeps the selection",
  (await $count(".menu-dropdown")) === 0 && JSON.stringify(await sel()) === '["s3"]',
);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Project");
check(
  "View › Project shows the Project tab",
  (await $text(".panel-tab.active")) === "Project" && /Code generator/.test(await $text(".panel-body")),
);
{
  const paperOf = async () => JSON.parse(await U("serialize")).diagram.paper;
  const p0 = await paperOf();
  await page.selectOption('select[aria-label="Paper size"]', "A2");
  check(
    "Project › Paper changes the sheet size (one undo step)",
    (await paperOf()) === "A2" && p0 === "A4" && (await U("canUndo")),
    String(await paperOf()),
  );
  check("no warning while everything fits", (await $count(".paper-warn")) === 0);
  await U("undo");
  check(
    "undo gives A4 back",
    (await paperOf()) === "A4" && (await page.$eval('select[aria-label="Paper size"]', (e) => e.value)) === "A4",
  );
}
if (shots) await page.screenshot({ path: `${shots}/project-tab.png` });
await page.click(".panel-tab >> text=Properties");
check("the Properties tab comes back", (await $text(".pheader .name")) === "A");
const sw = await page.evaluate(() => document.getElementById("sidebar").getBoundingClientRect().width);
const sb = await page.evaluate(() => {
  const r = document.getElementById("sash-left").getBoundingClientRect();
  return [r.x + r.width / 2, r.y + 200];
});
await drag(sb, [sb[0] + 80, sb[1]]);
check(
  "dragging the left sash widens the explorer",
  Math.round((await page.evaluate(() => document.getElementById("sidebar").getBoundingClientRect().width)) - sw) === 80,
);
await page.dblclick("#sash-left");

// 14. several machines in tabs, each with its own selection, view and undo history
const firstView = await U("view");
const firstDoc = await U("serialize");
await page.evaluate(([t]) => window.ufsm.load(t, "second.ufsm"), [text]);
await page.waitForTimeout(100);
let tabs = await U("tabs");
check(
  "opening a second machine adds a tab and makes it active",
  tabs.length === 2 && tabs[1].active && (await $count(".tab")) === 2 && (await $count(".machine")) === 2,
);
check("the new tab starts with no selection and no undo", (await sel()).length === 0 && !(await U("canUndo")));
await drag(
  ...[
    await center("s3"),
    await w2s((await box("s3")).x + 20 + (await box("s3")).w / 2, (await box("s3")).y + (await box("s3")).h / 2),
  ].map((p) => p),
);
check(
  "an edit marks only the second tab dirty",
  (await U("tabs"))[1].dirty && (await $count(".tab.dirty")) === ((await U("tabs"))[0].dirty ? 2 : 1),
);
await page.keyboard.press("Control+Tab");
tabs = await U("tabs");
check("Ctrl+Tab switches to the first tab", tabs[0].active && (await U("serialize")) === firstDoc);
check(
  "...with its selection and view",
  JSON.stringify(await sel()) === '["s3"]' && JSON.stringify(await U("view")) === JSON.stringify(firstView),
  JSON.stringify([await U("view"), firstView]),
);
await page.keyboard.press("Control+Shift+Tab");
check(
  "Ctrl+Shift+Tab goes back",
  (await U("tabs"))[1].active && JSON.stringify(await sel()) === '["s3"]' && (await U("canUndo")),
);
if (shots) await page.screenshot({ path: `${shots}/two-tabs.png` });
await page.click(".machine:nth-of-type(1) > summary .machine-name", { force: true }).catch(() => undefined);
await page.evaluate(() => document.querySelectorAll(".machine > summary")[0].click());
check("clicking a machine in the explorer activates it", (await U("tabs"))[0].active);
await page.click(".tab:nth-child(2)");
check("clicking a tab activates it", (await U("tabs"))[1].active);
let asked = "";
page.once("dialog", (d) => {
  asked = d.message();
  void d.dismiss();
});
await page.click(".tab:nth-child(2) .tab-close");
await page.waitForTimeout(50);
check(
  "closing a dirty tab asks first; Cancel keeps it",
  /second\.ufsm has unsaved changes/.test(asked) && (await U("tabs")).length === 2,
  asked,
);
page.once("dialog", (d) => void d.accept());
await page.click(".tab:nth-child(2) .tab-close");
await page.waitForTimeout(50);
tabs = await U("tabs");
check(
  "...and Discard closes it, showing the first again",
  tabs.length === 1 && tabs[0].active && (await $count(".machine")) === 1 && (await U("serialize")) === firstDoc,
);
await U("closeTab", 0, true);
check(
  "closing the last tab shows the empty state",
  (await U("tabs")).length === 0 &&
    (await $visible("#empty")) &&
    (await $visible("#explorer-empty")) &&
    /No machine open/.test(await $text(".panel-body")),
);
if (shots) await page.screenshot({ path: `${shots}/empty.png` });

// 14b. File › New: empty machines named untitled, untitled2, ...; added to like any other, saved under that name
const Jn = async () => JSON.parse(await U("serialize"));
const newTabs = async () => (await U("tabs")).map((t) => `${t.name}${t.active ? "*" : ""}${t.dirty ? "+" : ""}`).join();
check(
  "the empty explorer offers New next to Open…",
  (await $visible("#explorer-new")) && (await $visible("#explorer-open")),
);
await page.click("#explorer-new");
await page.waitForTimeout(100);
let nd = await Jn();
check(
  "New opens an empty machine called untitled, clean, nothing to undo",
  (await newTabs()) === "untitled.ufsm*" &&
    nd.name === "untitled" &&
    nd.machine.root.states.length === 0 &&
    !(await U("canUndo")) &&
    !(await $visible("#empty")),
  await newTabs(),
);
check(
  "...with no problems and an explorer section",
  !(await $visible("#problems")) && (await $count(".machine")) === 1 && !(await $visible("#explorer-empty")),
);
await page.mouse.move(700, 450);
await page.keyboard.press("Control+n");
await page.waitForTimeout(100);
check(
  "Ctrl+N opens untitled2 and leaves the explorer shown",
  (await newTabs()) === "untitled.ufsm,untitled2.ufsm*" &&
    (await Jn()).name === "untitled2" &&
    (await $visible("#sidebar")),
  await newTabs(),
);
await page.click(".menu-label >> text=File");
await page.click('.menu-item:has-text("New")');
await page.waitForTimeout(100);
check(
  "File › New opens untitled3",
  (await newTabs()) === "untitled.ufsm,untitled2.ufsm,untitled3.ufsm*",
  await newTabs(),
);
// File › Open Recent: a submenu at the right of its item (the browser build has no recent machines).
await page.click(".menu-label >> text=File");
await page.hover('.menu-item:has-text("Open Recent")');
const recentSub = await page.evaluate(() => {
  const item = [...document.querySelectorAll(".menu-item")].find((b) => b.textContent?.includes("Open Recent"));
  const sub = document.querySelector(".menu-dropdown.submenu");
  const rows = sub ? [...sub.querySelectorAll(".menu-item")] : [];
  return {
    rows: rows.map((b) => `${b.querySelector(".text")?.textContent}:${b.disabled}`).join(),
    beside: !!item && !!sub && sub.getBoundingClientRect().left >= item.getBoundingClientRect().right - 2,
  };
});
check(
  "File › Open Recent opens a submenu beside it, empty in the browser",
  recentSub.rows === "No Recent Machines:true" && recentSub.beside,
  JSON.stringify(recentSub),
);
await page.hover('.menu-item:has-text("Save As")');
check("moving to another item closes the submenu", (await $count(".menu-dropdown.submenu")) === 0);
await page.keyboard.press("Escape");
await page.keyboard.press("a");
await page.keyboard.press("s");
{
  const [sx, sy] = await w2s(400, 300);
  await page.mouse.click(sx, sy);
}
nd = await Jn();
check(
  "a state can be placed on it at once; the tab turns dirty",
  nd.machine.root.states.length === 1 &&
    nd.machine.root.states[0].name === "State1" &&
    (await newTabs()) === "untitled.ufsm,untitled2.ufsm,untitled3.ufsm*+",
  JSON.stringify([nd.machine.root.states, await newTabs()]),
);
if (shots) await page.screenshot({ path: `${shots}/new.png` });
const [dln] = await Promise.all([page.waitForEvent("download"), page.keyboard.press("s")]);
const savedNew = JSON.parse(readFileSync(await dln.path(), "utf8"));
check(
  "S saves it (the browser build downloads untitled3.ufsm) and it is clean again",
  dln.suggestedFilename() === "untitled3.ufsm" &&
    savedNew.name === "untitled3" &&
    savedNew.machine.root.states.length === 1 &&
    !(await U("isDirty")),
);
await U("closeTab", 1, true);
await page.keyboard.press("Control+n");
await page.waitForTimeout(100);
check(
  "a closed untitled name is used again",
  (await newTabs()) === "untitled.ufsm,untitled3.ufsm,untitled2.ufsm*",
  await newTabs(),
);
for (let i = (await U("tabs")).length - 1; i >= 0; i--) await U("closeTab", i, true);
// 15. adding and deleting (E4): tools by key, palette and menu; transitions; delete; copy, cut and paste; regions
await page.evaluate(([t]) => window.ufsm.load(t, "add.ufsm"), [text]);
await page.waitForTimeout(300);
const J = async () => JSON.parse(await U("serialize"));
const verticesOf = (d) => {
  const out = [];
  const walk = (r) =>
    r.states.forEach((v) => {
      out.push({ ...v, region: r.id });
      (v.regions ?? []).forEach(walk);
    });
  walk(d.machine.root);
  return out;
};
const added = async (prev) => {
  const ids = new Set(verticesOf(prev).map((v) => v.id));
  return verticesOf(await J()).filter((v) => !ids.has(v.id));
};
const clickAt = async (wx, wy) => {
  const [sx, sy] = await w2s(wx, wy);
  await page.mouse.click(sx, sy);
};
const original = await U("serialize");
let prev = await J();
await page.keyboard.press("a");
check(
  "a shows the add keys",
  /s state · t S transition · l straight transition/.test(await U("status")),
  await U("status"),
);
await page.keyboard.press("s");
check(
  "a s arms the state tool: palette and status show it",
  (await U("tool")) === "state" &&
    (await $count('.tool.active[data-tool="state"]')) === 1 &&
    /^State: click to place/.test(await U("status")),
  await U("status"),
);
await clickAt(700, 500);
let made4 = await added(prev);
check(
  "a click places a 160x80 state named State1 there, selected; the tool disarms",
  made4.length === 1 &&
    made4[0].kind === "state" &&
    made4[0].name === "State1" &&
    JSON.stringify(await box(made4[0].id)) === JSON.stringify({ x: 620, y: 460, w: 160, h: 80 }) &&
    JSON.stringify(await sel()) === JSON.stringify([made4[0].id]) &&
    (await U("tool")) === "select" &&
    (await $count('.tool.active[data-tool="select"]')) === 1,
  JSON.stringify([made4, await U("tool")]),
);
const s1 = made4[0].id;
check("the explorer tree shows the new state", (await $text(".machine")).includes("State1"));
check(
  "placing is one undo step",
  (await U("canUndo")) &&
    (await (async () => {
      await U("undo");
      const gone = (await added(prev)).length === 0;
      await U("redo");
      return gone;
    })()),
);
prev = await J();
await page.keyboard.press("a");
await page.keyboard.press("s");
await drag(await w2s(110, 270), await w2s(280, 390));
made4 = await added(prev);
check(
  "dragging draws the state, in the region band under the press",
  made4.length === 1 &&
    made4[0].region === "r2" &&
    JSON.stringify(await box(made4[0].id)) === JSON.stringify({ x: 110, y: 270, w: 170, h: 120 }),
  JSON.stringify([made4, made4[0] && (await box(made4[0].id))]),
);
prev = await J();
await page.keyboard.press("a");
await page.keyboard.press("f");
await page.keyboard.press("Escape");
check(
  "Esc disarms a tool and changes nothing",
  ((await U("tool")) === "select" && (await U("serialize")) === JSON.stringify(prev, null, 2) + "\n") ||
    ((await added(prev)).length === 0 && (await U("tool")) === "select"),
);
await page.keyboard.press("a");
await page.keyboard.press("i");
await clickAt(650, 300);
check(
  "a second initial state in a region is refused, with the reason",
  (await added(prev)).length === 0 &&
    /already has an initial state/.test(await U("status")) &&
    (await U("tool")) === "select",
  await U("status"),
);
await page.mouse.move(10, 10);
await page.click('.tool[data-tool="final"]');
check(
  "a palette click arms that tool",
  (await U("tool")) === "final" && (await $count('.tool.active[data-tool="final"]')) === 1,
);
await clickAt(600, 250);
made4 = await added(prev);
check(
  "...and a click places it (20x20, centred on the pointer)",
  made4.length === 1 &&
    made4[0].kind === "final" &&
    JSON.stringify(await box(made4[0].id)) === JSON.stringify({ x: 590, y: 240, w: 20, h: 20 }),
  JSON.stringify(made4),
);
const fin = made4[0].id;
prev = await J();
await page.keyboard.press("a");
await page.keyboard.press("Shift+F");
await page.keyboard.press("r");
check("r turns the fork tool", /now horizontal/.test(await U("status")), await U("status"));
await clickAt(760, 300);
made4 = await added(prev);
check(
  "...and it is placed horizontally",
  made4.length === 1 &&
    made4[0].kind === "fork" &&
    (await J()).diagram.states[made4[0].id].orientation === "horizontal" &&
    (await box(made4[0].id)).w === 100,
  JSON.stringify(made4),
);
await page.click(".menu-label >> text=Add");
await page.click(".menu-item >> text=Terminate");
check("Add › Terminate arms the terminate tool", (await U("tool")) === "terminate");
await page.keyboard.press("Escape");

// transitions
let tBefore = (await J()).machine.transitions.length;
await page.keyboard.press("a");
await page.keyboard.press("t");
check(
  "a t arms the S transition tool",
  (await U("tool")) === "transition" && /S transition: click the source/.test(await U("status")),
  await U("status"),
);
await page.mouse.click(...(await center("s5")));
check("a click on the source starts the transition", /click the target/.test(await U("status")), await U("status"));
await page.mouse.click(...(await center(s1)));
let tl = (await J()).machine.transitions;
check(
  "a click on the target draws it: an S route without trigger, selected",
  tl.length === tBefore + 1 &&
    tl.at(-1).from === "s5" &&
    tl.at(-1).to === s1 &&
    tl.at(-1).on === undefined &&
    (await J()).diagram.transitions[tl.at(-1).id].route === "s" &&
    JSON.stringify(await sel()) === JSON.stringify([tl.at(-1).id]) &&
    (await U("tool")) === "select",
  JSON.stringify(tl.at(-1)),
);
const tS = tl.at(-1).id;
{
  const pts = (await U("route", tS)).points;
  check(
    "...on the grid: its ends and its jog are on 10-unit grid lines",
    pts.every((p) => p.x % 10 === 0 && p.y % 10 === 0),
    JSON.stringify(pts),
  );
}
await page.click('.tool[data-tool="transition"]');
await drag(await center(s1), await center("s5"));
tl = (await J()).machine.transitions;
check(
  "dragging from one state to another draws one too",
  tl.length === tBefore + 2 && tl.at(-1).from === s1 && tl.at(-1).to === "s5",
  JSON.stringify(tl.at(-1)),
);
await page.keyboard.press("a");
await page.keyboard.press("t");
await page.mouse.click(...(await center(fin)));
check(
  "a final state cannot start a transition: the reason is shown, the tool stays",
  /final state has no outgoing/.test(await U("status")) && (await U("tool")) === "transition",
  await U("status"),
);
await page.mouse.click(...(await center("s5")));
await page.mouse.click(...(await center("s1")));
check(
  "an initial state cannot be a target: the reason is shown, no transition, still drawing",
  /initial state cannot be the target/.test(await U("status")) &&
    (await J()).machine.transitions.length === tBefore + 2 &&
    (await U("tool")) === "transition",
  await U("status"),
);
await clickAt(560, 430);
check(
  "an S transition takes no bend points: a click on empty canvas says to use the straight one",
  /straight transition/.test(await U("status")) && (await U("tool")) === "transition",
  await U("status"),
);
await page.keyboard.press("Escape");
check(
  "Esc cancels it and disarms",
  (await U("tool")) === "select" && (await J()).machine.transitions.length === tBefore + 2,
);
await page.keyboard.press("a");
await page.keyboard.press("l");
check(
  "a l arms the straight transition tool",
  (await U("tool")) === "straight" && /Straight transition: click the source/.test(await U("status")),
  await U("status"),
);
await page.mouse.click(...(await center("s3")));
await clickAt(560, 430);
await clickAt(540, 440);
await page.keyboard.press("Backspace");
await page.mouse.click(...(await center("s6")));
tl = (await J()).machine.transitions;
const tFree = tl.at(-1);
let edge = (await J()).diagram.transitions[tFree.id];
check(
  "clicks on empty canvas add bend points (Backspace removes the last): a free route, relative to P",
  tFree.from === "s3" && tFree.to === "s6" && edge.route === undefined && JSON.stringify(edge.via) === "[[460,330]]",
  JSON.stringify([tFree, edge]),
);
await page.keyboard.press("Escape");
await page.click('.tool[data-tool="straight"]');
check(
  "the palette has both transition tools; a click arms the straight one",
  (await U("tool")) === "straight" &&
    (await page.$$eval(".tool", (bs) => bs.map((b) => b.getAttribute("aria-label"))))
      .join()
      .includes("S transition,Straight transition"),
);
await page.mouse.click(...(await center("s5")));
await page.mouse.move(...(await center(s1)));
if (shots) await page.screenshot({ path: `${shots}/straight-preview.png` });
await page.mouse.click(...(await center(s1)));
tl = (await J()).machine.transitions;
{
  const t = tl.at(-1),
    e = (await J()).diagram.transitions[t.id],
    pts = (await U("route", t.id)).points;
  check(
    "without bend points it is one straight line between the states, ends on the grid",
    t.from === "s5" &&
      t.to === s1 &&
      e.route === undefined &&
      e.via === undefined &&
      pts.length === 2 &&
      pts.every((p) => p.x % 10 === 0 && p.y % 10 === 0) &&
      (await U("tool")) === "select",
    JSON.stringify([e, pts]),
  );
  await page.keyboard.press("Control+z"); // the copy/paste checks below expect the transitions from before
}
{
  // click just inside an edge: the end goes on that side, as close to the click as the grid allows
  const a = await U("box", "s3"),
    b = await U("box", "s6");
  await page.keyboard.press("a");
  await page.keyboard.press("t");
  await page.mouse.click(...(await w2s(a.x + 31, a.y + a.h - 2)));
  await page.mouse.move(...(await w2s(b.x + 2, b.y + 19)));
  if (shots) await page.screenshot({ path: `${shots}/s-clicked-ends.png` });
  await page.mouse.click(...(await w2s(b.x + 2, b.y + 19)));
  const t = (await J()).machine.transitions.at(-1),
    e = (await J()).diagram.transitions[t.id],
    pts = (await U("route", t.id)).points;
  check(
    "the ends attach where the source and the target were clicked (S: pinned)",
    t.from === "s3" &&
      t.to === "s6" &&
      e.route === "s" &&
      JSON.stringify([e.from, e.to]) ===
        JSON.stringify([
          { side: "bottom", offset: 30 },
          { side: "left", offset: 20 },
        ]) &&
      pts[0].x === a.x + 30 &&
      pts[0].y === a.y + a.h &&
      pts.at(-1).x === b.x &&
      pts.at(-1).y === b.y + 20,
    JSON.stringify([e, pts]),
  );
  await page.keyboard.press("Control+z");
}
await page.keyboard.press("a");
await page.keyboard.press("t");
await page.mouse.click(...(await center("s5")));
await page.mouse.move(...(await w2s(560, 590)));
if (shots) await page.screenshot({ path: `${shots}/s-preview.png` });
await page.keyboard.press("Escape");
await U("select", [tS]);
await page.mouse.move(...(await w2s(...(() => [0, 0])())));
await page.keyboard.press("a");
await page.keyboard.press("v");
edge = (await J()).diagram.transitions[tS];
check(
  "a v adds a bend point to the selected transition (an S route becomes free, same shape)",
  edge.route === undefined && edge.via.length >= 1,
  JSON.stringify(edge),
);
const nVia = edge.via.length;
const bendH = (await handles()).find((h) => h.kind === "bend");
await page.mouse.dblclick(...bendH.screen);
edge = (await J()).diagram.transitions[tS];
check("double-click on a bend point removes it", (edge.via?.length ?? 0) === nVia - 1, JSON.stringify(edge));

// regions
await U("select", ["s5"]);
await page.keyboard.press("a");
await page.keyboard.press("r");
const regionsOf = async (id) => verticesOf(await J()).find((v) => v.id === id).regions?.length ?? 0;
check("a r adds a region to the selected state", (await regionsOf("s5")) === 1);
await page.click(".panel-body .add >> text=Add region");
check("Properties › Add region adds another", (await regionsOf("s5")) === 2);
await page.click(".panel-body .remove");
check("the × next to a region deletes it", (await regionsOf("s5")) === 1);
await page.click('.tool[data-tool="region"]');
await page.mouse.click(...(await center(s1)));
check(
  "the region tool adds a region to the clicked state",
  (await regionsOf(s1)) === 1 && (await U("tool")) === "select",
);

// delete
prev = await J();
await U("select", ["s2"]);
await page.keyboard.press("Delete");
let afterDel = await J();
check(
  "Delete removes a composite state with its contents and the transitions touching them",
  !verticesOf(afterDel).some((v) => ["s2", "s3", "s4", "s6"].includes(v.id)) &&
    afterDel.machine.transitions.every(
      (t) => !["s2", "s3", "s4", "s6"].includes(t.from) && !["s2", "s3", "s4", "s6"].includes(t.to),
    ) &&
    !afterDel.diagram.states.s3,
  JSON.stringify(afterDel.machine.transitions),
);
check("...and the explorer tree drops it", !(await $text(".machine")).includes("P"));
await page.keyboard.press("Control+z");
check(
  "one undo brings it all back",
  (await U("serialize")) === JSON.stringify(prev, null, 2) + "\n" || JSON.stringify(await J()) === JSON.stringify(prev),
);

// copy, cut, paste
await U("select", ["s5", s1]);
await page.keyboard.press("Control+c");
check(
  "Ctrl+C copies the selected states (and the transitions between them)",
  /Copied 2 states and 2 transitions/.test(await U("status")),
  await U("status"),
);
prev = await J();
await page.mouse.move(...(await w2s(300, 450)));
await page.keyboard.press("Control+v");
made4 = await added(prev);
const pastedT = (await J()).machine.transitions.length - prev.machine.transitions.length;
const corner4 = {
  x: Math.min(...(await Promise.all(made4.filter((v) => v.region === "r0").map((v) => box(v.id)))).map((b) => b.x)),
  y: Math.min(...(await Promise.all(made4.filter((v) => v.region === "r0").map((v) => box(v.id)))).map((b) => b.y)),
};
check(
  "Ctrl+V pastes a copy with new ids at the pointer, selected",
  made4.filter((v) => v.region === "r0").length === 2 &&
    pastedT === 2 &&
    corner4.x === 300 &&
    corner4.y === 450 &&
    (await sel()).length === 4,
  JSON.stringify([made4.map((v) => v.id), pastedT, corner4, await sel()]),
);
prev = await J();
await page.keyboard.press("Control+x");
check(
  "Ctrl+X removes the selection (copied first)",
  verticesOf(await J()).length === verticesOf(prev).length - made4.length,
);
await page.click(".menu-label >> text=Edit");
await page.click(".menu-item >> text=Paste");
check(
  "Edit › Paste puts it back (in the middle of the view: the pointer is on the menu)",
  verticesOf(await J()).length === verticesOf(prev).length && (await sel()).length === 4,
);
await page.click(".menu-label >> text=Edit");
await page.click(".menu-item >> text=Delete");
check("Edit › Delete deletes the selection", verticesOf(await J()).length === verticesOf(prev).length - made4.length);
for (let i = 0; i < 60 && (await U("canUndo")); i++) await U("undo");
check("undoing every step gives the loaded document back", (await U("serialize")) === original);
if (shots) await page.screenshot({ path: `${shots}/add.png` });
await U("closeTab", 0, true);
// 16. properties and declarations (E5): e + key, a + list key, pickers, Project, Problems
await page.evaluate(([t]) => window.ufsm.load(t, "props.ufsm"), [text]);
await page.waitForTimeout(300);
const P = async () => JSON.parse(await U("serialize"));
const focused = () =>
  page.evaluate(() => document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.tagName);
const vtx = async (id) => {
  let out;
  const walk = (r) =>
    r.states.forEach((v) => {
      if (v.id === id) out = v;
      (v.regions ?? []).forEach(walk);
    });
  walk((await P()).machine.root);
  return out;
};
const trn = async (id) => (await P()).machine.transitions.find((t) => t.id === id);
const declId = async (kind, name) => (await P()).declarations[kind].find((d) => d.name === name)?.id;
const pick = async (typed) => {
  await page.keyboard.type(typed);
  await page.keyboard.press("Enter");
  await page.waitForTimeout(50);
};
const start5 = await U("serialize");
await page.mouse.move(10, 10);
await U("select", ["s3"]);
await page.keyboard.press("e");
check("e shows the edit keys", /n name · t trigger/.test(await U("status")), await U("status"));
await page.keyboard.press("n");
check(
  "e n focuses the selected state's name in Properties, text selected",
  (await focused()) === "Name" &&
    (await page.evaluate(() => document.activeElement.selectionEnd - document.activeElement.selectionStart)) === 1,
);
await page.keyboard.type("Alpha");
await page.keyboard.press("Enter");
check(
  "Enter renames it (one undo step) and gives the keys back to the canvas",
  (await vtx("s3")).name === "Alpha" &&
    (await focused()) === "BODY" &&
    (await U("canUndo")) &&
    (await $text(".machine")).includes("Alpha"),
);
await page.keyboard.press("e");
await page.keyboard.press("n");
await page.keyboard.type("Nope");
await page.keyboard.press("Escape");
check(
  "Esc in the field reverts",
  (await vtx("s3")).name === "Alpha" && (await page.inputValue('.panel-body input[aria-label="Name"]')) === "Alpha",
);
await page.keyboard.press("a");
await page.keyboard.press("e");
check(
  "a e opens the entry action picker, focused, without typing the e",
  (await focused()) === "Action or ^signal to emit" && (await page.inputValue(".picker input")) === "",
);
await page.keyboard.type("start");
check(
  "...offering to create the typed name as an action or an emitted signal",
  (await $text(".picker-list")).includes("start() new action") &&
    (await $text(".picker-list")).includes("^start new signal, emitted"),
  await $text(".picker-list"),
);
await page.keyboard.press("Enter");
const actStart = await declId("actions", "start");
check(
  "Enter declares the action and adds the call, in one step",
  !!actStart && JSON.stringify((await vtx("s3")).entry) === JSON.stringify([{ call: actStart }]),
);
await page.keyboard.press("a");
await page.keyboard.press("e");
await pick("^sGo");
const sigGo = await declId("signals", "sGo");
check(
  "^name creates a signal and emits it",
  !!sigGo && JSON.stringify((await vtx("s3")).entry) === JSON.stringify([{ call: actStart }, { emit: sigGo }]),
);
await page.click('.psection:has(summary:text-is("Entry")) button[title="Move down"]');
check(
  "↓ reorders the entry actions",
  JSON.stringify((await vtx("s3")).entry) === JSON.stringify([{ emit: sigGo }, { call: actStart }]),
);
await page.click('.psection:has(summary:text-is("Entry")) .erow:nth-child(1) button[title="Remove"]');
check("× removes one", JSON.stringify((await vtx("s3")).entry) === JSON.stringify([{ call: actStart }]));
await page.keyboard.press("a");
await page.keyboard.press("x");
await pick("start");
check(
  "a x adds an exit action, picking an existing one by typing",
  JSON.stringify((await vtx("s3")).exit) === JSON.stringify([{ call: actStart }]),
);

await U("select", ["t2"]);
await page.keyboard.press("e");
await page.keyboard.press("t");
check("e t opens the trigger picker of the selected transition", (await focused()) === "Event or signal");
await pick("auto");
check("...auto", (await trn("t2")).auto === true && (await trn("t2")).on === undefined);
await page.click(".trigger");
await pick("eNew");
const evNew = await declId("events", "eNew");
check(
  "...a new event, declared in the same step",
  !!evNew && (await trn("t2")).on === evNew && (await trn("t2")).auto === undefined,
);
await page.keyboard.press("a");
await page.keyboard.press("g");
await pick("ready");
const grdReady = await declId("guards", "ready");
check(
  "a g adds a guard term, creating the guard",
  JSON.stringify((await trn("t2")).guard) === JSON.stringify([{ call: grdReady }]),
);
check(
  "a guard term is true or false; guards return a boolean",
  JSON.stringify(await page.$$eval('select[aria-label="Condition"] option', (os) => os.map((o) => o.value))) ===
    '["true","false"]',
);
await page.selectOption('select[aria-label="Condition"]', "false");
check(
  "a guard term can test that the guard is false",
  JSON.stringify((await trn("t2")).guard) === JSON.stringify([{ call: grdReady, not: true }]),
  JSON.stringify((await trn("t2")).guard),
);
await page.click('.psection:has(summary:text-is("Guard")) .add');
await pick("<B>");
await page.selectOption('.psection:has(summary:text-is("Guard")) .erow:nth-child(2) select', "not");
check(
  "...or test that a state is not active",
  JSON.stringify((await trn("t2")).guard?.[1]) === JSON.stringify({ in: "s4", not: true }),
  JSON.stringify((await trn("t2")).guard),
);
await page.keyboard.press("a");
await page.keyboard.press("a");
await pick("start");
check(
  "a a adds an action to the transition",
  JSON.stringify((await trn("t2")).do) === JSON.stringify([{ call: actStart }]),
);
await U("select", ["t1"]);
check(
  "a transition out of an initial state offers no trigger or guard",
  /taken as soon as the initial state is reached/.test(await $text(".panel-body")) && (await $count(".trigger")) === 0,
);

// internal transitions, regions, fork orientation
await U("select", ["s5"]);
await page.click("text=+ Add internal transition");
await pick("e1");
const cState = await vtx("s5");
check("+ Add internal transition: pick its event", cState.internal?.length === 1 && cState.internal[0].on === "ev1");
await page.click("details.internal > summary");
await page.click("details.internal .add >> text=Add action");
await pick("start");
check(
  "...then give it actions",
  JSON.stringify((await vtx("s5")).internal[0].do) === JSON.stringify([{ call: actStart }]),
);
// timers
await page.click(".menu-label:has-text('Edit')");
await page.click(".menu-item:has-text('Add Timer')");
check(
  "Edit › Add Timer opens the picker of the event a new timer fires",
  (await focused()) === "Event to fire on expiry",
  await focused(),
);
await pick("eTimeout");
let tms = (await vtx("s5")).timers;
const evTimeout = await declId("events", "eTimeout");
check(
  "...a new event, declared in the same step; one-shot after 1 s",
  JSON.stringify(tms) === JSON.stringify([{ id: tms?.[0]?.id, name: "timer1", after: 1, unit: "s", event: evTimeout }]),
  JSON.stringify(tms),
);
await page.click('details.internal > summary:has-text("timer1(")');
await page.fill('input[aria-label="Timer name"]', "travel");
await page.keyboard.press("Enter");
await page.fill('input[aria-label="Duration"]', "20");
await page.keyboard.press("Enter");
await page.selectOption('select[aria-label="One-shot or periodic"]', "every");
await page.selectOption('select[aria-label="Unit"]', "min");
tms = (await vtx("s5")).timers;
check(
  "...then name it, set its duration, make it periodic, change the unit",
  JSON.stringify(tms) === JSON.stringify([{ id: tms[0].id, name: "travel", every: 20, unit: "min", event: evTimeout }]),
  JSON.stringify(tms),
);
check(
  "its row names it, without a t/ prefix under the Timers heading",
  (await page.locator('details.internal > summary:has-text("travel(") code').textContent()) ===
    "travel(every 20 min, eTimeout)",
);
await page.fill('input[aria-label="Duration"]', "0");
await page.keyboard.press("Enter");
check(
  "a duration of 0 is refused with a reason",
  /whole number/.test(await $text(".perror")) && (await vtx("s5")).timers[0].every === 20,
);
await page.keyboard.press("Escape");
await page.selectOption('select[aria-label="Unit"]', "h");
await page.fill('input[aria-label="Duration"]', "1194");
await page.keyboard.press("Enter");
check(
  "...and so is one over 2^32 - 1 ms",
  /At most 1193 h/.test(await $text(".perror")) && (await vtx("s5")).timers[0].every === 20,
  await $text(".perror"),
);
await page.keyboard.press("Escape");
await page.selectOption('select[aria-label="Unit"]', "min");
await U("select", ["s2"]);
await page.fill('input[aria-label="Region name"] >> nth=0', "Upper");
await page.keyboard.press("Enter");
check("a region can be named", (await vtx("s2")).regions[0].name === "Upper");
await page.click('.region-row input[type="checkbox"] >> nth=0');
check(
  "a region with transitions across its border cannot go off-page: the status line says why",
  /cross the region's border/.test(await U("status")) && !(await P()).diagram.regions.r1?.offPage,
  await U("status"),
);
await page.click('.tool[data-tool="fork"]');
await page.mouse.click(...(await w2s(650, 300)));
const fork = (await sel())[0];
await page.keyboard.press("e");
await page.keyboard.press("r");
check("e r turns a fork", (await P()).diagram.states[fork].orientation === "horizontal");

// Project: declarations and options
await page.click("#panel-tab-project");
const declRows = await page.$$eval(".decl", (rows) =>
  rows.map((r) => `${r.querySelector("input").value} ${r.querySelector(".uses").textContent}`),
);
check(
  "Project lists the declarations with their uses",
  declRows.includes("eNew 1 use") && declRows.includes("start 3 uses") && declRows.includes("e1 5 uses"),
  JSON.stringify(declRows),
);
await page.fill('input[aria-label="Name of e1"]', "2bad");
await page.keyboard.press("Enter");
check(
  "an invalid declaration name is refused with a reason",
  /not an identifier/.test(await $text(".perror")) && !!(await declId("events", "e1")),
);
await page.fill('input[aria-label="Name of e1"]', "start");
await page.keyboard.press("Enter");
check("...and so is a name already declared", /already declared as an action/.test(await $text(".perror")));
await page.fill('input[aria-label="Name of e1"]', "eGo");
await page.keyboard.press("Enter");
check(
  "renaming a declaration renames every use (they refer to it by id)",
  (await declId("events", "eGo")) === "ev1" && (await trn("t3")).on === "ev1" && (await U("route", "t3")) !== undefined,
);
await page.click('.decl[data-decl="' + sigGo + '"] button[title="Delete"], .decl[data-decl="' + sigGo + '"] .remove');
check("deleting an unused declaration", !(await declId("signals", "sGo")));
await page.click('.decl[data-decl="' + actStart + '"] .remove');
check(
  "deleting a used one removes its uses",
  !(await declId("actions", "start")) && (await vtx("s3")).entry === undefined && (await trn("t2")).do === undefined,
);
await page.click("text=+ Add event");
await pick("eExtra");
check("+ Add event declares one", !!(await declId("events", "eExtra")));
await page.click("text=+ Add guard");
await pick("gSpare");
check(
  "the code generator shows one language, C by default",
  (await page.$eval('select[aria-label="Language"]', (e) => e.value)) === "c" &&
    (await $count('input[aria-label="C Prefix"]')) === 1 &&
    (await $count('input[aria-label="Python Class"]')) === 0 &&
    (await $count('select[aria-label="C Trace hook"]')) === 0,
);
await page.fill('input[aria-label="C Prefix"]', "lamp_");
await page.keyboard.press("Enter");
check("code generator options are set...", (await P()).targets?.c?.prefix === "lamp_");
await page.fill('input[aria-label="C Prefix"]', "");
await page.keyboard.press("Enter");
check("...and cleared back to the default", (await P()).targets === undefined);
await page.selectOption('select[aria-label="Language"]', "rust");
check(
  "picking a language stores it and shows only its settings",
  (await P()).target === "rust" &&
    (await $count('input[aria-label="Rust Struct"]')) === 1 &&
    (await $count('input[aria-label="C Prefix"]')) === 0,
);
await page.fill('input[aria-label="Output folder"]', "..\\src\\gen ");
await page.keyboard.press("Enter");
check(
  "the output folder is stored per language, with /",
  (await P()).targets?.rust?.out === "../src/gen",
  JSON.stringify((await P()).targets),
);
await page.selectOption('select[aria-label="Language"]', "c");
check(
  "...so switching back shows C's (unset)",
  (await page.$eval('input[aria-label="Output folder"]', (e) => e.value)) === "" &&
    (await P()).targets?.rust?.out === "../src/gen",
);
await page.selectOption('select[aria-label="Language"]', "rust");
await page.fill('input[aria-label="Output folder"]', "");
await page.keyboard.press("Enter");
await page.selectOption('select[aria-label="Language"]', "c");
check("...and clearing it leaves no targets", (await P()).targets === undefined && (await P()).target === "c");
check(
  "the behaviour options are shown once, not per language",
  (await $count('input[aria-label="Signal queue"]')) === 1 &&
    (await $count('input[aria-label="C Signal queue"]')) === 0 &&
    /Behaviour/.test(await $text(".panel-body")),
);
await page.fill('input[aria-label="Signal queue"]', "x");
await page.keyboard.press("Enter");
check(
  "options are checked (a whole number)...",
  /whole number/.test(await $text(".perror")) && (await P()).options === undefined,
);
await page.keyboard.press("Escape");
await page.fill('input[aria-label="Signal queue"]', "4");
await page.keyboard.press("Enter");
check("...set in the options section...", (await P()).options?.signalQueue === 4 && (await P()).targets === undefined);
await page.fill('input[aria-label="Signal queue"]', "");
await page.keyboard.press("Enter");
check("...and cleared back to the default", (await P()).options === undefined);
await page.click('input[aria-label="Debug info"]');
check("API options are switches in the code generator...", (await P()).options?.debugInfo === true);
await page.click('input[aria-label="Debug info"]');
check("...off by default (not written)", (await P()).options === undefined);
{
  // A per-language override in the file is no longer edited here, but shown with a way to clear it.
  const m = await P();
  m.targets = { c: { trace: true } };
  await U("load", JSON.stringify(m), "override.ufsm");
  await page.click("#panel-tab-project");
  check(
    "a per-language override in the file is shown...",
    /sets Trace hook on for C only/.test(await $text(".target-override")),
    await $text(".panel-body"),
  );
  await page.click(".target-override button:has-text('Clear')");
  check("...and Clear removes it", (await P()).targets === undefined && (await $count(".target-override")) === 0);
  await U("closeTab", (await U("tabs")).length - 1, true);
  await page.click("#panel-tab-project");
}

// Problems
await page.click("#panel-tab-problems");
const probs = await $text(".problems-list");
check(
  "Problems lists the findings, live (gSpare is unused)",
  /guard 'gSpare' is never used/.test(probs) && /\d/.test(await $text("#panel-tab-problems .badge")),
  probs.slice(0, 300),
);
await page.click('.problem:has-text("gSpare")');
check(
  "clicking a declaration's problem shows it in Project",
  (await $text(".panel-tab.active")) === "Project" && (await $count(".decl.flash")) === 1,
);
await page.click("#panel-tab-problems");
await page.click('.problem:has-text("never fire")');
const jumped = await sel();
check(
  "clicking a transition's problem selects it",
  jumped.length === 1 && (await P()).machine.transitions.some((t) => t.id === jumped[0]),
  JSON.stringify(jumped),
);
await page.click("#panel-tab-properties");
for (let i = 0; i < 80 && (await U("canUndo")); i++) await U("undo");
check("undoing every step gives the loaded document back", (await U("serialize")) === start5);
if (shots) await page.screenshot({ path: `${shots}/props.png` });
await U("closeTab", 0, true);

// ---------------------------------------------------------------- simulator and code preview (E6)
const loadRepo = async (f, name, change) => {
  let t = readFileSync(join(repo, f), "utf8");
  if (change) {
    const j = JSON.parse(t);
    change(j);
    t = JSON.stringify(j);
  }
  await page.evaluate(([t, n]) => window.ufsm.load(t, n), [t, name]);
  await page.waitForTimeout(150);
};
const stateId = async (name) => {
  let out;
  const walk = (r) =>
    r.states.forEach((v) => {
      if (v.name === name) out = v.id;
      (v.regions ?? []).forEach(walk);
    });
  walk((await P()).machine.root);
  return out;
};
/** A point inside a state's body, clear of its text: near the bottom-left corner. */
const body = async (name) => {
  const b = await box(await stateId(name));
  return w2s(b.x + 6, b.y + b.h - 6);
};
// Innermost active state: the theme's active color (gruvbox green) at 13% over the state fill.
const ACTIVE = "58,58,39",
  PLAIN = "40,40,40";
const events = () =>
  page.$$eval(".sevent", (bs) =>
    bs.map((b) => b.textContent + (b.classList.contains("would") ? "*" : "") + (b.disabled ? "-" : "")),
  );

await loadRepo("examples/dimmer.ufsm", "dimmer.ufsm");
await page.click("#panel-tab-properties");
check(
  "the Simulator tab is there before anything runs",
  (await $text("#panel-tab-simulator")) === "Simulator" && (await U("sim")) === undefined,
);
await page.mouse.move(...(await w2s(10, 10)));
await page.keyboard.press("F5");
let S = await U("sim");
check(
  "F5 starts the simulator: the reset runs the entry actions and the Simulator tab opens",
  S?.steps === 1 && S.calls.join() === "lamp_off" && S.active.join() === "Off" && (await U("panelTab")) === "simulator",
  JSON.stringify(S),
);
check(
  "...scrolled into view in the narrow tab strip",
  await page.evaluate(() => {
    const t = document.getElementById("panel-tab-simulator").getBoundingClientRect(),
      s = document.querySelector(".panel-tabs").getBoundingClientRect();
    return t.left >= s.left - 1 && t.right <= s.right + 1;
  }),
);
check("the status bar says it is simulating", (await $text("#sim-status")) === "Simulating · step 0");
check(
  "events that would take a transition now are marked",
  (await events()).join() === "eButton*,eOffButton",
  (await events()).join(),
);
check(
  "the active state is filled green on the canvas",
  (await pixel(...(await body("Off")))).join() === ACTIVE,
  (await pixel(...(await body("Off")))).join(),
);
await page.hover('.sevent:has-text("eButton")');
S = await U("sim");
check(
  "hovering an event shows the transitions it would take",
  S.hover === "eButton" && S.would.length === 1,
  JSON.stringify(S),
);
await page.click('.sevent:has-text("eButton")');
S = await U("sim");
check(
  "clicking an event sends it",
  S.steps === 2 && S.calls.join() === "lamp_10_percent" && S.active.join() === "On,10%" && S.fired.length === 1,
  JSON.stringify(S),
);
check(
  "the highlight follows: Off plain, 10% filled",
  (await pixel(...(await body("Off")))).join() === PLAIN && (await pixel(...(await body("10%")))).join() === ACTIVE,
  (await pixel(...(await body("Off")))).join() + " / " + (await pixel(...(await body("10%")))).join(),
);
check(
  "the log shows the step: exit, take, enter, call",
  /eButton\s*exit\s*Off\s*take\s*Off → On\s*enter\s*On\s*enter\s*10%\s*call\s*lamp_10_percent\(\)/.test(
    await $text(".slog"),
  ),
  await $text(".slog"),
);
await page.click('.sevent:has-text("eOffButton")');
await page.click('.sevent:has-text("eButton")');
S = await U("sim");
check("history: On resumes in 10% (shallow history)", S.active.join() === "On,10%", JSON.stringify(S));
check(
  "Active states lists the innermost ones with their path",
  (await page.locator(".psection:has-text('Active states') .plist").textContent()) === "On › 10%",
);
await page.click(".plist .link");
check("clicking an active state selects it", (await U("selectedName")) === "10%");
check(
  "the trace has a step per reset and event",
  /"reset": true, "expect": \["lamp_off"\], "active": \["Off"\]/.test(S.trace) &&
    (S.trace.match(/"send"/g) ?? []).length === 3,
  S.trace,
);
const [dl] = await Promise.all([page.waitForEvent("download"), page.click("text=Save trace…")]);
const saved = JSON.parse(readFileSync(await dl.path(), "utf8"));
check(
  "Save trace… writes it (dimmer.json, model next to it)",
  dl.suggestedFilename() === "dimmer.json" && saved.model === "dimmer.ufsm" && saved.steps.length === 4,
  dl.suggestedFilename() + JSON.stringify(saved).slice(0, 200),
);
await page.click(".psection:has-text('Trace') label.check input");
const [dl2] = await Promise.all([page.waitForEvent("download"), page.click("text=Save trace…")]);
check("...without the active states when unticked", !readFileSync(await dl2.path(), "utf8").includes('"active"'));

// layout edits keep the simulation; machine edits make it out of date
const [ox, oy] = await center(await stateId("Off"));
await drag([ox, oy], [ox + 20 * k, oy]);
check(
  "moving a state keeps the simulation going",
  (await U("sim")).stale === false && (await pixel(...(await body("10%")))).join() === ACTIVE,
);
await page.mouse.click(ox + 20 * k, oy);
await page.keyboard.press("Delete");
S = await U("sim");
check(
  "deleting a state makes it out of date: no highlight, events off",
  S.stale &&
    (await $text("#sim-status")) === "Simulation out of date" &&
    (await events()).every((e) => e.endsWith("-")) &&
    (await pixel(...(await body("10%")))).join() === PLAIN,
  JSON.stringify(S) + (await events()).join(),
);
check("...and says so", /machine changed/.test(await $text(".sstate")));
await page.keyboard.press("Control+z");
await page.keyboard.press("F5");
S = await U("sim");
check("F5 restarts it on the current machine", S.stale === false && S.steps === 1 && S.active.join() === "Off");
await page.keyboard.press("Shift+F5");
check(
  "Shift+F5 stops it: highlight and status gone",
  (await U("sim")) === undefined &&
    (await $count("#sim-status:not([hidden])")) === 0 &&
    (await pixel(...(await body("Off")))).join() === PLAIN,
);
check(
  "Run › Start Simulation",
  await (async () => {
    await page.click(".menu-label:has-text('Run')");
    await page.click(".menu-item:has-text('Start Simulation')");
    return (await U("sim"))?.steps === 1;
  })(),
);
check(
  "Run › Stop Simulation",
  await (async () => {
    await page.click(".menu-label:has-text('Run')");
    await page.click(".menu-item:has-text('Stop Simulation')");
    return (await U("sim")) === undefined;
  })(),
);

// guards
await loadRepo("tests/models/test_guard_terms.ufsm", "test_guard_terms.ufsm");
await page.keyboard.press("F5");
await page.click('.sevent:has-text("truthy")');
check("a guard is false until set", (await U("sim")).calls.length === 0);
await page.click('.sguard:has-text("g()") input[type=checkbox]');
check(
  "checking a guard marks the events it enables",
  (await events()).includes("truthy*") && (await events()).includes("all*") && !(await events()).includes("not*"),
  (await events()).join(),
);
await page.click('.sevent:has-text("truthy")');
check(
  "...and the machine uses it",
  (await U("sim")).calls.join() === "xIdle,aTruthy,eHit,xHit,eIdle",
  (await U("sim")).calls.join(),
);
await page.click('.sguard:has-text("h()") input[type=checkbox]');
await page.click('.sevent:has-text("all")');
S = await U("sim");
check(
  "the checkbox sets a guard to true (all needs h() false)",
  S.calls.length === 0 && !(await events()).includes("all*"),
  S.calls.join(),
);
check(
  "guard changes are recorded in the trace from the next step on",
  /"guards": \{ "g": true \},\s*"send": "truthy"/.test(S.trace) &&
    /"guards": \{ "h": true \}, "send": "all"/.test(S.trace),
  S.trace,
);
check("the log shows guard changes with the step", /all\s*h = true/.test(await $text(".slog")));

// timers: virtual time, Fire sends a timer's event
await loadRepo("tests/models/test_timers.ufsm", "test_timers.ufsm");
await page.keyboard.press("F5");
await page.click('.sevent:has-text("eGo")');
S = await U("sim");
const timersText = () => page.locator(".psection:has(> summary:has-text('Timers')) .pbody").textContent();
check(
  "entering a state starts its timers: in the calls and under Timers",
  S.calls.join() === "eP,start:travel(2000 ms),start:poll(every 100 ms),iP,eC1,start:blink(every 60000 ms)" &&
    S.timers.join() === "travel,poll,blink",
  JSON.stringify(S),
);
check(
  "...each with its duration, event and state",
  /travel\s*2 s → eTimeout, in P/.test(await timersText()),
  await timersText(),
);
await page.click('.stimer:has-text("poll") button:has-text("Fire")');
S = await U("sim");
check(
  "Fire on a periodic timer sends its event; it keeps running",
  S.calls.join() === "stop:blink,xC1,eC2,start:long(3600000 ms)" && S.timers.join() === "travel,poll,long",
  JSON.stringify(S),
);
check(
  "the log names the timer and shows starts and stops",
  /eTick\s*timer poll/.test(await $text(".slog")) && /stop\s*blink/.test(await $text(".slog")),
  await $text(".slog"),
);
await U("simFire", "travel");
S = await U("sim");
check(
  "a one-shot timer fires once; leaving P stops the rest",
  S.active.join() === "Idle" && S.timers.length === 0 && /None running/.test(await timersText()),
  JSON.stringify(S),
);
check(
  "the trace records an expiry as its event, starts and stops as calls",
  /"send": "eTick", "expect": \["stop:blink", "xC1", "eC2", "start:long\(3600000 ms\)"\]/.test(S.trace),
  S.trace,
);
await page.keyboard.press("Shift+F5");
await U(
  "closeTab",
  (await U("tabs")).findIndex((t) => t.active),
  true,
);

// a model with errors
await loadRepo("examples/dimmer.ufsm", "broken.ufsm", (j) =>
  j.declarations.events.push({ id: "ev99", name: "bad name" }),
);
await page.keyboard.press("F5");
check(
  "a model with errors does not start; the panel says why",
  (await U("sim")) === undefined &&
    /error.*fix/.test((await U("simError")) ?? "") &&
    /Problems/.test(await $text(".sstate")),
  await U("simError"),
);

// code preview
await page.click("#panel-tab-code");
check(
  "Code shows why it cannot generate, with a way to the problems",
  /the model has 1 error/.test(await $text(".codetab .serror")) && (await $count(".codetab .link")) === 1,
);
await page.click(".codetab .link");
check("...which opens Problems", (await U("panelTab")) === "problems");
await U(
  "closeTab",
  (await U("tabs")).findIndex((t) => t.active),
  true,
);
await U(
  "activateTab",
  (await U("tabs")).findIndex((t) => t.name === "dimmer.ufsm"),
);
await page.click("#panel-tab-code");
check(
  "Code previews the C header by default",
  (await $text(".cname")) === "dimmer.h" &&
    /struct dimmer_machine \{/.test(await $text(".code .src")) &&
    (await $count(".code .src .c-kw")) > 10,
);
const lines = async () => (await $text(".code .gutter")).split("\n").length;
check("...with line numbers", (await lines()) === (await $text(".code .src")).split("\n").length - 1);
check(
  "...offering only the selected language's files",
  (await $count(".cview")) === 2 && !/Python|TypeScript|Rust/.test(await $text(".cviews")),
);
await page.click(".cview:has-text('C source')");
check("C source", (await $text(".cname")) === "dimmer.c" && /#include "dimmer.h"/.test(await $text(".code .src")));
const codeIn = async (lang) => {
  await page.click("#panel-tab-project");
  await page.selectOption('select[aria-label="Language"]', lang);
  await page.click("#panel-tab-code");
};
await codeIn("python");
check(
  "Python, once selected in the Project tab, with no file switch",
  (await $text(".cname")) === "dimmer.py" &&
    /class Dimmer:/.test(await $text(".code .src")) &&
    (await $count(".cview")) === 0,
);
await codeIn("ts");
check(
  "TypeScript",
  (await $text(".cname")) === "dimmer.ts" && /export class Dimmer \{/.test(await $text(".code .src")),
);
await page.click("#panel-tab-project");
await page.fill('input[aria-label="TypeScript Class"]', "Lamp");
await page.keyboard.press("Enter");
await page.click("#panel-tab-code");
check("the preview follows the code generator options", /export class Lamp \{/.test(await $text(".code .src")));
const [dl3] = await Promise.all([page.waitForEvent("download"), page.click(".cfile button:has-text('Save…')")]);
check(
  "Save… writes the file shown",
  dl3.suggestedFilename() === "dimmer.ts" && /export class Lamp/.test(readFileSync(await dl3.path(), "utf8")),
);
await codeIn("rust");
check(
  "Rust",
  (await $text(".cname")) === "dimmer.rs" &&
    /pub struct Dimmer<H> \{/.test(await $text(".code .src")) &&
    (await $count(".code .src .c-pre")) > 3,
);
await page.click("#panel-tab-project");
await page.selectOption('select[aria-label="Language"]', "rust");
await page.fill('input[aria-label="Rust Struct"]', "Lamp");
await page.keyboard.press("Enter");
await page.click("#panel-tab-code");
check(
  "...with its own options",
  /pub struct Lamp<H> \{/.test(await $text(".code .src")) &&
    /"rust": \{\s*"className": "Lamp"/.test(await U("serialize")),
);
await codeIn("c");
await page.click(".cview:has-text('C header')");
check(
  "the C header has the state enum and fingerprint, but no trace hook by default",
  /enum dimmer_state \{/.test(await $text(".code .src")) &&
    /DIMMER_FINGERPRINT 0x/.test(await $text(".code .src")) &&
    !/dimmer_trace\(/.test(await $text(".code .src")),
);
await page.click("#panel-tab-project");
await page.click('input[aria-label="Trace hook"]');
await page.click("#panel-tab-code");
check(
  "...and the trace hook once options.trace is on",
  /void dimmer_trace\(void \*user, enum dimmer_trace_kind kind, uint16_t id\);/.test(await $text(".code .src")),
);
await page.click("#panel-tab-project");
await page.click('input[aria-label="Trace hook"]');
await codeIn("rust");
{
  // Generate writes the language picked in the Project tab (Rust here); in a browser as downloads.
  const [dl] = await Promise.all([
    page.waitForEvent("download"),
    page.click(".cfile button:has-text('Generate Rust')"),
  ]);
  check("the Code tab's Generate writes the selected language", dl.suggestedFilename() === "dimmer.rs");
  await page.click("#panel-tab-project");
  await page.selectOption('select[aria-label="Language"]', "c");
  const got = [];
  const onDl = (d) => got.push(d.suggestedFilename());
  page.on("download", onDl);
  await page.click(".generate-row button:has-text('Generate')");
  await page.waitForTimeout(300);
  check("the Project tab's Generate writes C", got.sort().join() === "dimmer.c,dimmer.h", got.join());
  got.length = 0;
  await page.evaluate(() => document.activeElement?.blur());
  await page.keyboard.press("Control+Shift+B");
  await page.waitForTimeout(300);
  check("Ctrl+Shift+B generates too", got.sort().join() === "dimmer.c,dimmer.h", got.join());
  page.off("download", onDl);
  await page.click("#panel-tab-code");
}
const both = [];
page.on("download", (d) => both.push(d.suggestedFilename()));
await page.click(".cfile button:has-text('Save both…')");
await page.waitForTimeout(300);
check("Save both… writes header and source", both.sort().join() === "dimmer.c,dimmer.h", both.join());
if (shots) await page.screenshot({ path: `${shots}/code.png` });
await U(
  "closeTab",
  (await U("tabs")).findIndex((t) => t.active),
  true,
);
await U(
  "closeTab",
  (await U("tabs")).findIndex((t) => t.active),
  true,
);
// ---------------------------------------------------------------- texts clipped to small states; paper size
{
  const clip = {
    format: "ufsm",
    version: 1,
    name: "clip",
    declarations: {
      events: [],
      signals: [],
      actions: [{ id: "act1", name: "doSomethingWithAVeryLongName" }],
      guards: [],
    },
    machine: {
      root: {
        id: "r0",
        states: [
          {
            id: "s1",
            kind: "state",
            name: "AVeryLongStateNameThatDoesNotFit",
            entry: [{ call: "act1" }],
            regions: [{ id: "r1", name: "aLongRegionNameToo", states: [] }],
          },
          { id: "s2", kind: "state", name: "Far" },
        ],
      },
      transitions: [],
    },
    diagram: {
      paper: "A4",
      states: { s1: { x: 100, y: 100, w: 80, h: 120 }, s2: { x: 1700, y: 100, w: 100, h: 60 } },
      regions: {},
      transitions: {},
    },
  };
  await page.evaluate(([t]) => window.ufsm.load(t, "clip.ufsm"), [JSON.stringify(clip)]);
  await page.waitForTimeout(200);
  await page.mouse.move(5, 5);
  /** Pixels in a world rectangle that differ from the sheet. */
  const inked = async (x0, y0, x1, y1) => {
    const [a, b] = await w2s(x0, y0),
      [c, d] = await w2s(x1, y1);
    return page.evaluate(
      async ([a, b, c, d, sheet]) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cv = document.getElementById("canvas"),
          r = cv.getBoundingClientRect(),
          k = window.devicePixelRatio || 1;
        const img = cv
          .getContext("2d")
          .getImageData(
            Math.round((a - r.left) * k),
            Math.round((b - r.top) * k),
            Math.max(1, Math.round((c - a) * k)),
            Math.max(1, Math.round((d - b) * k)),
          );
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if ([img.data[i], img.data[i + 1], img.data[i + 2]].join() !== sheet) n++;
        return n;
      },
      [a, b, c, d, SHEET],
    );
  };
  // beside the state, clear of the grid dots (every 20 units): nothing of its name, entry action or region name
  // (the name's row is sampled below the warning badge on the state's top-right corner: the state is too small for its action)
  const spill =
    (await inked(184, 116, 199, 126)) + (await inked(184, 136, 199, 158)) + (await inked(184, 176, 199, 198));
  check("texts are clipped to a state that is too small for them: nothing spills out", spill === 0, String(spill));
  check(
    "...and they are still drawn inside it",
    (await inked(104, 104, 176, 126)) > 20 &&
      (await inked(104, 136, 176, 158)) > 20 &&
      (await inked(104, 176, 176, 198)) > 20,
  );
  check(
    "...and the design rule check says the state is too small for its actions",
    (await U("problems")).some((d) => d.code === "actions-clipped" && d.id === "s1"),
  );
  await page.click("#panel-tab-project");
  check(
    "Project warns when states lie beyond the sheet",
    /1 element lies outside the frame on A4/.test((await $text(".paper-warn")) ?? ""),
    String(await $text(".paper-warn")),
  );
  await page.selectOption('select[aria-label="Paper size"]', "A3");
  check(
    "...and the warning goes once the sheet is big enough",
    (await $count(".paper-warn")) === 0 && JSON.parse(await U("serialize")).diagram.paper === "A3",
  );
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
}
// ---------------------------------------------------------------- action block: icons, wrapping, resizing, hidden lines
{
  const acts = [
    "initMotor",
    "ledOn",
    "startLog",
    "armWatchdog",
    "openValve",
    "clearFault",
    "stopMotor",
    "ledOff",
    "stopLog",
    "closeValve",
    "aInt",
    "poll",
    "count",
  ];
  const blockDoc = {
    format: "ufsm",
    version: 1,
    name: "block",
    declarations: {
      events: [
        { id: "ev1", name: "eTimeout" },
        { id: "ev2", name: "eTick" },
        { id: "ev3", name: "eIdle" },
        { id: "ev4", name: "eInt" },
      ],
      signals: [],
      actions: acts.map((name, i) => ({ id: `act${i + 1}`, name })),
      guards: [{ id: "grd1", name: "gReady" }],
    },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "s1", kind: "initial" },
          {
            id: "s2",
            kind: "state",
            name: "P",
            entry: [1, 2, 3, 4, 5, 6].map((i) => ({ call: `act${i}` })),
            exit: [7, 8, 9, 10].map((i) => ({ call: `act${i}` })),
            timers: [
              { id: "tm1", name: "travel", after: 2, unit: "s", event: "ev1" },
              { id: "tm2", name: "poll", every: 100, unit: "ms", event: "ev2" },
              { id: "tm3", name: "idle", after: 5, unit: "min", event: "ev3" },
            ],
            internal: [
              { id: "t2", on: "ev4", do: [{ call: "act11" }] },
              { id: "t3", on: "ev2", guard: [{ call: "grd1" }], do: [{ call: "act12" }, { call: "act13" }] },
            ],
            regions: [
              {
                id: "r1",
                states: [
                  { id: "s3", kind: "initial" },
                  { id: "s4", kind: "state", name: "A" },
                ],
              },
              {
                id: "r2",
                states: [
                  { id: "s5", kind: "initial" },
                  { id: "s6", kind: "state", name: "B" },
                ],
              },
            ],
          },
        ],
      },
      transitions: [
        { id: "t1", from: "s1", to: "s2" },
        { id: "t4", from: "s3", to: "s4" },
        { id: "t5", from: "s5", to: "s6" },
      ],
    },
    diagram: {
      paper: "A4",
      states: {
        s1: { x: 40, y: 60, w: 20, h: 20 },
        s2: { x: 100, y: 40, w: 300, h: 520 },
        s3: { x: 20, y: 250, w: 20, h: 20 },
        s4: { x: 80, y: 240, w: 100, h: 50 },
        s5: { x: 20, y: 420, w: 20, h: 20 },
        s6: { x: 80, y: 410, w: 100, h: 50 },
      },
      regions: { r1: { h: 150 } },
      transitions: { t1: { route: "s" }, t4: { route: "s" }, t5: { route: "s" } },
    },
  };
  await page.evaluate(([t]) => window.ufsm.load(t, "block.ufsm"), [JSON.stringify(blockDoc)]);
  await page.waitForTimeout(200);
  const AB = () => U("actionBlock", "s2");
  const layout = () => U("serialize").then((t) => JSON.parse(t).diagram);
  const kb = await scale();
  let ab = await AB();
  check(
    "the action block wraps entry and exit lists to the state's width and packs the timers",
    ab.rows.length === 9 &&
      ab.height === 190 &&
      ab.rows[1].continued &&
      ab.rows[5].segments.length === 2 &&
      !ab.hiddenMarker,
    JSON.stringify(ab.rows.map((r) => r.segments.map((g) => g.text))),
  );
  check(
    "no problems: everything fits",
    (await U("problems")).filter((d) => d.code.startsWith("actions-")).length === 0,
    JSON.stringify(await U("problems")),
  );
  // an icon is drawn in the gutter of the first line (state at 100,40: header 30, first line centred 15 below it)
  const gutter = await page.evaluate(
    async ([a, b, c, d]) => {
      await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
      const cv = document.getElementById("canvas"),
        r = cv.getBoundingClientRect(),
        k = window.devicePixelRatio || 1;
      const img = cv
        .getContext("2d")
        .getImageData(
          Math.round((a - r.left) * k),
          Math.round((b - r.top) * k),
          Math.max(1, Math.round((c - a) * k)),
          Math.max(1, Math.round((d - b) * k)),
        );
      const first = [img.data[0], img.data[1], img.data[2]].join();
      let n = 0;
      for (let i = 0; i < img.data.length; i += 4)
        if ([img.data[i], img.data[i + 1], img.data[i + 2]].join() !== first) n++;
      return n;
    },
    [...(await w2s(110, 77)), ...(await w2s(126, 93))],
  );
  check("each kind of line starts with its icon", gutter > 10, String(gutter));
  await U("select", ["s2"]);
  let grip = (await handles()).find((h) => h.kind === "actions");
  check(
    "a selected state has a handle on the bottom line of its action block",
    !!grip && Math.abs(grip.screen[1] - (await w2s(0, 40 + 30 + 190))[1]) < 1,
    JSON.stringify(await handles()),
  );
  await page.mouse.move(grip.screen[0] - 60 * kb, grip.screen[1]);
  check("...that grabs along the whole line", (await cursor()) === "ns-resize", await cursor());
  await drag([grip.screen[0] - 60 * kb, grip.screen[1]], [grip.screen[0] - 60 * kb, grip.screen[1] - 96 * kb]);
  ab = await AB();
  let dia = await layout();
  check(
    "dragging it up hides whole lines: the height is stored",
    dia.states.s2.actionsHeight === 90 && ab.visible === 4 && ab.height === 90,
    JSON.stringify(dia.states.s2),
  );
  check(
    "...the marker counts what is hidden, per kind",
    !!ab.hiddenMarker &&
      ab.hiddenMarker.parts.map((p) => `${p.icon}${p.text}`).join() === "exit1,after2,every1,internal2" &&
      ab.cut,
    JSON.stringify(ab.hiddenMarker),
  );
  check(
    "...the first region band takes the room, the separator below it stays",
    dia.regions.r1.h === 250,
    JSON.stringify(dia.regions),
  );
  check(
    "...and nothing is reported: the lines are hidden on purpose",
    (await U("problems")).filter((d) => d.code.startsWith("actions-")).length === 0,
  );
  check(
    "...in one undo step",
    (await U("undo"),
    (await layout()).states.s2.actionsHeight === undefined && (await layout()).regions.r1.h === 150) &&
      (await U("redo"), (await layout()).states.s2.actionsHeight === 90),
  );
  await page.mouse.move(5, 5);
  await page.mouse.click(...ab.hiddenMarkerScreen);
  await page.waitForTimeout(100);
  dia = await layout();
  check(
    "a click on the marker shows every line again",
    dia.states.s2.actionsHeight === undefined && dia.regions.r1.h === 150 && !(await AB()).hiddenMarker,
    JSON.stringify(dia.states.s2),
  );
  grip = (await handles()).find((h) => h.kind === "actions");
  await drag(grip.screen, [grip.screen[0], grip.screen[1] - 400 * kb]);
  ab = await AB();
  check(
    "dragged to the top, one line is left: the number of items per kind",
    (await layout()).states.s2.actionsHeight === 30 &&
      ab.summary &&
      ab.summaryRow.map((g) => `${g.icon}${g.text}`).join() === "entry6,exit4,after2,every1,internal2",
    JSON.stringify(ab.summaryRow),
  );
  // A is moved up: the block may grow down to the last whole line above it
  await U("select", ["s4"]);
  let [ax, ay] = await center("s4");
  await drag([ax, ay], [ax, ay - 40 * kb]);
  check("(A moved up by 40)", (await box("s4")).y === 240, JSON.stringify(await box("s4")));
  await U("select", ["s2"]);
  grip = (await handles()).find((h) => h.kind === "actions");
  await drag(grip.screen, [grip.screen[0], grip.screen[1] + 400 * kb]);
  dia = await layout();
  check(
    "dragging down stops above the first region's contents, at a whole line",
    dia.states.s2.actionsHeight === 170 && (await AB()).visible === 8,
    JSON.stringify(dia.states.s2),
  );
  await page.mouse.click(...(await w2s(50, 400)));
  check("(nothing selected)", (await sel()).length === 0);
  await page.mouse.click(...(await AB()).hiddenMarkerScreen);
  await page.waitForTimeout(100);
  check(
    "the marker also works on a state that is not selected: it selects it, and the same limit holds",
    (await sel()).join() === "s2" && (await layout()).states.s2.actionsHeight === 170,
    JSON.stringify(await sel()),
  );
  await U("select", ["s4"]);
  [ax, ay] = await center("s4");
  await drag([ax, ay], [ax, ay + 40 * kb]);
  await U("select", ["s2"]);
  grip = (await handles()).find((h) => h.kind === "actions");
  await page.mouse.dblclick(grip.screen[0] - 60 * kb, grip.screen[1]);
  await page.waitForTimeout(100);
  check(
    "a double-click on the handle makes the block automatic again",
    (await layout()).states.s2.actionsHeight === undefined && (await AB()).height === 190,
    JSON.stringify((await layout()).states.s2),
  );
  if (shots) await page.screenshot({ path: `${shots}/action-block.png` });
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
}
// ---------------------------------------------------------------- Settings: color theme
await page.evaluate(([t]) => window.ufsm.load(t, "theme.ufsm"), [text]);
await page.waitForTimeout(100);
const cssVar = (n) => page.evaluate((n) => getComputedStyle(document.documentElement).getPropertyValue(n).trim(), n);
const themeKey = async () => {
  const t = await U("theme");
  return `${t.inputs.appearance} ${t.inputs.contrast}`;
};
const hex = (p) => "#" + p.map((v) => v.toString(16).padStart(2, "0")).join("");
/** The sheet (a point of the paper between grid dots, outside every state) and the canvas corner (around the sheet). */
const sheetPx = async () => hex(await pixel(...(await w2s(10, 10))));
const cornerPx = async () => {
  const left = await page.evaluate(() => document.getElementById("canvas").getBoundingClientRect().left);
  const [sx, sy] = await w2s(0, 10);
  return hex(await pixel((left + sx) / 2, sy));
};
await page.click("#fit");
{
  const c = await page.evaluate(() => {
    const b = document.getElementById("canvas").getBoundingClientRect();
    return [b.left, b.top + b.height / 2, b.left + b.width / 2];
  });
  await page.mouse.move(c[2], c[1]);
  await page.mouse.wheel(0, 400);
  await page.waitForTimeout(50);
  check(
    "zoomed out, the sheet has a margin on the left",
    (await w2s(0, 0))[0] > c[0] + 20,
    `${(await w2s(0, 0))[0]} vs ${c[0]}`,
  );
}
check(
  "the default theme follows the OS (dark here): gruvbox dark medium",
  (await themeKey()) === "dark medium" && (await cssVar("--card")) === "#282828" && (await sheetPx()) === "#282828",
  `${await themeKey()} ${await sheetPx()}`,
);
await page.click(".menu-label >> text=File");
await page.click(".menu-item >> text=Settings");
check(
  "File › Settings opens the Settings tab",
  (await U("panelTab")) === "settings" && (await $text(".panel-tab.active")) === "Settings",
);
const radios = (label) =>
  page.$$eval(`.segmented[aria-label="${label}"] button`, (bs) =>
    bs.map((b) => b.textContent + (b.getAttribute("aria-checked") === "true" ? "*" : "")).join(),
  );
check(
  "Appearance offers System, Dark, Light (System chosen)",
  (await radios("Appearance")) === "System*,Dark,Light",
  await radios("Appearance"),
);
check(
  "Contrast offers Hard, Medium, Soft (Medium in use)",
  (await radios("Contrast")) === "Hard,Medium*,Soft",
  await radios("Contrast"),
);
check(
  "the theme picker lists the bundled themes",
  (await page.$$eval('select[aria-label="Theme"] option', (o) => o.map((x) => x.textContent).join())) ===
    "Catppuccin,Everforest,Gruvbox,Solarized",
);
check("a strip of swatches shows the palette", (await $count(".swatches .swatch")) === 11);
const expected = {
  "dark hard": ["#1d2021", "#141617"],
  "dark medium": ["#282828", "#1d2021"],
  "dark soft": ["#32302f", "#282828"],
  "light hard": ["#f9f5d7", "#ebdbb2"],
  "light medium": ["#fbf1c7", "#ebdbb2"],
  "light soft": ["#f2e5bc", "#ebdbb2"],
};
for (const appearance of ["Light", "Dark"]) {
  await page.click(`.segmented[aria-label="Appearance"] button:has-text("${appearance}")`);
  for (const contrast of ["Hard", "Soft", "Medium"]) {
    await page.click(`.segmented[aria-label="Contrast"] button:has-text("${contrast}")`);
    await page.waitForTimeout(50);
    const key = `${appearance} ${contrast}`.toLowerCase();
    const [paper, around] = expected[key];
    const got = [
      await themeKey(),
      await cssVar("--card"),
      await sheetPx(),
      await cornerPx(),
      await page.evaluate(() => document.documentElement.style.colorScheme),
    ];
    check(
      `${key}: panel, sheet and surround repainted`,
      got.join() === [key, paper, paper, around, appearance.toLowerCase()].join(),
      got.join(),
    );
    if (shots && contrast === "Medium")
      await page.screenshot({ path: `${shots}/theme-${appearance.toLowerCase()}.png` });
  }
}
await page.click('.segmented[aria-label="Appearance"] button:has-text("Light")');
check(
  "the settings are saved as settings.json text",
  JSON.parse(await page.evaluate(() => localStorage.getItem("ufsm.settings"))).theme.appearance === "light" &&
    (await U("settings")) ===
      '{\n  "theme": {\n    "name": "gruvbox",\n    "appearance": "light",\n    "contrast": "medium"\n  }\n}\n',
  await U("settings"),
);
check("the Settings tab says where they are kept", /browser/.test(await $text(".settings-location")));
await page.click('.segmented[aria-label="Appearance"] button:has-text("System")');
check("System follows the OS: dark", (await themeKey()) === "dark medium");
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(50);
check(
  "...and switches when the OS turns light",
  (await themeKey()) === "light medium" &&
    (await sheetPx()) === "#fbf1c7" &&
    (await radios("Appearance")) === "System*,Dark,Light",
  `${await themeKey()} ${await sheetPx()}`,
);
await page.click('.segmented[aria-label="Contrast"] button:has-text("Hard")');
await page.click('.segmented[aria-label="Appearance"] button:has-text("Dark")');
await page.emulateMedia({ colorScheme: "dark" });
await page.emulateMedia({ colorScheme: "light" });
await page.waitForTimeout(50);
check("an explicit Dark ignores the OS", (await themeKey()) === "dark hard");
await page.reload();
await page.waitForTimeout(300);
check(
  "after a reload the theme is the saved one, from the first paint",
  (await themeKey()) === "dark hard" && (await cssVar("--card")) === "#1d2021",
);
await page.evaluate(() =>
  localStorage.setItem(
    "ufsm.settings",
    '{"theme": {"name": "gruvbox", "appearance": "light", "contrast": "extreme"}, "future": true}',
  ),
);
await page.reload();
await page.waitForTimeout(300);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Settings");
check(
  "an invalid option falls back and is reported in the tab",
  (await themeKey()) === "light medium" && /no value "extreme"/.test(await $text(".settings-problems")),
  await $text(".settings-problems"),
);
await page.click('.segmented[aria-label="Contrast"] button:has-text("Soft")');
check(
  "saving keeps keys this version does not know",
  JSON.parse(await page.evaluate(() => localStorage.getItem("ufsm.settings"))).future === true,
);
if (shots) await page.screenshot({ path: `${shots}/settings.png` });
// ---------------------------------------------------------------- Settings: Everforest, Solarized, Catppuccin
{
  const pickTheme = async (label) => {
    await page.selectOption('select[aria-label="Theme"]', { label });
    await page.waitForTimeout(50);
  };
  const pickAppearance = async (a) => {
    await page.click(`.segmented[aria-label="Appearance"] button:has-text("${a}")`);
    await page.waitForTimeout(50);
  };
  const themeNow = async () => {
    const t = await U("theme");
    return [t.id, ...Object.values(t.inputs)].join(" ");
  };
  // The reload above closed the model: open it again, zoomed out so the sheet has a margin on the left.
  await page.evaluate(([t]) => window.ufsm.load(t, "theme.ufsm"), [text]);
  await page.waitForTimeout(100);
  await page.click("#fit");
  {
    const c = await page.evaluate(() => {
      const b = document.getElementById("canvas").getBoundingClientRect();
      return [b.top + b.height / 2, b.left + b.width / 2];
    });
    await page.mouse.move(c[1], c[0]);
    await page.mouse.wheel(0, 400);
    await page.waitForTimeout(50);
  }
  const want = {
    "everforest dark medium": ["#2d353b", "#232a2e"],
    "everforest light medium": ["#fdf6e3", "#efebd4"],
    "solarized dark": ["#002b36", "#00202b"],
    "solarized light": ["#fdf6e3", "#eee8d5"],
    "catppuccin dark mocha": ["#1e1e2e", "#181825"],
    "catppuccin light mocha": ["#eff1f5", "#e6e9ef"],
  };
  for (const [label, id] of [
    ["Everforest", "everforest"],
    ["Solarized", "solarized"],
    ["Catppuccin", "catppuccin"],
  ]) {
    await pickTheme(label);
    for (const appearance of ["Dark", "Light"]) {
      await pickAppearance(appearance);
      const key = await themeNow();
      const got = [
        await cssVar("--card"),
        await sheetPx(),
        await cornerPx(),
        await page.evaluate(() => document.documentElement.style.colorScheme),
      ];
      check(
        `${key}: panel, sheet and surround repainted`,
        !!want[key] && got.join() === [want[key][0], ...want[key], appearance.toLowerCase()].join(),
        `${key}: ${got.join()}`,
      );
      if (shots) await page.screenshot({ path: `${shots}/theme-${id}-${appearance.toLowerCase()}.png` });
    }
    const controls = await page.$$eval(".settings-fields .segmented[role=radiogroup]", (g) =>
      g.map((x) => x.getAttribute("aria-label")).join(),
    );
    check(
      `${label} offers its own options`,
      controls ===
        { Everforest: "Appearance,Contrast", Solarized: "Appearance", Catppuccin: "Appearance,Flavor" }[label],
      controls,
    );
  }
  // Catppuccin: light is always Latte, so the (dark) flavor is shown but greyed out.
  check(
    "Catppuccin light: Flavor shows the dark flavor, disabled",
    (await radios("Flavor")) === "Frappe,Macchiato,Mocha*" &&
      (await page.$$eval('.segmented[aria-label="Flavor"] button', (bs) => bs.every((b) => b.disabled))) &&
      /No effect with appearance light/.test(await page.getAttribute('.segmented[aria-label="Flavor"]', "title")),
    await radios("Flavor"),
  );
  await pickAppearance("Dark");
  check(
    "...and enabled when dark",
    (await page.$$eval('.segmented[aria-label="Flavor"] button', (bs) => bs.every((b) => !b.disabled))) &&
      !(await page.getAttribute('.segmented[aria-label="Flavor"]', "title")),
    `${await themeNow()} ${await page.getAttribute('.segmented[aria-label="Flavor"]', "title")} ${await page.$$eval('.segmented[aria-label="Flavor"] button', (bs) => bs.map((b) => b.disabled).join())}`,
  );
  await page.click('.segmented[aria-label="Flavor"] button:has-text("Frappe")');
  await page.waitForTimeout(50);
  check(
    "Flavor Frappe repaints with Frappé's base and is saved",
    (await themeNow()) === "catppuccin dark frappe" &&
      (await sheetPx()) === "#303446" &&
      (await U("settings")) ===
        '{\n  "theme": {\n    "name": "catppuccin",\n    "appearance": "dark",\n    "flavor": "frappe"\n  },\n  "future": true\n}\n',
    await U("settings"),
  );
  await page.reload();
  await page.waitForTimeout(300);
  check(
    "...and kept across a reload",
    (await themeNow()) === "catppuccin dark frappe" && (await cssVar("--card")) === "#303446",
  );
  await page.click(".menu-label >> text=View");
  await page.click(".menu-item >> text=Settings");
  await pickTheme("Gruvbox");
  check(
    "back to Gruvbox: its own options at their defaults, the flavor dropped",
    (await themeNow()) === "gruvbox dark medium" &&
      (await cssVar("--card")) === "#282828" &&
      !/flavor/.test(await U("settings")),
    `${await themeNow()} ${await sheetPx()} ${await U("settings")}`,
  );
}
await page.evaluate(() => localStorage.removeItem("ufsm.settings"));

// ---------------------------------------------------------------- Settings: UI zoom (never the canvas)
await page.emulateMedia({ colorScheme: "dark" }); // gruvbox dark medium again, for ORANGE below
await page.reload();
await page.waitForTimeout(300);
await page.evaluate(([t]) => window.ufsm.load(t, "zoom.ufsm"), [text]);
await page.waitForTimeout(100);
const rectOf = (sel) =>
  page.evaluate((s) => {
    const r = document.querySelector(s).getBoundingClientRect();
    return { w: r.width, h: r.height, x: r.x };
  }, sel);
const uiZoomVar = () => cssVar("--ui-zoom");
const near = (a, b) => Math.abs(a - b) < 0.6;
const status0 = (await rectOf(".statusbar")).h,
  title0 = (await rectOf(".titlebar")).h,
  side0 = (await rectOf("#sidebar")).w;
const view0 = (await U("view")).scale,
  kZoom0 = await scale();
check("UI zoom starts at 100%", (await U("zoom")) === 100 && (await uiZoomVar()) === "1");
await page.keyboard.press("Control+Equal");
check(
  "Ctrl+= zooms the UI in to 110%: title bar, explorer and status bar grow",
  (await U("zoom")) === 110 &&
    (await uiZoomVar()) === "1.1" &&
    near((await rectOf(".statusbar")).h, status0 * 1.1) &&
    near((await rectOf(".titlebar")).h, title0 * 1.1) &&
    near((await rectOf("#sidebar")).w, side0 * 1.1),
  `${await U("zoom")} ${(await rectOf(".statusbar")).h}`,
);
check("...and says so in the status line", (await $text("#status")) === "UI zoom 110%", await $text("#status"));
await page.keyboard.press("Control+Shift+Equal");
check(
  "Ctrl++ (the + key) zooms in again: 125%",
  (await U("zoom")) === 125 && near((await rectOf(".statusbar")).h, status0 * 1.25),
);
check(
  "the canvas keeps its own zoom: same view scale and world-to-screen scale",
  (await U("view")).scale === view0 && Math.abs((await scale()) - kZoom0) < 1e-9,
  `${(await U("view")).scale} vs ${view0}`,
);
{
  const font = await page.evaluate(() => getComputedStyle(document.getElementById("canvas")).zoom);
  check("the canvas is not zoomed", font === "1", font);
  [x, y] = await center("s3");
  await page.mouse.click(x, y);
  check(
    "clicking a state on the canvas still hits it at 125%",
    JSON.stringify(await sel()) === '["s3"]',
    JSON.stringify(await sel()),
  );
  const sb = await box("s3");
  const [ex, ey] = await w2s(sb.x, sb.y + sb.h / 2);
  check(
    "...and the selection is drawn where the state is",
    (await pixel(ex, ey)).join() === ORANGE,
    JSON.stringify(await pixel(ex, ey)),
  );
  await page.keyboard.press("Escape");
}
await page.keyboard.press("Control+Minus");
check("Ctrl+- zooms out to 110%", (await U("zoom")) === 110);
await page.keyboard.press("Control+0");
check(
  "Ctrl+0 resets to 100%",
  (await U("zoom")) === 100 && (await uiZoomVar()) === "1" && near((await rectOf(".statusbar")).h, status0),
);
await page.keyboard.press("Equal");
await page.keyboard.press("Minus");
check("without Ctrl the keys do nothing", (await U("zoom")) === 100);
await page.click(".menu-label >> text=View");
check("View › Reset Zoom is off at 100%", await page.$eval('.menu-item:has-text("Reset Zoom")', (e) => e.disabled));
await page.click(".menu-item >> text=Zoom In");
check("View › Zoom In", (await U("zoom")) === 110);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Zoom Out");
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Zoom Out");
check(
  "View › Zoom Out (twice: 90%), smaller than normal",
  (await U("zoom")) === 90 && (await rectOf(".statusbar")).h < status0,
);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Reset Zoom");
check("View › Reset Zoom", (await U("zoom")) === 100);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Settings");
check(
  "the Settings tab shows the UI zoom",
  (await $text(".zoom-value")) === "100%" && (await page.$eval(".zoom-reset", (e) => e.disabled)),
);
await page.click(".zoom-in");
await page.click(".zoom-in");
check(
  "its + button zooms in (125%), the value follows",
  (await U("zoom")) === 125 && (await $text(".zoom-value")) === "125%",
);
check(
  "the zoom is saved in settings.json",
  JSON.parse(await page.evaluate(() => localStorage.getItem("ufsm.settings"))).zoom === 125 &&
    /"zoom": 125/.test(await U("settings")),
);
await page.click(".zoom-out");
check("its − button zooms out (110%)", (await U("zoom")) === 110);
await page.click(".zoom-reset");
check(
  "Reset goes back to 100% and drops the key from the file",
  (await U("zoom")) === 100 &&
    !/zoom/.test(await U("settings")) &&
    (await page.$eval(".zoom-reset", (e) => e.disabled)),
);
await page.click("#search");
await page.keyboard.press("Control+Equal");
check(
  "Ctrl+= works while typing in a field, and types nothing",
  (await U("zoom")) === 110 && (await page.$eval("#search", (e) => e.value)) === "",
  await page.$eval("#search", (e) => e.value),
);
await page.keyboard.press("Escape");
for (let i = 0; i < 15; i++) await page.keyboard.press("Control+Equal");
check(
  "Zoom In stops at 300%",
  (await U("zoom")) === 300 &&
    (await page.$eval(".zoom-in", (e) => e.disabled)) &&
    /largest/.test(await $text("#status")),
  await $text("#status"),
);
for (let i = 0; i < 15; i++) await page.keyboard.press("Control+Minus");
check("Zoom Out stops at 50%", (await U("zoom")) === 50 && (await page.$eval(".zoom-out", (e) => e.disabled)));
await page.keyboard.press("Control+0");
await page.keyboard.press("Control+Shift+Equal");
await page.keyboard.press("Control+Shift+Equal");
{
  const before = (await rectOf("#sidebar")).w;
  const sh = await page.evaluate(() => {
    const r = document.getElementById("sash-left").getBoundingClientRect();
    return [r.x + r.width / 2, r.y + 200];
  });
  await drag(sh, [sh[0] + 100, sh[1]]);
  check(
    "at 125% the sash still follows the pointer",
    Math.abs((await rectOf("#sidebar")).w - before - 100) <= 1.5,
    `${(await rectOf("#sidebar")).w - before}`,
  );
  await page.dblclick("#sash-left");
}
if (shots) await page.screenshot({ path: `${shots}/ui-zoom.png` });
await page.reload();
await page.waitForTimeout(300);
check(
  "after a reload the UI zoom is the saved one, from the first paint",
  (await U("zoom")) === 125 && (await uiZoomVar()) === "1.25",
);
await page.evaluate(() => localStorage.setItem("ufsm.settings", '{"zoom": 1000}'));
await page.reload();
await page.waitForTimeout(300);
await page.click(".menu-label >> text=View");
await page.click(".menu-item >> text=Settings");
check(
  "a zoom out of range is clamped and reported",
  (await U("zoom")) === 300 && /zoom must be 50 to 300/.test(await $text(".settings-problems")),
  await $text(".settings-problems"),
);
await page.evaluate(() => localStorage.removeItem("ufsm.settings"));
// 21. search (title bar, Ctrl+P), after VS Code's Quick Open and command palette: every open machine (the one in focus
// first), commands, settings
await page.reload();
await page.waitForTimeout(300);
await page.evaluate(() => localStorage.removeItem("ufsm.searchRecent"));
{
  const dhcpText = readFileSync(join(repo, "examples/dhcpclient.ufsm"), "utf8");
  await page.evaluate(
    ([a, b]) => {
      window.ufsm.load(a, "edit.ufsm");
      window.ufsm.load(b, "dhcpclient.ufsm");
      window.ufsm.load(a, "edit2.ufsm");
    },
    [text, dhcpText],
  );
  await U("activateTab", 0);
  const qp = () =>
    page.$$eval(".qp-row", (rs) =>
      rs.map((r) => ({
        label: r.querySelector(".qp-label")?.textContent,
        detail: r.querySelector(".qp-detail")?.textContent ?? "",
        doc: r.querySelector(".qp-doc")?.textContent ?? "",
        keys: [...r.querySelectorAll("kbd")].map((k) => k.textContent).join(" "),
        group: r.querySelector(".qp-group")?.textContent ?? "",
        checked: !!r.querySelector(".qp-check"),
        active: r.classList.contains("active"),
        marks: [...r.querySelectorAll(".qp-label mark")].map((m) => m.textContent).join(""),
      })),
    );
  const searchValue = () => page.$eval("#search", (e) => e.value);
  const focused = () =>
    page.evaluate(
      () =>
        document.activeElement?.id ||
        document.activeElement?.getAttribute("aria-label") ||
        document.activeElement?.tagName,
    );
  const activeTab = async () => (await U("tabs")).find((t) => t.active)?.name;
  const open = () => page.$("#search-results").then((e) => e !== null);

  await page.keyboard.press("Control+p");
  check("Ctrl+P opens the search with the focus in the field", (await focused()) === "search" && (await open()));
  let r = await qp();
  check(
    "empty, it lists the four ways to search (nothing picked yet)",
    r.length === 4 && r[0].label === "…" && r.map((x) => x.label.charAt(0)).join("") === "…>@#",
    JSON.stringify(r.map((x) => x.label)),
  );
  check(
    "the placeholder says what it finds and points to the prefixes",
    /^Search states, transitions, commands, settings \(\? for more\)$/.test(
      await page.getAttribute("#search", "placeholder"),
    ),
  );
  if (shots) await page.screenshot({ path: `${shots}/search-empty.png` });

  await page.keyboard.type("requ");
  r = await qp();
  check(
    "typing finds a state in another open machine, named at the right",
    r[0]?.label === "Requesting" && r[0].doc === "dhcpclient.ufsm" && r[0].active && r[0].marks === "Requ",
    JSON.stringify(r[0]),
  );
  await page.keyboard.press("Enter");
  check(
    "Enter shows it: that machine's tab, the state selected",
    (await activeTab()) === "dhcpclient.ufsm" && (await U("selectedName")) === "Requesting" && !(await open()),
  );
  check(
    "the field is empty and has given up the focus",
    (await searchValue()) === "" && (await focused()) !== "search",
  );

  await U("activateTab", 2);
  check(
    "the machine in focus first: edit2's A before edit's A",
    JSON.stringify((await U("search", "A")).filter((x) => x.label === "A").map((x) => x.machine)) ===
      '["edit2.ufsm","edit.ufsm"]',
  );
  await page.keyboard.press("Control+p");
  await page.keyboard.type("a");
  r = await qp();
  const rowsA = r.filter((x) => x.label === "A");
  check(
    "in the list too: the focused machine's A unmarked, the other's with its file name",
    rowsA.length === 2 && rowsA[0].doc === "" && rowsA[1].doc === "edit.ufsm",
    JSON.stringify(rowsA),
  );
  if (shots) await page.screenshot({ path: `${shots}/search-a.png` });
  await page.keyboard.press("Escape");
  check("Esc closes it and clears the field", !(await open()) && (await searchValue()) === "");

  await page.keyboard.press("Control+Shift+P");
  check("Ctrl+Shift+P opens it on commands (>)", (await searchValue()) === ">" && (await focused()) === "search");
  await page.keyboard.type("add tran");
  r = await qp();
  check(
    "commands are labelled with their menu and show their keys",
    r[0]?.label === "Add: S transition" &&
      r[0].keys === "A T" &&
      r[1]?.label === "Add: Straight transition" &&
      r.length === 2,
    JSON.stringify(r),
  );
  check(
    "> lists commands and settings only",
    r.every((x) => /^[A-Z][a-z]+: /.test(x.label)),
    JSON.stringify(r.map((x) => x.label)),
  );
  if (shots) await page.screenshot({ path: `${shots}/search-commands.png` });
  await page.keyboard.press("ArrowDown");
  r = await qp();
  check("Down moves the highlight", r[1]?.active && !r[0].active);
  await page.keyboard.press("ArrowUp");
  await page.keyboard.press("Enter");
  check("Enter runs the command: the S transition tool is armed", (await U("tool")) === "transition");
  await page.keyboard.press("Escape");
  check("(Esc on the canvas disarms it again)", (await U("tool")) === "select");

  await page.keyboard.press("F1");
  check("F1 opens the commands too", (await searchValue()) === ">");
  await page.keyboard.type("delete");
  await U("select", []);
  check(
    "a command that cannot run now is not offered (Edit: Delete without a selection)",
    !(await U("search", ">delete")).some((x) => x.label === "Edit: Delete"),
  );
  await page.keyboard.press("Control+p");
  check("Ctrl+P on commands goes to the plain search, keeping the text", (await searchValue()) === "delete");
  await page.keyboard.press("Control+Shift+P");
  check("Ctrl+Shift+P goes back to commands", (await searchValue()) === ">delete");
  await page.keyboard.press("Escape");

  // settings: a highlighted theme row changes nothing until it is picked; Enter applies and saves it
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("appearance light");
  r = await qp();
  check(
    "settings are found, the value in use is checked",
    r[0]?.label === "Preferences: Appearance: Light" && !r[0].checked,
    JSON.stringify(r.slice(0, 3)),
  );
  check(
    "the highlighted appearance is not previewed, nor saved",
    (await U("theme")).appearance === "dark" && !/light/.test(await U("settings")),
  );
  await page.keyboard.press("Escape");
  check("Esc leaves the theme as it was", (await U("theme")).appearance === "dark");
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("appearance light");
  await page.keyboard.press("Enter");
  check(
    "Enter saves the setting",
    (await U("theme")).appearance === "light" && /"appearance": "light"/.test(await U("settings")),
    await U("settings"),
  );
  check(
    "the row of the setting in use is checked",
    (await U("search", ">appearance")).find((x) => x.label === "Preferences: Appearance: Light")?.checked === true,
  );
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("appearance system");
  await page.keyboard.press("Enter");
  check(
    "back to following the OS",
    (await U("theme")).appearance === "dark" && /"appearance": "system"/.test(await U("settings")),
    await U("settings"),
  );
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("theme catpp");
  await page.hover(".qp-row >> nth=0");
  check("highlighting or hovering a theme row does not preview it", (await U("theme")).id === "gruvbox");
  await page.keyboard.press("Escape");

  // project settings of the machine in focus
  await U("activateTab", 0);
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("paper a3");
  await page.keyboard.press("Enter");
  check(
    "Project: Paper Size: A3 changes the file, as one undo step",
    /"paper": "A3"/.test(await U("serialize")) && (await U("canUndo")),
  );
  await U("undo");
  await page.keyboard.press("Control+Shift+P");
  await page.keyboard.type("c prefix");
  r = await qp();
  check(
    "a code generator option shows its value (the default)",
    r[0]?.label === "Project: Code Generator: C Prefix" && /\(default\)/.test(r[0].detail),
    JSON.stringify(r[0]),
  );
  await page.keyboard.press("Enter");
  check(
    "picking it opens the Project tab with the cursor in that field",
    (await U("panelTab")) === "project" && (await focused()) === "C Prefix",
    await focused(),
  );
  await page.keyboard.press("Escape");

  // elements: transitions by their trigger, declarations
  await page.keyboard.press("Control+p");
  await page.keyboard.type("@e1");
  r = await qp();
  check(
    "@ lists the focused machine's elements only: transitions by trigger, the event",
    r.length === 6 && r.every((x) => x.doc === "") && r.some((x) => x.detail === "A → B"),
    JSON.stringify(r.map((x) => `${x.label} ${x.detail}`)),
  );
  await page.click(`.qp-row:has(.qp-detail:text-is("A → B"))`);
  check(
    "a click picks: the transition is selected",
    JSON.stringify(await sel()) === '["t2"]',
    JSON.stringify(await sel()),
  );
  await page.keyboard.press("Control+p");
  await page.keyboard.type("#dhcp_check");
  r = await qp();
  check(
    "# searches every machine: dhcpclient's guard",
    r[0]?.label === "dhcp_check" && r[0].doc === "dhcpclient.ufsm",
    JSON.stringify(r[0]),
  );
  await page.keyboard.press("Enter");
  check(
    "a declaration opens in the Project tab of its machine",
    (await activeTab()) === "dhcpclient.ufsm" &&
      (await U("panelTab")) === "project" &&
      (await page.$eval(".decl.flash input", (e) => e.value).catch(() => "")) === "dhcp_check",
  );

  // recently used, the ? list, mouse
  await page.keyboard.press("Control+p");
  r = await qp();
  check(
    "empty, it starts with what was picked lately",
    r[0]?.label === "dhcp_check" &&
      r[0].group === "recently used" &&
      r.some((x) => x.label === "Project: Code Generator: C Prefix"),
    JSON.stringify(r.map((x) => x.label)),
  );
  await page.keyboard.type("?");
  r = await qp();
  check("? lists the prefixes", r.length === 4);
  await page.hover(".qp-row:nth-child(3)");
  check("the pointer moves the highlight", (await qp())[2].active);
  await page.click(".qp-row:nth-child(3)");
  check("picking a prefix row puts it in the field", (await searchValue()) === "@" && (await open()));
  await page.mouse.click(700, 500);
  check("a click elsewhere closes the list", !(await open()));

  // menus open it too; Ctrl+P works from another field
  await page.click(".menu-label >> text=View");
  await page.click(".menu-item >> text=Command Palette…");
  check("View › Command Palette… opens it on commands", (await searchValue()) === ">" && (await open()));
  await page.keyboard.press("Escape");
  await page.click(".menu-label >> text=Go");
  await page.click(".menu-item >> text=Go to Element in Machine…");
  check("Go › Go to Element in Machine… opens it with @", (await searchValue()) === "@");
  await page.keyboard.press("Escape");
  await U("select", ["s3"]);
  await page.click(".panel-tab >> text=Properties");
  await page.click(`.pbody input[aria-label="Name"]`);
  await page.keyboard.press("Control+p");
  check("Ctrl+P also works while typing in another field", (await focused()) === "search" && (await open()));
  await page.keyboard.press("Escape");
  check("Esc gives the focus back to that field", (await focused()) === "Name", await focused());
  await page.keyboard.press("Escape");
  check(
    "the search is not offered in itself",
    !(await U("search", ">search")).some((x) =>
      /Search|Command Palette|Go to Element/.test(x.label.split(": ")[1] ?? ""),
    ),
  );
}
// ---------------------------------------------------------------- sheet frame and title block
{
  // A4: drawing area 1584 x 1090 from the sheet origin, border line 20 outside it, title block 600 x 190 in its corner
  const frame = {
    format: "ufsm",
    version: 1,
    name: "frame",
    doc: "Frame and title block.",
    declarations: { events: [], signals: [], actions: [], guards: [] },
    machine: {
      root: {
        id: "r0",
        states: [
          {
            id: "s1",
            kind: "state",
            name: "Top",
            regions: [{ id: "r1", states: [{ id: "s3", kind: "state", name: "Inner" }] }],
          },
          { id: "s2", kind: "state", name: "Plain" },
        ],
      },
      transitions: [],
    },
    diagram: {
      paper: "A4",
      states: {
        s1: { x: 100, y: 100, w: 300, h: 200 },
        s2: { x: 600, y: 300, w: 160, h: 80 },
        s3: { x: 40, y: 40, w: 160, h: 80 },
      },
      regions: { r1: { offPage: true } },
      transitions: {},
    },
  };
  const AREA = { w: 1584, h: 1090 },
    TB = { x: 984, y: 900, w: 600, h: 190 };
  await page.evaluate(([t]) => window.ufsm.load(t, "frame.ufsm"), [JSON.stringify(frame)]);
  await page.waitForTimeout(200);
  const canvasRect = () =>
    page.evaluate(() => {
      const b = document.getElementById("canvas").getBoundingClientRect();
      return [b.left, b.top, b.right, b.bottom];
    });
  const sheetVisible = async () => {
    const r = await canvasRect(),
      [p0x, p0y] = await w2s(-50, -50),
      [p1x, p1y] = await w2s(AREA.w + 50, AREA.h + 50);
    return p0x >= r[0] && p0y >= r[1] && p1x <= r[2] && p1y <= r[3];
  };
  {
    // the view fits the drawing; zoom out (wheel) until the whole sheet shows
    const r = await canvasRect();
    await page.mouse.move((r[0] + r[2]) / 2, (r[1] + r[3]) / 2);
    for (let i = 0; i < 10 && !(await sheetVisible()); i++) {
      await page.mouse.wheel(0, 200);
      await page.waitForTimeout(50);
    }
  }
  check("(the whole sheet is in view)", await sheetVisible());
  await page.mouse.move(5, 5);
  const inked = async (x0, y0, x1, y1) => {
    const [a, b] = await w2s(x0, y0),
      [c, d] = await w2s(x1, y1);
    return page.evaluate(
      async ([a, b, c, d, sheet]) => {
        await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(r)));
        const cv = document.getElementById("canvas"),
          r = cv.getBoundingClientRect(),
          k = window.devicePixelRatio || 1;
        const img = cv
          .getContext("2d")
          .getImageData(
            Math.round((a - r.left) * k),
            Math.round((b - r.top) * k),
            Math.max(1, Math.round((c - a) * k)),
            Math.max(1, Math.round((d - b) * k)),
          );
        let n = 0;
        for (let i = 0; i < img.data.length; i += 4)
          if ([img.data[i], img.data[i + 1], img.data[i + 2]].join() !== sheet) n++;
        return n;
      },
      [a, b, c, d, SHEET],
    );
  };
  check(
    "the drawing area's edge is drawn at the sheet origin",
    (await inked(300, -3, 330, 3)) > 0 && (await inked(-3, 300, 3, 330)) > 0,
  );
  check(
    "...and the border line 20 outside it",
    (await inked(300, -23, 330, -17)) > 0 && (await inked(AREA.w + 17, 300, AREA.w + 23, 330)) > 0,
  );
  check(
    "zone numbers in the band between them (1 above the first column, 6 below the last)",
    (await inked(120, -16, 145, -4)) > 0 && (await inked(AREA.w - 145, AREA.h + 4, AREA.w - 120, AREA.h + 16)) > 0,
  );
  check(
    "...letters along the sides, and nothing else in the band (no grid)",
    (await inked(-16, 125, -4, 150)) > 0 &&
      (await inked(30, -16, 90, -4)) === 0 &&
      (await inked(-16, 30, -4, 90)) === 0,
  );
  check(
    "the title block is drawn in the bottom-right corner, filled from the model",
    (await inked(TB.x + 5, TB.y + 5, TB.x + 470, TB.y + 45)) > 50 &&
      (await inked(TB.x + 5, TB.y + 55, TB.x + 590, TB.y + 80)) > 50,
  );
  const sx = 100 + 300 - 50,
    sy = 100 + 200 - 20; // A's off-page marker
  check("an off-page marker names the sheet it continues on", (await inked(sx - 60, sy - 8, sx - 14, sy + 8)) > 20);
  await U("select", ["s1"]);
  check(
    "the status line says where a selected state is drawn",
    /sheet 1, A1/.test(await U("status")),
    await U("status"),
  );

  await U("select", []);

  // the free fields: Project tab, double-click on the title block, search
  const revCell = () => inked(TB.x + 482, TB.y + 15, TB.x + 598, TB.y + 48);
  const before = await revCell();
  const [tx, ty] = await w2s(TB.x + 300, TB.y + 120);
  await page.mouse.dblclick(tx, ty);
  await page.waitForTimeout(100);
  const focusedLabel = () => page.evaluate(() => document.activeElement?.getAttribute("aria-label"));
  check(
    "double-click on the title block opens its fields in the Project tab",
    (await U("panelTab")) === "project" && (await focusedLabel()) === "Title block revision",
    `${await U("panelTab")} ${await focusedLabel()}`,
  );
  await page.keyboard.type("B");
  await page.keyboard.press("Enter");
  check(
    "a field is written to diagram.titleBlock",
    JSON.parse(await U("serialize")).diagram.titleBlock?.revision === "B",
  );
  check("...and drawn in its cell", (await revCell()) > before + 5, `${before} -> ${await revCell()}`);
  await U("undo");
  check(
    "...as one undo step",
    JSON.parse(await U("serialize")).diagram.titleBlock === undefined && (await revCell()) === before,
  );
  await page.click(".title-field button:has-text('Today')");
  check(
    "Date: Today sets the local date",
    /^\d{4}-\d\d-\d\d$/.test(JSON.parse(await U("serialize")).diagram.titleBlock?.date ?? ""),
    await U("serialize"),
  );
  const rows = (await U("search", ">title block")).filter((x) => x.label.startsWith("Project: Title Block: "));
  check("the search finds the five fields", rows.length === 5, JSON.stringify(rows.map((x) => x.label)));
  await U("openSearch", ">title block author");
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  check(
    "...and picking one puts the cursor in it",
    (await focusedLabel()) === "Title block author",
    await focusedLabel(),
  );
  await page.keyboard.press("Escape");

  // the mouse's back button goes up one level, like Backspace, and never navigates the webview's history
  {
    const cdp = await page.context().newCDPSession(page);
    const back = async (x, y) => {
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mousePressed",
        x,
        y,
        button: "back",
        buttons: 8,
        clickCount: 1,
      });
      await cdp.send("Input.dispatchMouseEvent", {
        type: "mouseReleased",
        x,
        y,
        button: "back",
        buttons: 0,
        clickCount: 1,
      });
      await page.waitForTimeout(100);
    };
    const crumbs = () => page.$$eval("#crumbs .crumb", (l) => l.map((e) => e.textContent).join(" › "));
    await page.evaluate(() => history.pushState(null, "", "#back-button"));
    await U("select", ["s1"]);
    await page.keyboard.press("Enter"); // open its off-page region
    await page.waitForTimeout(100);
    check("(Enter opened Top's sheet)", (await crumbs()) === "frame › Top", await crumbs());
    const [cx, cy] = await w2s(800, 500);
    await back(cx, cy);
    check(
      "the mouse's back button goes up one level and selects the state it came from",
      (await crumbs()) === "frame" && JSON.stringify(await sel()) === '["s1"]',
      `${await crumbs()} ${JSON.stringify(await sel())}`,
    );
    check(
      "...without navigating the webview's history",
      (await page.evaluate(() => location.hash)) === "#back-button",
      await page.evaluate(() => location.href),
    );
    await page.keyboard.press("Enter");
    await page.waitForTimeout(100);
    const [ex, ey] = await page.$eval("#explorer", (e) => {
      const b = e.getBoundingClientRect();
      return [b.left + b.width / 2, b.bottom - 20];
    });
    await back(ex, ey);
    check(
      "...also with the pointer outside the canvas (over the explorer)",
      (await crumbs()) === "frame",
      await crumbs(),
    );
    await back(cx, cy);
    check(
      "...and does nothing on the top sheet",
      (await crumbs()) === "frame" && (await page.evaluate(() => location.hash)) === "#back-button",
      `${await crumbs()} ${await page.evaluate(() => location.href)}`,
    );
    await page.evaluate(() => history.replaceState(null, "", location.pathname));
    await cdp.detach();
  }

  // fit: outside the frame, over the title block; findings name the sheet and zone
  const far = structuredClone(frame);
  far.diagram.states.s2 = { x: 1500, y: 300, w: 160, h: 80 };
  far.machine.root.states.push({ id: "s4", kind: "state", name: "Low" });
  far.diagram.states.s4 = { x: TB.x + 100, y: TB.y - 40, w: 160, h: 80 };
  await page.evaluate(([t]) => window.ufsm.load(t, "far.ufsm"), [JSON.stringify(far)]);
  await page.click("#panel-tab-project");
  check(
    "Project counts what does not fit",
    /1 element lies outside the frame, 1 overlaps the title block on A4/.test((await $text(".paper-warn")) ?? ""),
    String(await $text(".paper-warn")),
  );
  await page.click("#panel-tab-problems");
  const probs = await page.$$eval(".problems-list .msg", (l) => l.map((e) => e.textContent));
  check(
    "Problems lists both with sheet and zone",
    probs.some((t) => /state 'Plain' lies outside the frame · sheet 1, B6$/.test(t)) &&
      probs.some((t) => /state 'Low' overlaps the title block · sheet 1, D5/.test(t)),
    JSON.stringify(probs),
  );
  await page.click("#panel-tab-project");
  await page.selectOption('select[aria-label="Paper size"]', "A3");
  check("a bigger paper fits both", (await $count(".paper-warn")) === 0);
  if (shots) await page.screenshot({ path: `${shots}/sheet-frame.png` });
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );

  // an empty machine: z f shows the whole sheet
  await U("newModel");
  await page.mouse.click(700, 400);
  await page.keyboard.press("z");
  await page.keyboard.press("f");
  await page.waitForTimeout(100);
  const r = await canvasRect();
  const [p0x] = await w2s(-50, -50),
    [p1x] = await w2s(1634, 1140);
  check(
    "z f on an empty page fits the whole sheet",
    (await sheetVisible()) && p1x - p0x > (r[2] - r[0]) * 0.8,
    JSON.stringify([r, p0x, p1x]),
  );
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );

  // right-clicking anywhere opens no webview context menu, except in text fields (cut/copy/paste)
  await page.evaluate(([t]) => window.ufsm.load(t, "ctx.ufsm"), [text]);
  await page.click("#panel-tab-project");
  const blocked = await page.evaluate(() => {
    const at = (el) => {
      if (!el) return "missing";
      const e = new MouseEvent("contextmenu", { bubbles: true, cancelable: true, button: 2 });
      el.dispatchEvent(e);
      return e.defaultPrevented;
    };
    return {
      canvas: at(document.getElementById("canvas")),
      explorer: at(document.querySelector("#explorer *") ?? document.getElementById("explorer")),
      sidebar: at(document.getElementById("sidebar")),
      titlebar: at(document.querySelector("#titlebar button") ?? document.getElementById("titlebar")),
      panel: at(document.querySelector("#panel *") ?? document.getElementById("panel")),
      statusbar: at(document.getElementById("status")),
      body: at(document.body),
      input: at(document.querySelector("#panel input[type=text], #panel input:not([type]), #panel textarea")),
    };
  });
  const { input: inField, ...rest } = blocked;
  check(
    "right-click opens no context menu on canvas, explorer, menus, panel or background",
    Object.values(rest).every((v) => v === true),
    JSON.stringify(blocked),
  );
  check("...but text fields keep theirs", inField === false, JSON.stringify(blocked));
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
}
// ---------------------------------------------------------------- notes, group frames and arrows (documentation)
{
  const model = {
    format: "ufsm",
    version: 1,
    name: "notes",
    declarations: { events: [{ id: "ev1", name: "eGo" }], signals: [], actions: [], guards: [] },
    machine: {
      root: {
        id: "r0",
        states: [
          { id: "s0", kind: "initial" },
          { id: "s1", kind: "state", name: "Alpha" },
          { id: "s2", kind: "state", name: "Beta" },
        ],
      },
      transitions: [
        { id: "t1", from: "s0", to: "s1" },
        { id: "t2", from: "s1", to: "s2", on: "ev1" },
      ],
    },
    diagram: {
      paper: "A4",
      states: {
        s0: { x: 40, y: 130, w: 20, h: 20 },
        s1: { x: 100, y: 100, w: 160, h: 80 },
        s2: { x: 500, y: 100, w: 160, h: 80 },
      },
      regions: {},
      transitions: {
        t1: { from: { side: "right", offset: 10 }, to: { side: "left", offset: 40 } },
        t2: { from: { side: "right", offset: 40 }, to: { side: "left", offset: 40 } },
      },
    },
  };
  await page.evaluate(([t]) => window.ufsm.load(t, "notes.ufsm"), [JSON.stringify(model)]);
  await page.waitForTimeout(200);
  const doc = async () => JSON.parse(await U("serialize")).diagram;
  const NOTE = [131, 165, 152]; // gruvbox dark blue: canvas.note
  const near = (px, c) => px.every((v, i) => Math.abs(v - c[i]) < 24);
  const k = await scale(); // this machine's own zoom
  const empty = await w2s(400, 600);
  await page.mouse.click(empty[0], empty[1]);

  // a n: the note tool; a click opens a text field there, Ctrl+Enter keeps the text and creates the note
  await page.keyboard.press("a");
  await page.keyboard.press("n");
  check("a n arms the note tool", (await U("tool")) === "note", await U("tool"));
  let [nx, ny] = await w2s(100, 300);
  await page.mouse.click(nx, ny);
  check("a click with the note tool opens a text field on the canvas", (await U("textEditing")) === true);
  check("...and creates nothing yet", (await doc()).notes === undefined);
  await page.keyboard.type("Waits for {ev1} in {s1}");
  await page.keyboard.press("Control+Enter");
  let notes = (await doc()).notes ?? {};
  const nid = Object.keys(notes)[0];
  check(
    "Ctrl+Enter creates the note with its text, at the click, on the grid",
    nid === "n1" && notes.n1.text === "Waits for {ev1} in {s1}" && notes.n1.x === 100 && notes.n1.y === 300,
    JSON.stringify(notes),
  );
  check("the new note is selected", JSON.stringify(await sel()) === '["n1"]', JSON.stringify(await sel()));
  check("the tool is back to select", (await U("tool")) === "select");
  {
    const b = await U("annotation", "n1");
    const [lx, ly] = await w2s(b.x, b.y + b.h / 2);
    await U("select", []);
    check("a note is drawn in the note color", near(await pixel(lx, ly), NOTE), JSON.stringify(await pixel(lx, ly)));
  }
  await U("undo");
  check("undo removes the note in one step", (await doc()).notes === undefined);
  await U("redo");
  check("redo brings it back", (await doc()).notes?.n1 !== undefined);
  check(
    "the search finds a note by its text, references shown as names",
    (await U("search", "Waits")).some((r) => r.kind === "note" && r.label === "Waits for eGo in Alpha"),
    JSON.stringify(await U("search", "Waits")),
  );

  // drag a note; resize it by its right side
  {
    const b = await U("annotation", "n1");
    const [cx, cy] = await w2s(b.x + b.w / 2, b.y + b.h / 2);
    await drag([cx, cy], [cx + 40 * k, cy + 20 * k]);
    const a = await U("annotation", "n1");
    check("dragging a note moves it (on the grid)", a.x === b.x + 40 && a.y === b.y + 20, JSON.stringify([b, a]));
    const [rx, ry] = await w2s(a.x + a.w, a.y + a.h / 2);
    await drag([rx, ry], [rx + 60 * k, ry]);
    const c = await U("annotation", "n1");
    check("a selected note resizes by its side", c.w === a.w + 60 && c.x === a.x, JSON.stringify([a, c]));
  }

  // double-click edits the text in place; Esc drops the change
  {
    const b = await U("annotation", "n1");
    const [cx, cy] = await w2s(b.x + b.w / 2, b.y + b.h / 2);
    await page.mouse.dblclick(cx, cy);
    check("double-click on a note opens its text", (await U("textEditing")) === true);
    await page.keyboard.type(" (changed)");
    await page.keyboard.press("Escape");
    check(
      "Esc keeps the old text",
      (await U("textEditing")) === false && (await doc()).notes.n1.text === "Waits for {ev1} in {s1}",
    );
  }

  // a c: an arrow from the note to Beta; it stays attached when Beta moves
  await page.mouse.click(empty[0], empty[1]);
  await page.keyboard.press("a");
  await page.keyboard.press("c");
  check("a c arms the arrow tool", (await U("tool")) === "arrow", await U("tool"));
  {
    const nb = await U("annotation", "n1");
    const [fx, fy] = await w2s(nb.x + nb.w - 20, nb.y + 10);
    const [tx, ty] = await w2s(560, 170);
    await page.mouse.click(fx, fy);
    await page.mouse.click(tx, ty);
  }
  let arrows = (await doc()).arrows ?? {};
  check(
    "the arrow is attached to the note and to Beta",
    arrows.a1?.from.ref === "n1" && arrows.a1?.to.ref === "s2",
    JSON.stringify(arrows),
  );
  {
    const before = await U("annotation", "a1");
    const [bx, by] = await center("s2", -30);
    await U("select", ["s2"]);
    await drag([bx, by], [bx + 100 * k, by + 40 * k]);
    const after = await U("annotation", "a1");
    check(
      "moving Beta takes the arrow's end with it",
      after.to.x === before.to.x + 100 && after.to.y === before.to.y + 40 && after.from.x === before.from.x,
      JSON.stringify([before, after]),
    );
  }
  // drag the arrow's end onto empty canvas: a free end
  {
    await U("select", ["a1"]);
    const h = (await handles()).find((x) => x.kind === "arrowEnd" && x.end === "to");
    const [tx, ty] = await w2s(900, 500);
    await drag(h.screen, [tx, ty]);
    arrows = (await doc()).arrows;
    check(
      "dragging an arrow end onto empty canvas leaves it free there",
      arrows.a1.to.ref === undefined && arrows.a1.to.x === 900 && arrows.a1.to.y === 500,
      JSON.stringify(arrows.a1),
    );
  }

  // a g: a group frame drawn around Alpha, then its caption typed
  await page.mouse.click(empty[0], empty[1]);
  await page.keyboard.press("a");
  await page.keyboard.press("g");
  check("a g arms the frame tool", (await U("tool")) === "frame");
  {
    const [x0, y0] = await w2s(80, 60),
      [x1, y1] = await w2s(300, 220);
    await drag([x0, y0], [x1, y1]);
    check("after drawing a frame its caption is typed in place", (await U("textEditing")) === true);
    await page.keyboard.type("Start");
    await page.keyboard.press("Enter");
    const frames = (await doc()).frames ?? {};
    check(
      "the frame spans the drag and has its caption",
      JSON.stringify(frames.g1) === JSON.stringify({ region: "r0", x: 80, y: 60, w: 220, h: 160, caption: "Start" }),
      JSON.stringify(frames),
    );
    // inside the frame a click selects what is there (Alpha), its outline selects the frame
    const [ax, ay] = await center("s1");
    await page.mouse.click(ax, ay);
    check(
      "a click inside a frame selects what is under it",
      JSON.stringify(await sel()) === '["s1"]',
      JSON.stringify(await sel()),
    );
    const [ox, oy] = await w2s(80, 200);
    await page.mouse.click(ox, oy);
    check(
      "a click on its outline selects the frame",
      JSON.stringify(await sel()) === '["g1"]',
      JSON.stringify(await sel()),
    );
  }

  // Properties: TODO, listed in Problems and the status bar
  await U("select", ["n1"]);
  await page.click("#panel-tab-properties").catch(() => undefined);
  await page.waitForTimeout(100);
  {
    const box = page.locator("#panel label.check", { hasText: "TODO" }).locator("input");
    const found = (await box.count()) === 1;
    check("Properties of a note offer TODO", found);
    if (found) await box.click();
    await page.waitForTimeout(100);
    const todo = (await U("problems")).filter((p) => p.severity === "info");
    check(
      "a TODO note is listed in Problems as info",
      todo.length === 1 && todo[0].code === "todo" && todo[0].id === "n1",
      JSON.stringify(todo),
    );
    const status = await page.evaluate(() => document.getElementById("problems")?.textContent ?? "");
    check("...and counted in the status bar", /1 TODO/.test(status), status);
  }

  // the rubber band picks notes and frames; copy and paste a note
  {
    const [x0, y0] = await w2s(60, 40),
      [x1, y1] = await w2s(700, 480);
    await drag([x0, y0], [x1, y1]);
    const picked = await sel();
    check(
      "a rubber band around them selects the note and the frame",
      picked.includes("n1") && picked.includes("g1"),
      JSON.stringify(picked),
    );
    await U("select", ["n1"]);
    await page.mouse.move(empty[0], empty[1]);
    await page.keyboard.press("Control+c");
    await page.keyboard.press("Control+v");
    notes = (await doc()).notes;
    check("copy and paste a note", Object.keys(notes).length === 2, JSON.stringify(Object.keys(notes)));
  }

  // deleting what an arrow is attached to keeps the arrow, with a free end
  await U("select", ["n1"]);
  await page.mouse.move(empty[0], empty[1]);
  await page.keyboard.press("Delete");
  arrows = (await doc()).arrows;
  check(
    "deleting a note keeps the arrow attached to it, with a free end",
    arrows?.a1 !== undefined && arrows.a1.from.ref === undefined,
    JSON.stringify(arrows),
  );
  check(
    "notes never reach the generated code: no design rule errors, nothing about notes",
    (await U("problems")).every((p) => p.severity !== "error"),
    JSON.stringify(await U("problems")),
  );
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
}
// a frame and notes in a state's region: the frame is picked over the state around it, a note dropped there follows it
{
  const model = {
    format: "ufsm",
    version: 1,
    name: "regionnotes",
    declarations: { events: [], signals: [], actions: [], guards: [] },
    machine: {
      root: {
        id: "r0",
        states: [
          {
            id: "s1",
            kind: "state",
            name: "P",
            regions: [{ id: "r1", states: [{ id: "s2", kind: "state", name: "A" }] }],
          },
        ],
      },
      transitions: [],
    },
    diagram: {
      paper: "A4",
      states: { s1: { x: 100, y: 100, w: 500, h: 400 }, s2: { x: 20, y: 60, w: 100, h: 60 } },
      regions: {},
      transitions: {},
      frames: { g1: { region: "r1", x: 50, y: 200, w: 150, h: 150 } },
      notes: { n1: { region: "r0", x: 800, y: 100, w: 100, h: 40, text: "outside" } },
    },
  };
  await page.evaluate(([t]) => window.ufsm.load(t, "regionnotes.ufsm"), [JSON.stringify(model)]);
  await page.waitForTimeout(200);
  const doc = async () => JSON.parse(await U("serialize")).diagram;
  const [ix, iy] = await w2s(450, 250);
  await page.mouse.click(ix, iy);
  check("a click in a state's empty region selects the state", JSON.stringify(await sel()) === '["s1"]');
  const [ex, ey] = await w2s(150, 375);
  await page.mouse.click(ex, ey);
  check(
    "a click on the edge of a frame without a caption in its region then selects the frame",
    JSON.stringify(await sel()) === '["g1"]',
    JSON.stringify(await sel()),
  );
  const [nx, ny] = await w2s(830, 120),
    [tx, ty] = await w2s(530, 420);
  await drag([nx, ny], [tx, ty]);
  const n1 = (await doc()).notes.n1;
  check("a note dropped into a state's region belongs to it", n1.region === "r1", JSON.stringify(n1));
  const before = await U("annotation", "n1");
  const [px, py] = await w2s(450, 110);
  await drag([px, py], [px + 50 * (await scale()), py]);
  const after = await U("annotation", "n1");
  check(
    "...and moves with the state",
    after.x === before.x + 50 && after.y === before.y,
    JSON.stringify([before, after]),
  );
  await U(
    "closeTab",
    (await U("tabs")).findIndex((t) => t.active),
    true,
  );
}
check("no page errors", errors.length === 0, errors.join("\n"));
console.log(`${pass} passed, ${fail} failed`);
await browser.close();
server.close();
process.exit(fail ? 1 : 0);
