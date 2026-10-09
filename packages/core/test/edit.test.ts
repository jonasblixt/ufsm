// SPDX-License-Identifier: GPL-3.0-or-later
// Copyright (C) 2026 Jonas Blixt <jonas@blxt.se>

import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  edgeGeometry,
  indexV1,
  isOffPage,
  loadModel,
  moveRegionSplit,
  moveVertices,
  parseV1,
  regionBand,
  regionBoxes,
  resetJog,
  resetLabel,
  resizableEdges,
  resizeVertex,
  routeInfo,
  serializeV1,
  setBendPoint,
  setEdgeEnd,
  setJog,
  setLabel,
  snap,
  unpinEdgeEnd,
  vertexBox,
  type Box,
  type DocIndex,
  type FreeEdgeLayout,
  type SEdgeLayout,
  type UfsmDocument,
} from "../src/index";
import { rng } from "./random-model";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

/**
 *   Initial ─► P (100,100 400x300)  ── t5 ──►  C (700,100 120x80)
 *              ├ r1 (h 130): A (abs 120,150 100x60), D (abs 300,150 80x60); t6 A→D free (inside r1)
 *              └ r2 (fill):  B (abs 300,290 100x60)
 *   t2 A→B free (via in root coordinates), t3 B→C S auto, t4 A→C S with jog x 600
 */
function testDoc(): UfsmDocument {
  return parseV1(
    JSON.stringify({
      format: "ufsm",
      version: 1,
      name: "edit",
      declarations: { events: [{ id: "ev1", name: "e1" }], signals: [], actions: [], guards: [] },
      machine: {
        root: {
          id: "r0",
          states: [
            { id: "s1", kind: "initial" },
            {
              id: "s2",
              kind: "state",
              name: "P",
              regions: [
                { id: "r1", states: [{ id: "s3", kind: "state", name: "A" }, { id: "s6", kind: "state", name: "D" }] },
                { id: "r2", states: [{ id: "s4", kind: "state", name: "B" }] },
              ],
            },
            { id: "s5", kind: "state", name: "C" },
          ],
        },
        transitions: [
          { id: "t1", from: "s1", to: "s2" },
          { id: "t2", from: "s3", to: "s4", on: "ev1" },
          { id: "t3", from: "s4", to: "s5", on: "ev1" },
          { id: "t4", from: "s3", to: "s5", on: "ev1" },
          { id: "t5", from: "s2", to: "s5", on: "ev1" },
          { id: "t6", from: "s3", to: "s6", on: "ev1" },
        ],
      },
      diagram: {
        paper: "A4",
        states: {
          s1: { x: 40, y: 40, w: 20, h: 20 },
          s2: { x: 100, y: 100, w: 400, h: 300 },
          s3: { x: 20, y: 50, w: 100, h: 60 },
          s4: { x: 200, y: 190, w: 100, h: 60 },
          s5: { x: 700, y: 100, w: 120, h: 80 },
          s6: { x: 200, y: 50, w: 80, h: 60 },
        },
        regions: { r1: { h: 130 } },
        transitions: {
          t1: { from: { side: "right", offset: 10 }, to: { side: "left", offset: 20 } },
          t2: { from: { side: "bottom", offset: 50 }, to: { side: "left", offset: 30 }, via: [[170, 320]], label: { x: 180, y: 260, w: 100 } },
          t3: { route: "s" },
          t4: { route: "s", jog: { x: 600 } },
          t5: {
            from: { side: "right", offset: 50 },
            to: { side: "left", offset: 30 },
            via: [[600, 150], [600, 130]],
            label: { x: 520, y: 100, w: 150 },
          },
          t6: { from: { side: "right", offset: 30 }, to: { side: "left", offset: 30 }, via: [[150, 80]] },
        },
      },
    }),
  );
}

const free = (doc: UfsmDocument, id: string): FreeEdgeLayout => doc.diagram!.transitions[id] as FreeEdgeLayout;
const sEdge = (doc: UfsmDocument, id: string): SEdgeLayout => doc.diagram!.transitions[id] as SEdgeLayout;
const box = (doc: UfsmDocument, id: string): Box => vertexBox(indexV1(doc), id);
const clone = (doc: UfsmDocument): UfsmDocument => structuredClone(doc);

describe("layout edits: moving", () => {
  it("snap the anchor to the grid, move contents with their state and change nothing but the diagram", () => {
    const doc = testDoc();
    const machine = structuredClone(doc.machine);
    assert.deepEqual(moveVertices(doc, ["s2"], 13, 7, "s2"), { x: 10, y: 10 });
    assert.deepEqual(doc.diagram!.states["s2"], { x: 110, y: 110, w: 400, h: 300 });
    assert.deepEqual(doc.diagram!.states["s3"], { x: 20, y: 50, w: 100, h: 60 }, "contents are relative: unchanged");
    assert.deepEqual(box(doc, "s3"), { x: 130, y: 160, w: 100, h: 60 });
    assert.deepEqual(doc.machine, machine);
  });

  it("move only the outermost of nested selected vertices", () => {
    const doc = testDoc();
    moveVertices(doc, ["s3", "s2"], 20, 0, "s3");
    assert.equal(doc.diagram!.states["s2"]!.x, 120);
    assert.equal(doc.diagram!.states["s3"]!.x, 20, "A moved once, with P");
  });

  it("keep a vertex inside its region band; one already outside may stay but is not pushed further out", () => {
    const doc = testDoc();
    assert.deepEqual(moveVertices(doc, ["s3"], 0, 500, "s3"), { x: 0, y: 50 }, "A's band ends at 260");
    assert.deepEqual(moveVertices(doc, ["s3"], 0, -500, "s3"), { x: 0, y: -70 }, "...and starts at 130");
    assert.deepEqual(moveVertices(doc, ["s5"], -1000, 0, "s5"), { x: -700, y: 0 }, "the sheet: non-negative coordinates");
    const outside = testDoc();
    outside.diagram!.states["s3"]!.y = 200; // abs 300..360, below its band
    assert.deepEqual(moveVertices(outside, ["s3"], 0, 10, "s3"), { x: 0, y: 0 });
    assert.deepEqual(moveVertices(outside, ["s3"], 0, -10, "s3"), { x: 0, y: -10 });
    assert.deepEqual(moveVertices(testDoc(), ["s3", "s5"], 0, 100, "s5"), { x: 0, y: 50 }, "a group moves as far as its tightest member");
  });

  it("let free routes follow: translated when both ends move, blended along the path when one does", () => {
    const doc = testDoc();
    moveVertices(doc, ["s2"], 10, 10, "s2");
    // t2 runs between A and B, both inside P, but its bend point is in root coordinates: it moves with them
    assert.deepEqual(free(doc, "t2").via, [[180, 330]]);
    assert.deepEqual(free(doc, "t2").label, { x: 190, y: 270, w: 100 });
    // t5 leaves P (moved by 10,10) for C (still): bend points at 100/220 and 120/220 of the path move by 5.45 and 4.55
    assert.deepEqual(free(doc, "t5").via, [[605, 155], [605, 135]]);
    // t6 lies inside r1: its coordinates are relative to P and need no change
    assert.deepEqual(free(doc, "t6").via, [[150, 80]]);
    assert.deepEqual(free(doc, "t1"), free(testDoc(), "t1"), "no bend points, no label: nothing to write");
  });

  it("move an S jog only with a route that moves as a whole", () => {
    const one = testDoc();
    moveVertices(one, ["s3"], 10, 0, "s3");
    assert.deepEqual(sEdge(one, "t4").jog, { x: 600 }, "one end moved: the jog keeps its absolute position");
    const both = testDoc();
    moveVertices(both, ["s3", "s5"], 10, 0, "s3");
    assert.deepEqual(sEdge(both, "t4").jog, { x: 610 });
    assert.deepEqual(sEdge(both, "t3"), { route: "s" }, "nothing stored for an automatic route");
  });
});

describe("layout edits: resizing", () => {
  it("drag the right and bottom edges, snapped and limited by the region band", () => {
    const doc = testDoc();
    resizeVertex(doc, "s3", { right: 263, bottom: 233 });
    assert.deepEqual(box(doc, "s3"), { x: 120, y: 150, w: 140, h: 80 });
    resizeVertex(doc, "s3", { bottom: 400 });
    assert.equal(box(doc, "s3").h, 110, "r1's band ends at 260");
    resizeVertex(doc, "s5", { right: 0, bottom: 0 });
    assert.deepEqual(box(doc, "s5"), { x: 700, y: 100, w: 40, h: 40 }, "minimum size");
  });

  it("keep contents in place when the left or top edge moves, and never shrink past them", () => {
    const doc = testDoc();
    resizeVertex(doc, "s2", { left: 54 });
    assert.deepEqual(box(doc, "s2"), { x: 50, y: 100, w: 450, h: 300 });
    assert.deepEqual([box(doc, "s3").x, box(doc, "s4").x], [120, 300], "absolute positions kept");
    assert.equal(doc.diagram!.states["s3"]!.x, 70);
    resizeVertex(doc, "s2", { left: 200 });
    assert.equal(box(doc, "s2").x, 120, "stops at A");
    assert.equal(doc.diagram!.states["s3"]!.x, 0);
    const stray = testDoc();
    stray.diagram!.states["s3"]!.x = -30; // A sticks out of P's left side (abs 70)
    resizeVertex(stray, "s2", { left: 110 });
    assert.equal(box(stray, "s2").x, 100, "a child already outside blocks shrinking but does not pull the edge out");
    resizeVertex(stray, "s2", { left: 40 });
    assert.equal(box(stray, "s2").x, 40, "growing is fine");
    const right = testDoc();
    resizeVertex(right, "s2", { right: 300 });
    assert.equal(box(right, "s2").w, 300, "stops at D and B (right edge 400)");
  });

  it("take a top edge's change from the first region band and give a bottom edge's to the last one", () => {
    const up = testDoc();
    resizeVertex(up, "s2", { top: 75 });
    assert.deepEqual(box(up, "s2"), { x: 100, y: 80, w: 400, h: 320 });
    assert.equal(up.diagram!.regions["r1"]!.h, 150);
    assert.deepEqual([box(up, "s3").y, box(up, "s4").y], [150, 290]);
    const bands = regionBoxes(indexV1(up), indexV1(up).vertices.get("s2")!.vertex as never);
    assert.deepEqual(bands.map((b) => [b.box.y, b.box.h]), [[110, 150], [260, 140]], "the bands did not move");
    const down = testDoc();
    resizeVertex(down, "s2", { top: 170 });
    assert.equal(box(down, "s2").y, 120, "A's top (150) minus the header");
    assert.equal(down.diagram!.regions["r1"]!.h, 110);
    const bottom = testDoc();
    resizeVertex(bottom, "s2", { bottom: 300 });
    assert.equal(box(bottom, "s2").h, 250, "stops at B's bottom (350)");
    assert.equal(bottom.diagram!.regions["r2"], undefined, "a filling band needs no height");
    const fixedLast = testDoc();
    fixedLast.diagram!.regions["r2"] = { h: 140 };
    resizeVertex(fixedLast, "s2", { bottom: 450 });
    assert.equal(fixedLast.diagram!.regions["r2"]!.h, 190);
  });

  it("keep transition ends where they were when the left or top edge moves", () => {
    const doc = testDoc();
    resizeVertex(doc, "s2", { top: 80 });
    assert.deepEqual(free(doc, "t1").to, { side: "left", offset: 40 });
    assert.deepEqual(free(doc, "t5").from, { side: "right", offset: 70 });
    assert.deepEqual(free(doc, "t5").via, free(testDoc(), "t5").via, "ends did not move: bend points untouched");
  });

  it("resize states and fork/join bars only", () => {
    const index = indexV1(testDoc());
    assert.deepEqual(resizableEdges(index, "s1"), []);
    assert.deepEqual(resizableEdges(index, "s2"), ["left", "top", "right", "bottom"]);
    const doc = testDoc();
    resizeVertex(doc, "s1", { right: 200 });
    assert.deepEqual(doc, testDoc());
  });

  it("move a region separator within the limits of both bands' contents", () => {
    const doc = testDoc();
    moveRegionSplit(doc, "s2", 0, 304);
    assert.equal(doc.diagram!.regions["r1"]!.h, 160, "stops at B's top (290)");
    moveRegionSplit(doc, "s2", 0, 100);
    assert.equal(doc.diagram!.regions["r1"]!.h, 80, "stops at A's bottom (210)");
    assert.equal(doc.diagram!.regions["r2"], undefined);
    const fixed = testDoc();
    fixed.diagram!.regions["r2"] = { h: 140 };
    moveRegionSplit(fixed, "s2", 0, 250);
    assert.deepEqual([fixed.diagram!.regions["r1"]!.h, fixed.diagram!.regions["r2"]!.h], [120, 150], "the state keeps its height");
    const none = testDoc();
    moveRegionSplit(none, "s2", 1, 300);
    assert.deepEqual(none, testDoc(), "no separator below the last band");
  });
});

describe("layout edits: transition handles", () => {
  it("pin an end at the nearest side, snapped; round pseudo states attach in the middle; unpin again", () => {
    const doc = testDoc();
    setEdgeEnd(doc, "t3", "from", { x: 401, y: 333 });
    assert.deepEqual(sEdge(doc, "t3").from, { side: "right", offset: 40 });
    assert.ok(routeInfo(indexV1(doc), "t3")!.fromPinned);
    unpinEdgeEnd(doc, "t3", "from");
    assert.deepEqual(sEdge(doc, "t3"), { route: "s" });
    setEdgeEnd(doc, "t1", "from", { x: 50, y: 61 });
    assert.deepEqual(free(doc, "t1").from, { side: "bottom", offset: 10 });
    setEdgeEnd(doc, "t3", "to", { x: 690, y: 101 });
    assert.deepEqual(sEdge(doc, "t3").to, { side: "left", offset: 10 }, "kept away from the corner");
  });

  it("set and reset an S jog on its current axis, relative to the transition's region", () => {
    const doc = testDoc();
    setJog(doc, "t4", 657);
    assert.deepEqual(sEdge(doc, "t4").jog, { x: 660 });
    resetJog(doc, "t4");
    assert.equal(sEdge(doc, "t4").jog, undefined);
  });

  it("move a free bend point", () => {
    const doc = testDoc();
    setBendPoint(doc, "t2", 0, { x: 184, y: 327 });
    assert.deepEqual(free(doc, "t2").via, [[180, 330]]);
    setBendPoint(doc, "t2", 1, { x: 0, y: 0 });
    assert.deepEqual(free(doc, "t2").via, [[180, 330]], "no such bend point");
    setBendPoint(doc, "t6", 0, { x: 254, y: 186 });
    assert.deepEqual(free(doc, "t6").via, [[150, 90]], "relative to P, where the route lies");
  });

  it("move labels: S labels stay relative to their route, free labels to their region", () => {
    const doc = testDoc();
    const anchor = routeInfo(indexV1(doc), "t3")!.labelAnchor;
    setLabel(doc, "t3", { x: anchor.x + 33, y: anchor.y - 61 });
    const placed = edgeGeometry(indexV1(doc), "t3")!.label!;
    assert.deepEqual([placed.x, placed.y], [snap(anchor.x + 33), snap(anchor.y - 61)]);
    moveVertices(doc, ["s5"], 0, 50, "s5");
    const moved = edgeGeometry(indexV1(doc), "t3")!.label!;
    const anchor2 = routeInfo(indexV1(doc), "t3")!.labelAnchor;
    assert.deepEqual([moved.x - anchor2.x, moved.y - anchor2.y], [placed.x - anchor.x, placed.y - anchor.y]);
    resetLabel(doc, "t3");
    assert.equal(sEdge(doc, "t3").label, undefined);
    setLabel(doc, "t5", { x: 523, y: 98 });
    assert.deepEqual(free(doc, "t5").label, { x: 520, y: 100, w: 150 });
    setLabel(doc, "t1", { x: 0, y: 0 });
    assert.equal(free(doc, "t1").label, undefined, "a free route without a label has none to move");
  });

  it("leave a valid canonical document after a series of edits", () => {
    const doc = testDoc();
    moveVertices(doc, ["s2"], 23, 41, "s2");
    resizeVertex(doc, "s2", { left: 0, top: 10 });
    moveRegionSplit(doc, "s2", 0, 280);
    setEdgeEnd(doc, "t3", "to", { x: 700, y: 140 });
    setJog(doc, "t4", 640);
    setLabel(doc, "t2", { x: 200, y: 240 });
    const text = serializeV1(doc);
    assert.equal(serializeV1(parseV1(text)), text);
  });
});

describe("layout edits on every repository model", () => {
  const files = ["examples", "tests/models", "apps/editor/src/fsm"].flatMap((d) =>
    existsSync(join(repoRoot, d)) ? readdirSync(join(repoRoot, d)).filter((f) => f.endsWith(".ufsm")).map((f) => join(repoRoot, d, f)) : [],
  );
  const inside = (b: Box, band: Box | undefined): boolean =>
    !band || (b.x >= band.x - 1e-6 && b.y >= band.y - 1e-6 && b.x + b.w <= band.x + band.w + 1e-6 && b.y + b.h <= band.y + band.h + 1e-6);
  /** Inline children of every state, with their band. */
  const placements = (index: DocIndex): { id: string; ok: boolean }[] =>
    [...index.vertices.keys()].map((id) => ({ id, ok: inside(vertexBox(index, id), regionBand(index, id)) }));

  it("keep every vertex that was inside its band inside it, and keep the files valid", () => {
    const r = rng(7);
    let moves = 0;
    for (const f of files) {
      const original = loadModel(readFileSync(f, "utf8")).doc;
      const index0 = indexV1(original);
      const before = new Map(placements(index0).map((p) => [p.id, p.ok]));
      const ids = [...index0.vertices.keys()];
      let doc = clone(original);
      for (let k = 0; k < 40; k++) {
        const id = ids[Math.floor(r() * ids.length)]!;
        const pick = r();
        if (pick < 0.5) moveVertices(doc, [id], (r() - 0.5) * 600, (r() - 0.5) * 600, id);
        else if (pick < 0.8) {
          const b = vertexBox(indexV1(doc), id);
          resizeVertex(doc, id, { left: b.x + (r() - 0.5) * 300, top: b.y + (r() - 0.5) * 300 });
          resizeVertex(doc, id, { right: b.x + b.w + (r() - 0.5) * 300, bottom: b.y + b.h + (r() - 0.5) * 300 });
        } else {
          const v = indexV1(doc).vertices.get(id)!.vertex;
          if (v.kind === "state" && (v.regions?.length ?? 0) > 1) moveRegionSplit(doc, id, 0, vertexBox(indexV1(doc), id).y + r() * 400);
        }
        moves++;
        const index = indexV1(doc);
        for (const p of placements(index)) {
          const info = index.vertices.get(p.id)!;
          if (isOffPage(index, info.region.id)) continue;
          if (before.get(p.id)) assert.ok(p.ok, `${f}: ${p.id} left its band after editing ${id}`);
        }
        assert.deepEqual(doc.machine, original.machine);
      }
      const text = serializeV1(doc);
      doc = parseV1(text);
      assert.equal(serializeV1(doc), text, f);
    }
    assert.ok(moves > 500);
  });
});
